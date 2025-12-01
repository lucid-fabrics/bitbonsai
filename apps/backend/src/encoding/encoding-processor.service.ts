import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type Job, JobStage, type Policy } from '@prisma/client';
import { DataAccessService } from '../core/services/data-access.service';
import { LibrariesService } from '../libraries/libraries.service';
import { NodesService } from '../nodes/nodes.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { FfmpegService } from './ffmpeg.service';

interface JobWithPolicy extends Job {
  policy?: Policy;
}

interface WorkerState {
  workerId: string; // Unique worker identifier: "nodeId-worker-1"
  nodeId: string;
  isRunning: boolean;
  currentJobId: string | null;
  startedAt: Date;
  shutdownPromise?: Promise<void>; // Promise that resolves when worker loop exits
  shutdownResolve?: () => void; // Function to resolve the shutdown promise
}

interface NodeWorkerPool {
  nodeId: string;
  maxWorkers: number;
  activeWorkers: Set<string>; // Set of workerIds currently running
}

interface JobResult {
  beforeSizeBytes: bigint;
  afterSizeBytes: bigint;
  savedBytes: bigint;
  savedPercent: number;
}

/**
 * EncodingProcessorService
 *
 * Handles encoding job processing with queue management and worker orchestration.
 * Implements:
 * - Worker pool pattern (multiple workers per node)
 * - Configurable concurrent workers (default: 4, max: 12)
 * - Queue management with concurrent job limits
 * - Automatic retry logic (max 3 retries)
 * - Atomic file replacement with verification
 * - Progress tracking and metrics updates
 */
@Injectable()
export class EncodingProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EncodingProcessorService.name);

  // Worker pool management
  private readonly workerPools = new Map<string, NodeWorkerPool>();
  private readonly workers = new Map<string, WorkerState>(); // workerId -> WorkerState
  // ISSUE #10 FIX: Mutex locks for each node to prevent concurrent pool modifications
  private readonly poolLocks = new Map<string, Promise<void>>();

  // AUDIT #2 ISSUE #24 FIX: Store watchdog interval for cleanup
  private watchdogIntervalId?: NodeJS.Timeout;

  // Configuration
  private readonly MAX_RETRIES = 3;

  // CPU-Aware Worker Calculation Constants
  private readonly CORES_PER_HEVC_JOB = 4; // Each HEVC encode needs ~4 CPU cores minimum
  private readonly WORKER_SAFETY_MARGIN = 0.5; // Use 50% of theoretical max for system stability
  private readonly MIN_WORKERS_PER_NODE = 2; // Absolute minimum workers
  private readonly MAX_WORKERS_PER_NODE = 12; // Absolute maximum workers (safety cap)

  // Calculated optimal workers based on CPU capacity (set in constructor)
  private readonly DEFAULT_WORKERS_PER_NODE: number;

  // PERF: Cache pool for temp files (SSD for faster I/O)
  // If ENCODING_TEMP_PATH is set, use it; otherwise fall back to source directory
  private readonly ENCODING_TEMP_PATH: string | null = process.env.ENCODING_TEMP_PATH || null;

  // Resource preflight thresholds
  private readonly MIN_FREE_DISK_SPACE_GB = 5; // Minimum 5GB free space
  private readonly MIN_FREE_MEMORY_PERCENT = 10; // Minimum 10% free RAM
  private readonly DISK_SPACE_BUFFER_PERCENT = 20; // 20% buffer for encoding overhead

  // Auto-heal timing constants (Code Convention: no magic numbers)
  private readonly AUTO_HEAL_INITIAL_DELAY_MS = 2000; // 2 seconds
  private readonly AUTO_HEAL_STABILIZATION_DELAY_MS = 3000; // 3 seconds
  private readonly VOLUME_MOUNT_PROBE_DELAY_MS = 1000; // 1 second
  private readonly VOLUME_MOUNT_MAX_RETRIES = 10;
  private readonly TEMP_FILE_CHECK_DELAY_MS = 1000; // 1 second
  private readonly TEMP_FILE_MAX_RETRIES = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    readonly _dataAccessService: DataAccessService,
    private readonly ffmpegService: FfmpegService,
    private readonly librariesService: LibrariesService,
    private readonly nodesService: NodesService
  ) {
    // Calculate optimal workers based on CPU capacity
    this.DEFAULT_WORKERS_PER_NODE = this.calculateOptimalWorkers();
  }

  /**
   * Calculate optimal concurrent workers based on CPU capacity
   *
   * Formula: workers = Math.floor((cpuCores / CORES_PER_JOB) * SAFETY_MARGIN)
   *
   * Example for 128-thread CPU:
   * - Theoretical max: 128 / 4 = 32 workers
   * - With 50% safety margin: 32 * 0.5 = 16 workers
   * - Capped at MAX (12): 12 workers
   *
   * This ensures system never hits 100% CPU, leaving headroom for:
   * - OS operations
   * - Network I/O
   * - Database queries
   * - File system operations
   */
  private calculateOptimalWorkers(): number {
    const cpuCount = os.cpus().length;

    // Theoretical maximum workers if CPU was only resource
    const theoreticalMax = Math.floor(cpuCount / this.CORES_PER_HEVC_JOB);

    // Apply safety margin for system stability
    const optimalWorkers = Math.floor(theoreticalMax * this.WORKER_SAFETY_MARGIN);

    // Clamp between MIN and MAX
    const clampedWorkers = Math.max(
      this.MIN_WORKERS_PER_NODE,
      Math.min(optimalWorkers, this.MAX_WORKERS_PER_NODE)
    );

    this.logger.log('🧮 CPU-Aware Worker Calculation:');
    this.logger.log(`  CPU Cores Detected: ${cpuCount}`);
    this.logger.log(`  Cores Per HEVC Job: ${this.CORES_PER_HEVC_JOB}`);
    this.logger.log(`  Theoretical Max Workers: ${theoreticalMax}`);
    this.logger.log(`  Safety Margin: ${this.WORKER_SAFETY_MARGIN * 100}%`);
    this.logger.log(`  Optimal Workers (after margin): ${optimalWorkers}`);
    this.logger.log(
      `  Final Workers (clamped ${this.MIN_WORKERS_PER_NODE}-${this.MAX_WORKERS_PER_NODE}): ${clampedWorkers}`
    );
    this.logger.log(`  🎯 Using ${clampedWorkers} concurrent workers per node`);

    return clampedWorkers;
  }

  /**
   * Auto-start worker pools for all online nodes on module initialization
   * This ensures encoding workers are running whenever the backend starts
   *
   * Also performs auto-heal to recover from crashes/reboots
   */
  async onModuleInit() {
    this.logger.log('🔧 Initializing encoding processor...');

    // PERF: Log cache pool configuration
    if (this.ENCODING_TEMP_PATH) {
      this.logger.log(
        `⚡ Cache pool ENABLED: Using ${this.ENCODING_TEMP_PATH} for temp files (faster SSD I/O)`
      );
    } else {
      this.logger.log('📂 Cache pool DISABLED: Using source directory for temp files');
    }

    try {
      // HYBRID APPROACH: Initial delay + volume mount probing + file system stabilization + retry logic
      // Step 1: Small initial delay to let basic initialization complete
      this.logger.log('⏳ Waiting for basic initialization...');
      await new Promise((resolve) => setTimeout(resolve, this.AUTO_HEAL_INITIAL_DELAY_MS));

      // Step 2: Wait for volume mounts to be accessible
      await this.waitForVolumeMounts();

      // Step 3: Let file system stabilize after volumes are mounted
      this.logger.log('⏳ Waiting for file system to stabilize...');
      await new Promise((resolve) => setTimeout(resolve, this.AUTO_HEAL_STABILIZATION_DELAY_MS));

      // STEP 4: Auto-heal orphaned jobs from previous crash/reboot
      await this.autoHealOrphanedJobs();

      // CRITICAL FIX: Only start workers for the CURRENT node, not all online nodes
      // This prevents MAIN nodes from starting workers for LINKED nodes, which causes
      // the error "getNextJob should not be called directly on MAIN nodes"
      const currentNode = await this.nodesService.getCurrentNode();

      if (!currentNode) {
        this.logger.warn('Current node not found - no workers started');
        return;
      }

      // MULTI-NODE AUDIT: Enhanced logging to debug LINKED node encoding issues
      this.logger.log(`🔍 MULTI-NODE: Current node configuration:`);
      this.logger.log(`   - Node ID: ${currentNode.id}`);
      this.logger.log(`   - Node Name: ${currentNode.name}`);
      this.logger.log(`   - Node Role: ${currentNode.role}`);
      this.logger.log(`   - Main Node URL: ${currentNode.mainNodeUrl || 'N/A (this is MAIN)'}`);
      this.logger.log(`   - Has Shared Storage: ${currentNode.hasSharedStorage}`);
      this.logger.log(
        `   - Max Workers: ${currentNode.maxWorkers || this.DEFAULT_WORKERS_PER_NODE}`
      );

      // STEP 3: Start worker pool for the current node using its configured maxWorkers
      const maxWorkers = currentNode.maxWorkers || this.DEFAULT_WORKERS_PER_NODE;

      this.logger.log(
        `🚀 MULTI-NODE: Starting ${maxWorkers} worker(s) for ${currentNode.role} node: ${currentNode.name}`
      );

      const workersStarted = await this.startWorkerPool(currentNode.id, maxWorkers);

      if (workersStarted > 0) {
        this.logger.log(
          `✅ MULTI-NODE: Successfully started ${workersStarted} worker(s) for ${currentNode.role} node: ${currentNode.name} (max: ${maxWorkers})`
        );
      } else {
        this.logger.error(
          `❌ MULTI-NODE: FAILED to start workers for ${currentNode.role} node: ${currentNode.name}`
        );
      }

      // STEP 4: Start background watchdog to detect stuck jobs
      this.startStuckJobWatchdog();
    } catch (error) {
      this.logger.error('Failed to initialize encoding processor:', error);
    }
  }

  /**
   * AUDIT #2 ISSUE #24 FIX: Cleanup on module destruction
   * Prevents memory leak from watchdog interval
   */
  async onModuleDestroy() {
    this.logger.log('🛑 Shutting down encoding processor...');

    // Clear watchdog interval
    if (this.watchdogIntervalId) {
      clearInterval(this.watchdogIntervalId);
      this.watchdogIntervalId = undefined;
      this.logger.log('✓ Watchdog interval cleared');
    }

    // Note: Worker cleanup happens naturally when workers detect isRunning=false
    // FFmpeg process cleanup is handled by FfmpegService.onModuleDestroy()
  }

  /**
   * Wait for Docker volume mounts to be fully accessible
   * Probes the media directory to ensure volume is ready before auto-heal
   * @private
   */
  private async waitForVolumeMounts(): Promise<void> {
    const mediaPaths = (process.env.MEDIA_PATHS || '').split(',').filter(Boolean);
    if (mediaPaths.length === 0) {
      this.logger.warn('No MEDIA_PATHS configured, skipping volume mount check');
      return;
    }

    for (let attempt = 1; attempt <= this.VOLUME_MOUNT_MAX_RETRIES; attempt++) {
      try {
        // Test ALL media paths - if ANY exist, volumes are ready
        for (const testPath of mediaPaths) {
          if (fs.existsSync(testPath)) {
            this.logger.log(
              `✅ Volume mount ready: ${testPath} (attempt ${attempt}/${this.VOLUME_MOUNT_MAX_RETRIES})`
            );
            return;
          }
        }
      } catch (_error) {
        // Ignore errors, will retry
      }

      if (attempt < this.VOLUME_MOUNT_MAX_RETRIES) {
        this.logger.debug(
          `⏳ Waiting for volume mounts... (attempt ${attempt}/${this.VOLUME_MOUNT_MAX_RETRIES})`
        );
        await new Promise((resolve) => setTimeout(resolve, this.VOLUME_MOUNT_PROBE_DELAY_MS));
      }
    }

    this.logger.warn(
      `⚠️  Volume mounts not detected after ${this.VOLUME_MOUNT_MAX_RETRIES} attempts - proceeding anyway`
    );
  }

  /**
   * Check if temp file exists with retry logic
   * Handles edge cases where volume mounts are still initializing
   * @param tempFilePath - Path to temp file
   * @returns true if file exists, false otherwise
   * @private
   */
  private async checkTempFileWithRetry(tempFilePath: string | null): Promise<boolean> {
    if (!tempFilePath) {
      this.logger.log('  ℹ️  TRUE RESUME: No temp file path provided, skipping check');
      return false;
    }

    this.logger.log(`  🔍 TRUE RESUME: Checking if temp file exists: ${tempFilePath}`);

    for (let attempt = 1; attempt <= this.TEMP_FILE_MAX_RETRIES; attempt++) {
      try {
        if (fs.existsSync(tempFilePath)) {
          this.logger.log(
            `  ✅ TRUE RESUME: Temp file found on attempt ${attempt}/${this.TEMP_FILE_MAX_RETRIES}`
          );
          return true;
        }
        this.logger.log(
          `  ⏳ TRUE RESUME: Temp file not found (attempt ${attempt}/${this.TEMP_FILE_MAX_RETRIES}), retrying...`
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `  ⚠️  TRUE RESUME: Error checking temp file (attempt ${attempt}/${this.TEMP_FILE_MAX_RETRIES}): ${errorMsg}`
        );
      }

      if (attempt < this.TEMP_FILE_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, this.TEMP_FILE_CHECK_DELAY_MS));
      }
    }

    this.logger.warn(
      `  ❌ TRUE RESUME: Temp file not found after ${this.TEMP_FILE_MAX_RETRIES} attempts - will restart from 0%`
    );
    return false;
  }

  /**
   * Auto-heal orphaned jobs that were left in active states
   * from backend crashes, reboots, or container restarts
   *
   * Strategy:
   * - On startup, ALL jobs in active processing states are orphaned (no active processes)
   * - Reset them ALL to QUEUED so they can be retried immediately
   * - Files that passed HEALTH_CHECK once don't need re-validation after restart
   * - This ensures clean recovery from any type of restart
   *
   * CRITICAL FIX: Reset ALL orphaned jobs to QUEUED (not DETECTED)
   * - HEALTH_CHECK jobs already passed validation, no need to re-validate
   * - ENCODING, VERIFYING, PAUSED jobs obviously need to restart
   * - getNextJob() only fetches QUEUED jobs, so DETECTED jobs would be stuck
   */
  private async autoHealOrphanedJobs(): Promise<void> {
    this.logger.log('🏥 Auto-heal: Checking for orphaned jobs in all active states...');

    try {
      // On backend startup, ALL jobs in active processing states are orphaned
      // since we have no active workers/processes running yet
      const orphanedJobs = await this.prisma.job.findMany({
        where: {
          stage: {
            in: [
              JobStage.HEALTH_CHECK,
              JobStage.ENCODING,
              JobStage.VERIFYING,
              JobStage.PAUSED,
              JobStage.PAUSED_LOAD, // CRITICAL FIX: Include load-paused jobs in auto-heal
            ],
          },
        },
        select: {
          id: true,
          fileLabel: true,
          stage: true,
          progress: true,
          updatedAt: true,
          tempFilePath: true, // TRUE RESUME: needed to check if temp file exists
          retryCount: true, // AUTO-HEAL TRACKING: needed to increment retry count
        },
      });

      if (orphanedJobs.length === 0) {
        this.logger.log('✅ No orphaned jobs found - system is healthy');
        return;
      }

      this.logger.warn(
        `🔧 Found ${orphanedJobs.length} orphaned job(s) from backend restart - recovering...`
      );

      // Reset each orphaned job to QUEUED
      // CRITICAL FIX: ALL jobs go to QUEUED (not DETECTED) to resume immediately
      // TRUE RESUME: Keep progress and resume state (DON'T reset to 0%)
      for (const job of orphanedJobs) {
        try {
          // TRUE RESUME: Check if temp file still exists (with retry logic)
          const tempFileExists = await this.checkTempFileWithRetry(job.tempFilePath);

          // Log temp file check result for debugging
          if (job.tempFilePath) {
            this.logger.log(`  Checking temp file: ${job.tempFilePath}`);
            this.logger.log(`  File exists: ${tempFileExists}`);
          }

          const errorMessage =
            job.stage === JobStage.PAUSED
              ? 'Paused job reset after backend restart - will resume from last position'
              : tempFileExists
                ? `Auto-heal: Successfully resumed from ${job.progress.toFixed(1)}% (was ${job.stage} before restart)`
                : `Auto-heal attempted but temp file was lost during restart - restarting from 0% (was ${job.stage} at ${job.progress.toFixed(1)}%)`;

          // CRITICAL BUG FIX: Recalculate resumeTimestamp based on current progress
          // The old resumeTimestamp is STALE (from when job first started encoding)
          // We need to calculate the CORRECT timestamp for the current progress percentage
          let recalculatedResumeTimestamp: string | null = null;
          if (tempFileExists && job.progress > 0) {
            try {
              // Get the actual video file path from the job
              const videoJob = await this.prisma.job.findUnique({
                where: { id: job.id },
                select: { filePath: true },
              });

              if (videoJob?.filePath) {
                // Get video duration
                const videoDuration = await this.ffmpegService.getVideoDuration(videoJob.filePath);

                // Calculate resume time in seconds based on current progress
                const resumeSeconds = (job.progress / 100) * videoDuration;

                // Convert to HH:MM:SS.MS format
                recalculatedResumeTimestamp =
                  this.ffmpegService.formatSecondsToTimestamp(resumeSeconds);

                this.logger.log(
                  `  🔄 Recalculated resumeTimestamp for job ${job.fileLabel}: progress=${job.progress.toFixed(1)}%, videoDuration=${videoDuration.toFixed(2)}s, resumeSeconds=${resumeSeconds.toFixed(2)}s, resumeTimestamp=${recalculatedResumeTimestamp}`
                );
              }
            } catch (error) {
              this.logger.warn(
                `  ⚠️  Failed to recalculate resumeTimestamp for job ${job.id}: ${error instanceof Error ? error.message : String(error)}`
              );
              // Continue with existing resumeTimestamp (better than nothing)
            }
          }

          // MULTI-NODE: Use QueueService proxy to support LINKED nodes
          await this.queueService.update(job.id, {
            stage: JobStage.QUEUED, // CRITICAL FIX: Always QUEUED, never DETECTED
            // TRUE RESUME: DON'T reset progress if temp file exists
            ...(tempFileExists ? {} : { progress: 0 }),
            etaSeconds: null,
            error: errorMessage,
            startedAt: null, // Clear startedAt to allow fresh start
            // AUTO-HEAL TRACKING: ONLY set when temp file exists (successful resume)
            // Green dot indicator should only show when auto-heal actually worked
            ...(tempFileExists
              ? {
                  autoHealedAt: new Date(),
                  autoHealedProgress: job.progress,
                }
              : {}),
            retryCount: job.retryCount + 1,
            // TRUE RESUME: Clear resume state if temp file doesn't exist, otherwise update with recalculated timestamp
            ...(tempFileExists
              ? { resumeTimestamp: recalculatedResumeTimestamp }
              : {
                  tempFilePath: null,
                  resumeTimestamp: null,
                }),
          });

          this.logger.log(
            `  ✓ Reset orphaned job: ${job.fileLabel} (${job.stage} → QUEUED, ${tempFileExists ? `will resume from ${job.progress.toFixed(1)}%` : 'restarting from 0%'})`
          );
        } catch (error) {
          this.logger.error(`  ✗ Failed to reset job ${job.id}:`, error);
        }
      }

      this.logger.log(`✅ Auto-heal complete - recovered ${orphanedJobs.length} job(s)`);
    } catch (error) {
      this.logger.error('Auto-heal failed:', error);
    }
  }

  /**
   * Start background watchdog to detect stuck jobs during runtime
   *
   * HIGH PRIORITY FIX: Dynamic timeout based on file size
   * CRITICAL FIX: Intelligent load management with auto-pause/resume
   * - Small files (<10GB): 5 minute timeout
   * - Large files (>=10GB): 15 minute timeout
   * - Runs every 60 seconds for faster detection
   * - Attempts to kill hung FFmpeg processes before failing
   * - Auto-pauses jobs when load is high, resumes when load drops
   * - Provides detailed diagnostic information
   */
  private startStuckJobWatchdog(): void {
    this.logger.log(
      '👀 Starting enhanced stuck job watchdog (checks every 60s, dynamic timeout: 5-15min based on file size, load-based auto-pause)'
    );

    // AUDIT #2 ISSUE #24 FIX: Clear existing interval if any (hot reload protection)
    if (this.watchdogIntervalId) {
      clearInterval(this.watchdogIntervalId);
    }

    // AUDIT #2 ISSUE #24 FIX: Store interval ID for cleanup
    this.watchdogIntervalId = setInterval(async () => {
      try {
        // CRITICAL FIX: Intelligent load management FIRST (before stuck job detection)
        await this.manageLoadBasedPausing();

        // Then proceed with stuck job detection
        // HIGH PRIORITY FIX: Dynamic timeout based on file size
        // Small files get 5min timeout, large files get 15min timeout
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
        const tenGB = BigInt(10 * 1024 * 1024 * 1024);

        const stuckJobs = await this.prisma.job.findMany({
          where: {
            stage: 'ENCODING',
            OR: [
              {
                // Small files (<10GB): stuck for 5+ minutes
                beforeSizeBytes: {
                  lt: tenGB,
                },
                updatedAt: {
                  lt: fiveMinutesAgo,
                },
              },
              {
                // Large files (>=10GB): stuck for 15+ minutes
                beforeSizeBytes: {
                  gte: tenGB,
                },
                updatedAt: {
                  lt: fifteenMinutesAgo,
                },
              },
            ],
          },
          select: {
            id: true,
            fileLabel: true,
            progress: true,
            updatedAt: true,
            beforeSizeBytes: true,
          },
        });

        if (stuckJobs.length > 0) {
          this.logger.warn(
            `⚠️  Watchdog detected ${stuckJobs.length} stuck job(s) (dynamic timeout: 5-15min based on file size)`
          );

          for (const job of stuckJobs) {
            const stuckDurationMs = Date.now() - new Date(job.updatedAt).getTime();
            const stuckMinutes = Math.floor(stuckDurationMs / 60000);
            const fileSizeGB = Number(job.beforeSizeBytes) / 1024 ** 3;
            const timeoutUsed = job.beforeSizeBytes < tenGB ? '5min' : '15min';

            this.logger.warn(
              `  - ${job.fileLabel} (${fileSizeGB.toFixed(2)}GB) stuck at ${job.progress}% for ${stuckMinutes} minutes (timeout: ${timeoutUsed})`
            );

            // STEP 1: Try to kill the ffmpeg process
            const killAttempted = await this.killStuckFFmpegProcess(job.id);

            // STEP 2: Get diagnostic information
            const lastStderr = this.ffmpegService.getLastStderr(job.id);
            let errorMessage = `Job stuck - no progress for ${stuckMinutes} minutes`;

            if (killAttempted) {
              errorMessage += `\n\nFFmpeg process was killed by watchdog`;
            } else {
              errorMessage += `\n\nNo active FFmpeg process found (may have crashed)`;
            }

            if (lastStderr) {
              // Extract last few lines of stderr for context
              const stderrLines = lastStderr.trim().split('\n').slice(-5);
              const stderrContext = stderrLines.join('\n');
              errorMessage += `\n\nLast ffmpeg output:\n${stderrContext}`;
            } else {
              errorMessage += `\n\nNo error output captured (likely process crash or kill)`;
            }

            // STEP 3: Add system diagnostics
            const diagnostics = await this.getSystemDiagnostics(job.id);
            errorMessage += `\n\n${diagnostics}`;

            // STEP 4: Fail the job
            this.logger.warn(`  ✗ Failing stuck job: ${job.fileLabel}`);
            await this.queueService.failJob(job.id, errorMessage);
          }
        }
      } catch (error) {
        this.logger.error('Watchdog check failed:', error);
      }
    }, 60 * 1000); // Every 60 seconds
  }

  /**
   * Attempt to kill a stuck FFmpeg process
   *
   * @param jobId - Job ID
   * @returns True if process was found and killed
   * @private
   */
  private async killStuckFFmpegProcess(jobId: string): Promise<boolean> {
    try {
      // Use FFmpeg service's kill method
      const killed = await this.ffmpegService.killProcess(jobId);

      if (killed) {
        this.logger.log(`  ✓ Killed stuck FFmpeg process for job ${jobId}`);
        return true;
      }

      this.logger.debug(`  - No active FFmpeg process found for job ${jobId}`);
      return false;
    } catch (error) {
      this.logger.error(`  ✗ Failed to kill FFmpeg process for job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * CRITICAL FIX: Intelligent load management with auto-pause/resume
   *
   * Load-Based Worker Limits:
   * - Load < 50: All workers active (normal operation)
   * - Load 50-100: Pause to 80% of workers
   * - Load 100-200: Pause to 50% of workers
   * - Load 200+: Pause to 30% of workers (emergency mode)
   *
   * @private
   */
  private async manageLoadBasedPausing(): Promise<void> {
    // Only check load on Linux/macOS (load average not available on Windows)
    if (process.platform === 'win32') {
      return;
    }

    // Get 1-minute load average
    const loadAvg = os.loadavg()[0];
    const cpuCount = os.cpus().length;

    // Count currently encoding jobs
    const encodingJobs = await this.prisma.job.count({
      where: { stage: 'ENCODING' },
    });

    // Determine target worker limit based on load
    let targetWorkers: number;
    let loadLevel: string;

    if (loadAvg < 50) {
      // Normal operation - all workers
      targetWorkers = this.DEFAULT_WORKERS_PER_NODE;
      loadLevel = 'normal';
    } else if (loadAvg < 100) {
      // Moderate load - 80% workers
      targetWorkers = Math.ceil(this.DEFAULT_WORKERS_PER_NODE * 0.8);
      loadLevel = 'moderate';
    } else if (loadAvg < 200) {
      // High load - 50% workers
      targetWorkers = Math.ceil(this.DEFAULT_WORKERS_PER_NODE * 0.5);
      loadLevel = 'high';
    } else {
      // Emergency - 30% workers (minimum 2)
      targetWorkers = Math.max(2, Math.ceil(this.DEFAULT_WORKERS_PER_NODE * 0.3));
      loadLevel = 'critical';
    }

    // Calculate jobs to pause/resume
    const jobsToPause = encodingJobs - targetWorkers;
    const pausedJobs = await this.prisma.job.count({
      where: { stage: 'PAUSED_LOAD' },
    });

    // SCENARIO 1: Load is high, need to pause jobs
    if (jobsToPause > 0 && encodingJobs > targetWorkers) {
      this.logger.warn(
        `🔥 High system load detected: ${loadAvg.toFixed(1)} (${loadLevel} level, ${cpuCount} CPUs)`
      );
      this.logger.warn(
        `   Pausing ${jobsToPause} job(s) to reduce load from ${encodingJobs} to ${targetWorkers} workers`
      );

      // Get lowest priority QUEUED jobs to pause (don't interrupt encoding jobs)
      const jobsToAutoPause = await this.prisma.job.findMany({
        where: { stage: 'QUEUED' },
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }], // Lowest priority, newest first
        take: jobsToPause,
        select: { id: true, fileLabel: true, priority: true },
      });

      // Pause each job
      for (const job of jobsToAutoPause) {
        // MULTI-NODE: Use QueueService proxy to support LINKED nodes
        await this.queueService.update(job.id, {
          stage: 'PAUSED_LOAD',
          error: `Auto-paused due to ${loadLevel} system load (${loadAvg.toFixed(1)}). Will auto-resume when load drops.`,
        });

        this.logger.log(
          `  ⏸️  Paused job: ${job.fileLabel} (priority: ${job.priority}, load: ${loadAvg.toFixed(1)})`
        );
      }
    }

    // SCENARIO 2: Load is acceptable, resume paused jobs
    else if (pausedJobs > 0 && encodingJobs < targetWorkers) {
      const jobsToResume = Math.min(pausedJobs, targetWorkers - encodingJobs);

      this.logger.log(
        `✅ System load acceptable: ${loadAvg.toFixed(1)} (${loadLevel} level, ${cpuCount} CPUs)`
      );
      this.logger.log(
        `   Resuming ${jobsToResume} paused job(s) (${pausedJobs} paused, ${targetWorkers} target workers)`
      );

      // Get highest priority paused jobs to resume
      const jobsToAutoResume = await this.prisma.job.findMany({
        where: { stage: 'PAUSED_LOAD' },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }], // Highest priority, oldest first
        take: jobsToResume,
        select: { id: true, fileLabel: true, priority: true },
      });

      // Resume each job
      for (const job of jobsToAutoResume) {
        // MULTI-NODE: Use QueueService proxy to support LINKED nodes
        await this.queueService.update(job.id, {
          stage: 'QUEUED',
          error: `Auto-resumed after load dropped to ${loadLevel} level (${loadAvg.toFixed(1)})`,
        });

        this.logger.log(
          `  ▶️  Resumed job: ${job.fileLabel} (priority: ${job.priority}, load: ${loadAvg.toFixed(1)})`
        );
      }
    }
  }

  /**
   * Get system diagnostics for stuck job troubleshooting
   *
   * @param jobId - Job ID
   * @returns Diagnostic information string
   * @private
   */
  private async getSystemDiagnostics(jobId: string): Promise<string> {
    const diagnostics: string[] = ['System Diagnostics:'];

    try {
      // Memory status
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemoryPercent = ((totalMemory - freeMemory) / totalMemory) * 100;
      diagnostics.push(
        `- Memory: ${usedMemoryPercent.toFixed(1)}% used (${(freeMemory / 1024 ** 3).toFixed(2)}GB free)`
      );

      // Load average (Linux/macOS only)
      if (process.platform !== 'win32') {
        const loadAvg = os.loadavg();
        diagnostics.push(`- Load average: ${loadAvg.map((l) => l.toFixed(2)).join(', ')}`);
      }

      // Active worker count
      const activeWorkers = Array.from(this.workers.values()).filter(
        (w) => w.currentJobId !== null
      );
      diagnostics.push(`- Active workers: ${activeWorkers.length}/${this.workers.size}`);

      // FFmpeg process status
      const hasProcess = this.ffmpegService.hasActiveProcess(jobId);
      diagnostics.push(`- FFmpeg process active: ${hasProcess ? 'Yes' : 'No'}`);
    } catch (error) {
      diagnostics.push(`- Diagnostic collection failed: ${error}`);
    }

    return diagnostics.join('\n');
  }

  /**
   * ISSUE #10 FIX: Acquire mutex lock for pool operations
   * Ensures only one operation modifies a pool at a time
   *
   * @param nodeId - Node unique identifier
   * @private
   */
  private async acquirePoolLock(nodeId: string): Promise<void> {
    // Wait for any existing lock to complete
    const existingLock = this.poolLocks.get(nodeId);
    if (existingLock) {
      await existingLock;
    }

    // Create new lock promise
    let releaseLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // Store lock and return release function through closure
    this.poolLocks.set(nodeId, lockPromise);

    // Store release function on the promise for later
    (lockPromise as any).release = releaseLock;
  }

  /**
   * ISSUE #10 FIX: Release mutex lock for pool operations
   *
   * @param nodeId - Node unique identifier
   * @private
   */
  private releasePoolLock(nodeId: string): void {
    const lockPromise = this.poolLocks.get(nodeId) as any;
    if (lockPromise?.release) {
      lockPromise.release();
    }
    this.poolLocks.delete(nodeId);
  }

  /**
   * Start a worker pool for a node
   *
   * Starts multiple concurrent workers for a single node.
   * Each worker will independently poll for jobs and process them.
   *
   * ISSUE #10 FIX: Wrapped in mutex lock to prevent concurrent modifications
   *
   * @param nodeId - Node unique identifier
   * @param maxWorkers - Maximum number of concurrent workers (default: 4, max: 12)
   * @returns Number of workers actually started
   */
  async startWorkerPool(
    nodeId: string,
    maxWorkers = this.DEFAULT_WORKERS_PER_NODE
  ): Promise<number> {
    // ISSUE #10 FIX: Acquire lock before modifying pool
    await this.acquirePoolLock(nodeId);

    try {
      // Validate maxWorkers
      const validatedMaxWorkers = Math.min(Math.max(1, maxWorkers), this.MAX_WORKERS_PER_NODE);

      // Get or create worker pool for this node
      let pool = this.workerPools.get(nodeId);

      if (pool) {
        // Pool already exists - check if we can add more workers
        const currentWorkerCount = pool.activeWorkers.size;
        if (currentWorkerCount >= validatedMaxWorkers) {
          this.logger.warn(
            `Worker pool for node ${nodeId} already at capacity (${currentWorkerCount}/${validatedMaxWorkers})`
          );
          return 0;
        }

        // Update max workers if different
        pool.maxWorkers = validatedMaxWorkers;
      } else {
        // Create new worker pool
        pool = {
          nodeId,
          maxWorkers: validatedMaxWorkers,
          activeWorkers: new Set(),
        };
        this.workerPools.set(nodeId, pool);
      }

      // Start workers up to the max limit
      let workersStarted = 0;
      for (let i = 1; i <= validatedMaxWorkers; i++) {
        const workerId = `${nodeId}-worker-${i}`;

        // Skip if this worker is already running
        if (pool.activeWorkers.has(workerId)) {
          continue;
        }

        try {
          await this.startWorker(workerId, nodeId);
          pool.activeWorkers.add(workerId);
          workersStarted++;
        } catch (error) {
          this.logger.error(`Failed to start worker ${workerId}:`, error);
        }
      }

      this.logger.log(
        `Started ${workersStarted} worker(s) for node ${nodeId} (total: ${pool.activeWorkers.size}/${validatedMaxWorkers})`
      );

      return workersStarted;
    } finally {
      // ISSUE #10 FIX: Always release lock, even on error
      this.releasePoolLock(nodeId);
    }
  }

  /**
   * Start a single worker with unique ID
   *
   * CRITICAL FIX: Wrap processLoop in try-catch to prevent worker pool memory leak
   *
   * Begins processing jobs from the queue for the specified node.
   * Worker will continuously poll for new jobs while running.
   *
   * @param workerId - Unique worker identifier (e.g., "nodeId-worker-1")
   * @param nodeId - Node unique identifier
   * @private
   */
  private async startWorker(workerId: string, nodeId: string): Promise<void> {
    if (this.workers.has(workerId)) {
      this.logger.warn(`Worker ${workerId} already running`);
      return;
    }

    const worker: WorkerState = {
      workerId,
      nodeId,
      isRunning: true,
      currentJobId: null,
      startedAt: new Date(),
    };

    // Initialize shutdown promise for graceful shutdown support
    worker.shutdownPromise = new Promise<void>((resolve) => {
      worker.shutdownResolve = resolve;
    });

    this.workers.set(workerId, worker);

    // Start processing loop (fire and forget - runs in background)
    // CRITICAL FIX: Wrap in try-catch to handle worker crashes
    this.processLoop(workerId).catch((error) => {
      this.logger.error(`[${workerId}] Worker crashed:`, error);

      // CLEANUP: Remove worker from tracking to prevent memory leak
      const pool = this.workerPools.get(nodeId);
      if (pool) {
        pool.activeWorkers.delete(workerId);
      }
      this.workers.delete(workerId);

      // Resolve shutdown promise to unblock any waiting callers
      if (worker.shutdownResolve) {
        worker.shutdownResolve();
      }

      this.logger.log(`[${workerId}] Worker cleanup complete after crash`);
    });
  }

  /**
   * Stop worker pool for a node
   *
   * Gracefully stops all workers for a node after current jobs complete.
   * Will not interrupt running jobs.
   *
   * ISSUE #10 FIX: Wrapped in mutex lock to prevent concurrent modifications
   *
   * @param nodeId - Node unique identifier
   * @param workerId - Optional specific worker ID to stop (if not provided, stops all workers for node)
   */
  async stopWorker(nodeId: string, workerId?: string): Promise<void> {
    // ISSUE #10 FIX: Acquire lock before modifying pool
    await this.acquirePoolLock(nodeId);

    try {
      const pool = this.workerPools.get(nodeId);

      if (!pool) {
        this.logger.warn(`No worker pool found for node ${nodeId}`);
        return;
      }

      if (workerId) {
        // Stop specific worker
        const worker = this.workers.get(workerId);
        if (!worker) {
          this.logger.warn(`Worker ${workerId} not found`);
          return;
        }

        this.logger.log(`Stopping worker ${workerId}...`);

        // Signal worker to stop
        worker.isRunning = false;

        // Wait for current job to complete
        if (worker.currentJobId) {
          this.logger.log(
            `Waiting for worker ${workerId} to complete job ${worker.currentJobId}...`
          );
          await worker.shutdownPromise;
          this.logger.log(`Worker ${workerId} completed its job and stopped gracefully`);
        } else {
          await worker.shutdownPromise;
          this.logger.log(`Worker ${workerId} stopped gracefully`);
        }

        // Clean up worker state
        this.workers.delete(workerId);
        pool.activeWorkers.delete(workerId);
      } else {
        // Stop all workers for this node
        this.logger.log(`Stopping all ${pool.activeWorkers.size} worker(s) for node ${nodeId}...`);

        const shutdownPromises: Promise<void>[] = [];

        for (const wId of pool.activeWorkers) {
          const worker = this.workers.get(wId);
          if (worker) {
            // Signal worker to stop
            worker.isRunning = false;

            if (worker.currentJobId) {
              this.logger.log(
                `Waiting for worker ${wId} to complete job ${worker.currentJobId}...`
              );
            }

            shutdownPromises.push(worker.shutdownPromise!);
          }
        }

        // Wait for all workers to complete their current jobs
        await Promise.all(shutdownPromises);
        this.logger.log(`All workers for node ${nodeId} stopped gracefully`);

        // Clean up worker states
        for (const wId of pool.activeWorkers) {
          this.workers.delete(wId);
        }

        // Clear the pool
        pool.activeWorkers.clear();
        this.workerPools.delete(nodeId);
      }
    } finally {
      // ISSUE #10 FIX: Always release lock, even on error
      this.releasePoolLock(nodeId);
    }
  }

  /**
   * Process next job for a worker
   *
   * Gets the next available job from queue and processes it.
   * Respects concurrent job limits from license configuration.
   *
   * @param workerId - Unique worker identifier
   * @returns Processed job or null if none available
   */
  async processNextJob(workerId: string): Promise<JobWithPolicy | null> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      this.logger.error(`Worker ${workerId} not found`);
      return null;
    }

    const nodeId = worker.nodeId;

    try {
      // Get next job from queue (respects concurrent limits)
      // CRITICAL FIX: Use QueueService directly since we only start workers for the current node
      // DataAccessService is only for LINKED nodes calling MAIN node's API
      this.logger.debug(`[${workerId}] 🔍 MULTI-NODE: Polling for next job (nodeId: ${nodeId})`);

      const job = await this.queueService.getNextJob(nodeId);

      if (!job) {
        this.logger.debug(`[${workerId}] 🔍 MULTI-NODE: No job available for nodeId: ${nodeId}`);
        return null;
      }

      this.logger.log(
        `[${workerId}] ✅ MULTI-NODE: Got job ${job.id} (${job.fileLabel}) assigned to nodeId: ${nodeId}`
      );

      // AV1 THROTTLING: Log throttling status if job is resource-throttled
      const jobWithThrottle = job as any;
      if (jobWithThrottle.resourceThrottled) {
        this.logger.warn(`[${job.id}] RESOURCE THROTTLED JOB STARTING`);
        this.logger.warn(`[${job.id}] Reason: ${jobWithThrottle.resourceThrottleReason}`);
        this.logger.warn(`[${job.id}] FFmpeg threads: ${jobWithThrottle.ffmpegThreads}`);
        if (jobWithThrottle.warning) {
          this.logger.warn(`[${job.id}] Warning: ${jobWithThrottle.warning}`);
        }
      }

      // Update worker state
      worker.currentJobId = job.id;

      try {
        // Verify source file exists
        if (!fs.existsSync(job.filePath)) {
          const dirExists = fs.existsSync(path.dirname(job.filePath));
          let errorMessage = `Source file not found: ${job.filePath}`;

          if (!dirExists) {
            errorMessage += `\n\nThe parent directory does not exist. This could indicate:`;
            errorMessage += `\n- The library path was unmounted or removed`;
            errorMessage += `\n- Network share disconnected`;
            errorMessage += `\n- Directory permissions changed`;
          } else {
            errorMessage += `\n\nThe file may have been:`;
            errorMessage += `\n- Moved or renamed by another process`;
            errorMessage += `\n- Deleted before encoding could start`;
            errorMessage += `\n- Located on a network share that disconnected`;
          }

          throw new Error(errorMessage);
        }

        // Perform resource preflight checks
        await this.performResourcePreflightChecks(job);

        // Perform encoding
        const result = await this.encodeFile(job);

        // Handle successful completion
        await this.handleJobCompletion(job, result);

        return job;
      } catch (error) {
        // Handle failure with retry logic
        await this.handleJobFailure(job, error);
        return null;
      } finally {
        // Clear current job
        worker.currentJobId = null;
      }
    } catch (error) {
      // BULLETPROOF FIX: Log full error details including stack trace
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `[${workerId}] Error processing job: ${errorMessage}`,
        errorStack || 'No stack trace available'
      );

      // Log additional error context if available
      if (error && typeof error === 'object') {
        this.logger.error(`[${workerId}] Error details:`, JSON.stringify(error, null, 2));
      }

      return null;
    }
  }

  /**
   * Handle job completion
   *
   * Updates job statistics, metrics, and library totals.
   *
   * @param job - Completed job
   * @param result - Job result with file sizes
   */
  async handleJobCompletion(job: JobWithPolicy, result: JobResult): Promise<void> {
    this.logger.log(`Job ${job.id} completed successfully`);

    try {
      // Update job to completed status
      await this.queueService.completeJob(job.id, {
        afterSizeBytes: result.afterSizeBytes.toString(),
        savedBytes: result.savedBytes.toString(),
        savedPercent: result.savedPercent,
      });

      // Update library statistics
      await this.updateLibraryStats(job.libraryId, result.savedBytes);

      this.logger.log(
        `Job ${job.id} saved ${this.formatBytes(Number(result.savedBytes))} (${result.savedPercent.toFixed(2)}%)`
      );
    } catch (error) {
      this.logger.error(`Error completing job ${job.id}:`, error);
      throw error;
    }
  }

  /**
   * Handle job failure
   *
   * HIGH PRIORITY FIX: Clearer exponential backoff with 1-based attempt numbering
   * CRITICAL FIX: Detect non-retriable errors (corrupted source files)
   *
   * Implements retry logic with exponential backoff (max 3 retries).
   * Backoff delays:
   * - Attempt 1 (retry after 1st failure): 1 min delay
   * - Attempt 2 (retry after 2nd failure): 2 min delay
   * - Attempt 3 (retry after 3rd failure): 4 min delay
   * - After 3 attempts (4th failure): Job marked as FAILED
   *
   * @param job - Failed job
   * @param error - Error that caused failure
   */
  async handleJobFailure(job: JobWithPolicy, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error(`Job ${job.id} failed: ${errorMessage}`);

    try {
      // CRITICAL FIX: Check if error indicates corrupted source file (non-retriable)
      const isNonRetriable = this.isNonRetriableError(errorMessage);

      // Check if this is a transient error that should be retried
      const shouldRetry = !isNonRetriable && this.isTransientError(errorMessage);

      // HIGH PRIORITY FIX: Use 1-based attempt numbering for clarity
      // currentAttempt = 0 means first attempt, 1 = second attempt, etc.
      const currentAttempt = job.retryCount || 0;
      const nextAttempt = currentAttempt + 1;
      const totalAttempts = currentAttempt + 1; // Total attempts SO FAR (including this failure)

      if (shouldRetry && nextAttempt <= this.MAX_RETRIES) {
        // Calculate exponential backoff delay
        // HIGH PRIORITY FIX: Clearer calculation
        // Base delay: 60 seconds, multiplied by 2^(attempt - 1)
        // Attempt 1: 60 * 2^0 = 60s (1 min)
        // Attempt 2: 60 * 2^1 = 120s (2 min)
        // Attempt 3: 60 * 2^2 = 240s (4 min)
        const baseDelaySeconds = 60;
        const delaySeconds = baseDelaySeconds * 2 ** currentAttempt;
        const nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
        const delayMinutes = Math.floor(delaySeconds / 60);

        this.logger.log(
          `Retrying job ${job.id}: Attempt ${totalAttempts} of ${this.MAX_RETRIES} failed. ` +
            `Next retry (attempt ${nextAttempt}) in ${delayMinutes} minute(s) at ${nextRetryAt.toISOString()}`
        );

        // Update job with retry information
        // MULTI-NODE: Use QueueService proxy to support LINKED nodes
        await this.queueService.update(job.id, {
          stage: 'QUEUED',
          progress: 0,
          retryCount: nextAttempt,
          nextRetryAt,
          error: `Attempt ${totalAttempts}/${this.MAX_RETRIES} failed: ${errorMessage}. Retrying in ${delayMinutes}min...`,
        });
      } else {
        // Mark job as failed
        let failureReason: string;
        if (isNonRetriable) {
          failureReason = `Non-retriable error (corrupted source file): ${errorMessage}`;
          this.logger.error(`Job ${job.id} permanently failed - corrupted source file detected`);
        } else if (shouldRetry) {
          failureReason = `All ${this.MAX_RETRIES} retry attempts exhausted (${totalAttempts} total failures). Last error: ${errorMessage}`;
        } else {
          failureReason = `Non-retriable error after ${totalAttempts} attempt(s): ${errorMessage}`;
        }

        this.logger.error(`Job ${job.id} permanently failed: ${failureReason}`);
        await this.queueService.failJob(job.id, failureReason);
      }
    } catch (updateError) {
      this.logger.error(`Error updating failed job ${job.id}:`, updateError);
    }
  }

  /**
   * Perform resource preflight checks before starting encoding
   *
   * Verifies system has sufficient resources to complete the encoding job:
   * - File is readable
   * - Sufficient disk space (source file size + 20% buffer + 5GB minimum)
   * - Sufficient free memory (at least 10% RAM available)
   *
   * @param job - Job to check resources for
   * @throws Error if resources are insufficient
   * @private
   */
  private async performResourcePreflightChecks(job: JobWithPolicy): Promise<void> {
    const checks: string[] = [];

    // Check 1: File accessibility (read permissions)
    try {
      await fs.promises.access(job.filePath, fs.constants.R_OK);
      checks.push('✓ File readable');
    } catch (_error) {
      throw new Error(
        `Cannot read source file: ${job.filePath}\n\n` +
          `Possible causes:\n` +
          `- File permissions deny read access\n` +
          `- File is locked by another process\n` +
          `- Network share disconnected`
      );
    }

    // Check 2: Disk space availability
    const fileStats = await fs.promises.stat(job.filePath);
    const fileSizeBytes = fileStats.size;
    const outputDir = path.dirname(job.filePath);

    try {
      // Get filesystem stats for the output directory
      const stats = await fs.promises.statfs(outputDir);
      const availableBytes = stats.bavail * stats.bsize; // Available blocks * block size
      const availableGB = availableBytes / 1024 ** 3;

      // Calculate required space: file size + 20% buffer (for encoding overhead)
      const requiredBytes = fileSizeBytes * (1 + this.DISK_SPACE_BUFFER_PERCENT / 100);
      const requiredGB = requiredBytes / 1024 ** 3;

      // Need at least the required space OR minimum 5GB, whichever is larger
      const minimumRequiredBytes = Math.max(requiredBytes, this.MIN_FREE_DISK_SPACE_GB * 1024 ** 3);
      const minimumRequiredGB = minimumRequiredBytes / 1024 ** 3;

      if (availableBytes < minimumRequiredBytes) {
        throw new Error(
          `Insufficient disk space on ${outputDir}\n\n` +
            `Available: ${availableGB.toFixed(2)} GB\n` +
            `Required: ${minimumRequiredGB.toFixed(2)} GB (source file + ${this.DISK_SPACE_BUFFER_PERCENT}% buffer)\n` +
            `Minimum: ${this.MIN_FREE_DISK_SPACE_GB} GB\n\n` +
            `Please free up disk space before retrying this job.`
        );
      }

      checks.push(
        `✓ Disk space sufficient (${availableGB.toFixed(1)}GB available, ${requiredGB.toFixed(1)}GB needed)`
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('Insufficient disk space')) {
        throw error; // Re-throw our custom error
      }
      // If statfs fails, log warning but don't fail the job
      this.logger.warn(`Could not check disk space for ${outputDir}: ${error}`);
      checks.push('⚠ Disk space check skipped (statfs unavailable)');
    }

    // Check 3: Memory availability
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const freeMemoryPercent = (freeMemory / totalMemory) * 100;
    const freeMemoryGB = freeMemory / 1024 ** 3;

    if (freeMemoryPercent < this.MIN_FREE_MEMORY_PERCENT) {
      this.logger.warn(
        `Low memory warning: ${freeMemoryGB.toFixed(2)}GB (${freeMemoryPercent.toFixed(1)}%) free. ` +
          `Job may be slower or fail if system runs out of memory.`
      );
      checks.push(
        `⚠ Low memory (${freeMemoryGB.toFixed(1)}GB / ${freeMemoryPercent.toFixed(1)}% free)`
      );
    } else {
      checks.push(
        `✓ Memory sufficient (${freeMemoryGB.toFixed(1)}GB / ${freeMemoryPercent.toFixed(1)}% free)`
      );
    }

    // Log all checks
    this.logger.log(`Resource preflight checks for job ${job.id}:\n  ${checks.join('\n  ')}`);
  }

  /**
   * Encode a file using FFmpeg with atomic replacement
   *
   * @param job - Job to encode
   * @returns Job result with file sizes
   * @private
   */
  private async encodeFile(job: JobWithPolicy): Promise<JobResult> {
    const beforeSizeBytes = BigInt(fs.statSync(job.filePath).size);

    // Create temporary output path
    // CRITICAL: Use stable temp filename (job.id only) so TRUE RESUME works across restarts
    const outputName = path.basename(job.filePath);

    // PERF: Use cache pool (SSD) for temp files if available, otherwise use source directory
    const tmpPath = this.ENCODING_TEMP_PATH
      ? path.join(this.ENCODING_TEMP_PATH, `.${outputName}.tmp-${job.id}`)
      : path.join(path.dirname(job.filePath), `.${outputName}.tmp-${job.id}`);

    try {
      const policy = job.policy;
      if (!policy) {
        throw new Error('Job policy not loaded');
      }

      // TRUE RESUME: Save temp file path to database BEFORE encoding starts
      // This allows auto-heal to find the temp file after restart
      // MULTI-NODE: Use QueueService proxy to support LINKED nodes
      await this.queueService.update(job.id, { tempFilePath: tmpPath });

      // BULLETPROOF FIX: Validate temp file state BEFORE attempting resume
      // If tempFilePath is set but file doesn't exist, clear resume state and start fresh
      if (job.tempFilePath && !fs.existsSync(job.tempFilePath)) {
        this.logger.warn(
          `⚠️  TEMP FILE LOST: Job ${job.id} has tempFilePath="${job.tempFilePath}" but file doesn't exist. Clearing resume state and starting fresh.`
        );

        // Reset job to fresh QUEUED state
        // MULTI-NODE: Use QueueService proxy to support LINKED nodes
        await this.queueService.update(job.id, {
          tempFilePath: tmpPath, // Set new temp path
          resumeTimestamp: null,
          progress: 0,
          autoHealedAt: null,
          autoHealedProgress: null,
        });

        // Reload job with cleared state
        job.tempFilePath = tmpPath;
        job.resumeTimestamp = null;
        job.progress = 0;
      }

      // TRUE RESUME: Check if job has resume state from auto-heal
      let startedFromSeconds: number | undefined;
      const jobWithResume = job as any;

      if (job.progress > 0 && fs.existsSync(tmpPath) && jobWithResume.resumeTimestamp) {
        this.logger.log(
          `  🔄 TRUE RESUME: Job has ${job.progress.toFixed(1)}% progress and resumeTimestamp=${jobWithResume.resumeTimestamp}`
        );

        try {
          // Parse the HH:MM:SS format resumeTimestamp to seconds
          const parts = jobWithResume.resumeTimestamp.split(':');
          if (parts.length === 3) {
            const hours = Number.parseInt(parts[0], 10);
            const minutes = Number.parseInt(parts[1], 10);
            const seconds = Number.parseFloat(parts[2]);
            startedFromSeconds = Math.floor(hours * 3600 + minutes * 60 + seconds);

            this.logger.log(
              `  ✅ TRUE RESUME: Using resumeTimestamp from auto-heal: ${jobWithResume.resumeTimestamp} (${startedFromSeconds}s = ${job.progress.toFixed(1)}%)`
            );
          } else {
            this.logger.warn(
              `  ⚠️  TRUE RESUME: Invalid resumeTimestamp format: ${jobWithResume.resumeTimestamp}`
            );
          }
        } catch (error) {
          this.logger.warn(`  ⚠️  TRUE RESUME: Error parsing resumeTimestamp:`, error);
          // Continue without resume - will restart from 0%
        }
      } else if (job.progress > 0 && fs.existsSync(tmpPath) && !jobWithResume.resumeTimestamp) {
        // Fallback: Calculate resume position if temp file exists but no resumeTimestamp
        this.logger.log(
          `  🔄 TRUE RESUME: Job has ${job.progress.toFixed(1)}% progress but no resumeTimestamp, calculating...`
        );

        try {
          // Get video duration to calculate exact resume position
          const durationSeconds = await this.ffmpegService.getVideoDuration(job.filePath);

          if (durationSeconds > 0) {
            startedFromSeconds = Math.floor((job.progress / 100) * durationSeconds);

            // Convert seconds to HH:MM:SS format for resumeTimestamp field
            const hours = Math.floor(startedFromSeconds / 3600);
            const minutes = Math.floor((startedFromSeconds % 3600) / 60);
            const seconds = startedFromSeconds % 60;
            const resumeTimestamp = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

            // Update database with resume position (using existing resumeTimestamp field)
            // MULTI-NODE: Use QueueService proxy to support LINKED nodes
            await this.queueService.update(job.id, { resumeTimestamp });

            this.logger.log(
              `  ✅ TRUE RESUME: Calculated resumeTimestamp: ${resumeTimestamp} (${startedFromSeconds}s = ${job.progress.toFixed(1)}% of ${durationSeconds}s total)`
            );
          } else {
            this.logger.warn(
              `  ⚠️  TRUE RESUME: Could not determine video duration, starting from beginning`
            );
          }
        } catch (error) {
          this.logger.warn(`  ⚠️  TRUE RESUME: Error calculating resume position:`, error);
          // Continue without resume - will restart from 0%
        }
      }

      // Perform encoding
      await this.performEncoding(job, tmpPath, policy, startedFromSeconds);

      // Verify output if enabled
      if (policy.verifyOutput) {
        await this.verifyEncodedFile(tmpPath);
      }

      // Calculate file size changes
      const afterSizeBytes = BigInt(fs.statSync(tmpPath).size);
      const { savedBytes, savedPercent } = this.calculateSavings(beforeSizeBytes, afterSizeBytes);

      // HIGH PRIORITY FIX: Verify disk space before atomic replacement
      // During atomic replacement, we temporarily have BOTH original + encoded file
      // So we need space for both files simultaneously
      await this.verifyDiskSpaceForReplacement(
        job.filePath,
        tmpPath,
        beforeSizeBytes,
        afterSizeBytes
      );

      // Replace original file with encoded version (with Keep Original support)
      await this.replaceFile(job, tmpPath, policy.atomicReplace);

      return {
        beforeSizeBytes,
        afterSizeBytes,
        savedBytes,
        savedPercent,
      };
    } catch (error) {
      // TRUE RESUME: Only delete temp file on validation/corruption errors
      // Keep temp file for resumable errors (interrupts, crashes, EXDEV, etc.)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isCorruptionError =
        errorMessage.includes('verification failed') ||
        errorMessage.includes('corrupted') ||
        errorMessage.includes('not playable') ||
        errorMessage.includes('invalid');

      if (isCorruptionError) {
        this.logger.warn(`Temp file corrupted or invalid, deleting for fresh restart: ${tmpPath}`);
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } else {
        this.logger.log(`Keeping temp file for auto-heal resume capability: ${tmpPath}`);
      }
      throw error;
    } finally {
      // MEMORY LEAK FIX: Always clean up temp files that aren't needed for resume
      // Only skip cleanup if this is a resumable error AND temp file should be preserved
      // This prevents disk space leaks from failed encodings
      if (tmpPath && fs.existsSync(tmpPath)) {
        // Check if temp file should be preserved for resume (only for encoding failures)
        const shouldPreserve = job.tempFilePath === tmpPath && job.progress > 0;

        if (!shouldPreserve) {
          try {
            fs.unlinkSync(tmpPath);
            this.logger.debug(`Cleaned up temp file: ${tmpPath}`);
          } catch (cleanupError) {
            this.logger.warn(`Failed to clean temp file ${tmpPath}:`, cleanupError);
          }
        }
      }
    }
  }

  /**
   * Perform FFmpeg encoding on a file
   * @private
   */
  private async performEncoding(
    job: JobWithPolicy,
    tmpPath: string,
    policy: JobWithPolicy['policy'],
    startedFromSeconds?: number
  ): Promise<void> {
    if (!policy) {
      throw new Error('Policy is required for encoding');
    }

    const advancedSettings = policy.advancedSettings as Record<string, unknown> | null;
    const hwaccel =
      advancedSettings && typeof advancedSettings === 'object' && 'hwaccel' in advancedSettings
        ? String(advancedSettings.hwaccel)
        : 'auto';

    await this.ffmpegService.encode(job.id, {
      inputPath: job.filePath,
      outputPath: tmpPath,
      targetCodec: policy.targetCodec,
      targetQuality: policy.targetQuality,
      hwAccel: hwaccel,
      advancedSettings: advancedSettings ?? undefined,
      startedFromSeconds, // TRUE RESUME: Pass resume position to FFmpeg
    });
  }

  /**
   * Verify encoded file is playable WITH ROCK SOLID RETRIES
   * @private
   */
  private async verifyEncodedFile(tmpPath: string): Promise<void> {
    this.logger.log(
      `ROCK SOLID: Waiting 5 seconds for filesystem flush after FFmpeg completion...`
    );
    await this.sleep(5000);

    // ROCK SOLID: Retry verification with exponential backoff (max 10 attempts)
    const maxRetries = 10;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.ffmpegService.verifyFile(tmpPath);

      if (result.isValid) {
        if (attempt > 1) {
          this.logger.log(`✓ ROCK SOLID: File verified successfully after ${attempt} attempt(s)`);
        }
        return; // Success!
      }

      // File verification failed
      if (attempt < maxRetries) {
        const backoffMs = Math.min(2000 * 2 ** (attempt - 1), 32000);
        this.logger.warn(
          `ROCK SOLID: Verification attempt ${attempt}/${maxRetries} failed: ${result.error}. ` +
            `Retrying in ${backoffMs}ms...`
        );
        await this.sleep(backoffMs);
      } else {
        // Final attempt failed
        throw new Error(
          `ROCK SOLID: Verification failed after ${maxRetries} attempts. Last error: ${result.error || 'File is not playable'}`
        );
      }
    }
  }

  /**
   * Sleep helper for ROCK SOLID retries
   * @private
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculate space savings from encoding
   * @private
   */
  private calculateSavings(
    beforeSizeBytes: bigint,
    afterSizeBytes: bigint
  ): { savedBytes: bigint; savedPercent: number } {
    const savedBytes = beforeSizeBytes - afterSizeBytes;
    const savedPercent = Number((savedBytes * BigInt(10000)) / beforeSizeBytes) / 100;
    return { savedBytes, savedPercent };
  }

  /**
   * HIGH PRIORITY FIX: Verify disk space before atomic replacement
   *
   * During atomic replacement, we temporarily have BOTH files:
   * 1. Original file renamed to .backup
   * 2. Temp file renamed to original location
   * 3. Backup deleted
   *
   * We need enough space for both original + temp file simultaneously.
   *
   * @private
   */
  private async verifyDiskSpaceForReplacement(
    originalPath: string,
    tmpPath: string,
    originalSize: bigint,
    tmpSize: bigint
  ): Promise<void> {
    const outputDir = path.dirname(originalPath);

    try {
      const stats = await fs.promises.statfs(outputDir);
      const availableBytes = stats.bavail * stats.bsize;
      const availableGB = availableBytes / 1024 ** 3;

      // Calculate space needed for atomic replacement
      // We need space for BOTH files temporarily (during rename operations)
      const spaceNeededBytes = Number(originalSize) + Number(tmpSize);

      // Add 1GB safety buffer
      const requiredBytes = spaceNeededBytes + 1024 ** 3;
      const requiredGB = requiredBytes / 1024 ** 3;

      if (availableBytes < requiredBytes) {
        throw new Error(
          `Insufficient disk space for atomic file replacement on ${outputDir}\n\n` +
            `Available: ${availableGB.toFixed(2)} GB\n` +
            `Required: ${requiredGB.toFixed(2)} GB (original + encoded + 1GB safety buffer)\n` +
            `Original file: ${(Number(originalSize) / 1024 ** 3).toFixed(2)} GB\n` +
            `Encoded file: ${(Number(tmpSize) / 1024 ** 3).toFixed(2)} GB\n\n` +
            `During atomic replacement, both files exist temporarily.\n` +
            `Please free up disk space before retrying this job.`
        );
      }

      this.logger.log(
        `Disk space check passed: ${availableGB.toFixed(2)}GB available, ` +
          `${requiredGB.toFixed(2)}GB needed for atomic replacement`
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('Insufficient disk space')) {
        throw error; // Re-throw our custom error
      }
      // If statfs fails, log warning but don't fail the job
      this.logger.warn(`Could not check disk space for replacement on ${outputDir}: ${error}`);
    }
  }

  /**
   * Replace original file with encoded version
   *
   * KEEP ORIGINAL FEATURE: If user requested to keep original via "Keep Original" button,
   * rename original to .original instead of deleting it
   *
   * @private
   */
  private async replaceFile(
    job: JobWithPolicy,
    tmpPath: string,
    atomicReplace: boolean
  ): Promise<void> {
    const jobData = job as any; // Access keepOriginalRequested field
    const originalPath = job.filePath;

    // KEEP ORIGINAL FEATURE: Check if user requested to keep the original file
    if (jobData.keepOriginalRequested) {
      // User clicked "Keep Original" - rename original to .original and keep both files
      const originalBackupPath = `${originalPath}.original`;

      this.logger.log(`KEEP ORIGINAL: Renaming original to ${originalBackupPath}`);
      this.crossFsSafeRenameSync(originalPath, originalBackupPath);
      this.crossFsSafeRenameSync(tmpPath, originalPath);

      // Update job with backup info
      await this.queueService.update(job.id, {
        originalBackupPath,
        originalSizeBytes: job.beforeSizeBytes,
        replacementAction: 'KEPT_BOTH',
      });

      this.logger.log(`KEEP ORIGINAL: Successfully kept original as backup`);
    } else {
      // Default behavior: replace original file (delete it)
      if (atomicReplace) {
        this.atomicReplaceFile(originalPath, tmpPath);
      } else {
        this.crossFsSafeRenameSync(tmpPath, originalPath);
      }

      // Mark as replaced
      await this.queueService.update(job.id, {
        replacementAction: 'REPLACED',
      });

      this.logger.log('Original file replaced with encoded version');
    }
  }

  /**
   * Cross-filesystem-safe rename operation
   *
   * CRITICAL FIX: Handle EXDEV error when renaming across different filesystems
   *
   * Node.js fs.rename() uses the POSIX rename() system call which only works
   * within the same filesystem. When source and dest are on different filesystems
   * (e.g., /cache SSD and /unraid-media array), rename() fails with EXDEV error.
   *
   * This helper automatically falls back to copy+delete when rename fails with EXDEV.
   *
   * @param sourcePath - Source file path
   * @param destPath - Destination file path
   * @private
   */
  private crossFsSafeRenameSync(sourcePath: string, destPath: string): void {
    try {
      // Attempt fast rename (works if same filesystem)
      fs.renameSync(sourcePath, destPath);
    } catch (error) {
      // Check if error is EXDEV (cross-device link not permitted)
      if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
        this.logger.warn(
          `Cross-filesystem rename detected (${sourcePath} -> ${destPath}), ` +
            `falling back to copy+delete`
        );

        try {
          // Fallback: Copy file to destination
          fs.copyFileSync(sourcePath, destPath);

          // Verify copy succeeded by checking file exists
          if (!fs.existsSync(destPath)) {
            throw new Error('Copy verification failed - destination file does not exist');
          }

          // Delete source file only after successful copy
          fs.unlinkSync(sourcePath);

          this.logger.log(
            `Successfully moved file across filesystems: ${sourcePath} -> ${destPath}`
          );
        } catch (fallbackError) {
          // Clean up partial copy if it exists
          if (fs.existsSync(destPath)) {
            try {
              fs.unlinkSync(destPath);
            } catch (cleanupError) {
              this.logger.error(`Failed to cleanup partial copy: ${cleanupError}`);
            }
          }

          throw new Error(
            `Cross-filesystem move failed: ${fallbackError}. Source: ${sourcePath}, Dest: ${destPath}`
          );
        }
      } else {
        // Re-throw non-EXDEV errors
        throw error;
      }
    }
  }

  /**
   * Atomically replace file with backup on failure
   *
   * CRITICAL FIX: Proper rollback and cleanup logic with comprehensive error handling
   *
   * @private
   */
  private atomicReplaceFile(originalPath: string, tmpPath: string): void {
    const backupPath = `${originalPath}.backup`;

    try {
      // Step 1: Create backup of original file
      this.crossFsSafeRenameSync(originalPath, backupPath);

      // Step 2: Move temp file to original location
      try {
        this.crossFsSafeRenameSync(tmpPath, originalPath);

        // Step 3: Delete backup on success
        try {
          fs.unlinkSync(backupPath);
        } catch (cleanupError) {
          // Non-fatal: Log warning but don't fail the operation
          this.logger.warn(`Failed to cleanup backup file ${backupPath}: ${cleanupError}`);
        }
      } catch (replaceError) {
        // ROLLBACK: Restore backup on failure
        this.logger.error(`Failed to replace file, rolling back: ${replaceError}`);

        try {
          if (fs.existsSync(backupPath)) {
            // Delete failed temp file if it exists
            if (fs.existsSync(originalPath)) {
              fs.unlinkSync(originalPath);
            }

            // Restore backup
            this.crossFsSafeRenameSync(backupPath, originalPath);
            this.logger.log(`Successfully rolled back to backup for ${originalPath}`);
          } else {
            this.logger.error(`Backup file missing during rollback: ${backupPath}`);
          }
        } catch (rollbackError) {
          this.logger.error(`CRITICAL: Rollback failed for ${originalPath}: ${rollbackError}`);
          // Re-throw with context about both errors
          throw new Error(
            `Atomic replacement failed and rollback also failed. ` +
              `Replace error: ${replaceError}. Rollback error: ${rollbackError}. ` +
              `Backup may still exist at: ${backupPath}`
          );
        }

        // Re-throw original error after successful rollback
        throw replaceError;
      }
    } catch (backupError) {
      // Failed to create backup - clean up temp file
      this.logger.error(`Failed to create backup: ${backupError}`);

      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch (cleanupError) {
        this.logger.warn(`Failed to cleanup temp file after backup error: ${cleanupError}`);
      }

      throw backupError;
    }
  }

  /**
   * Update library statistics after job completion
   *
   * @param libraryId - Library ID to update
   * @param savedBytes - Bytes saved by encoding
   * @private
   */
  private async updateLibraryStats(libraryId: string, savedBytes: bigint): Promise<void> {
    try {
      const library = await this.librariesService.findOne(libraryId);

      // Calculate new total size
      const newTotalSize = library.totalSizeBytes - savedBytes;

      await this.librariesService.update(libraryId, {
        totalSizeBytes: newTotalSize,
      });
    } catch (error) {
      this.logger.error(`Failed to update library stats for ${libraryId}:`, error);
      // Don't throw - library stats update failure shouldn't fail job
    }
  }

  /**
   * Processing loop for worker
   *
   * Continuously polls for new jobs while worker is running.
   * Each worker runs independently and competes for jobs from the queue.
   *
   * @param workerId - Unique worker identifier
   * @private
   */
  private async processLoop(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    this.logger.log(`[${workerId}] Started processing loop`);

    while (worker.isRunning) {
      try {
        const job = await this.processNextJob(workerId);

        if (!job) {
          // No job available, wait before polling again
          await this.sleep(5000);
        }
      } catch (error) {
        this.logger.error(`[${workerId}] Error in processing loop:`, error);
        await this.sleep(5000);
      }
    }

    this.logger.log(`[${workerId}] Stopped processing loop`);

    // Resolve shutdown promise if it exists
    if (worker.shutdownResolve) {
      worker.shutdownResolve();
    }
  }

  /**
   * CRITICAL FIX: Check if error is non-retriable (corrupted source file)
   *
   * @param errorMessage - Error message
   * @returns True if error indicates corrupted source (should NOT retry)
   * @private
   */
  private isNonRetriableError(errorMessage: string): boolean {
    const nonRetriablePatterns = [
      'non-retriable error', // Flag from FFmpeg service
      'source file appears corrupted', // Decoder errors
      'could not find ref with poc', // HEVC reference frame error
      'error submitting packet to decoder', // Decoder error
      'invalid data found when processing input', // Corrupted container
      'corrupt decoded frame', // Corrupted frame
      'missing reference picture', // Missing reference frame
      'moov atom not found', // Corrupted MP4
    ];

    const errorLower = errorMessage.toLowerCase();
    return nonRetriablePatterns.some((pattern) => errorLower.includes(pattern.toLowerCase()));
  }

  /**
   * Check if error is transient and should be retried
   *
   * @param errorMessage - Error message
   * @returns True if error is transient
   * @private
   */
  private isTransientError(errorMessage: string): boolean {
    const transientErrors = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'temporarily unavailable',
      'network',
    ];

    return transientErrors.some((err) => errorMessage.toLowerCase().includes(err.toLowerCase()));
  }

  /**
   * Format bytes to human-readable string
   *
   * @param bytes - Bytes to format
   * @returns Formatted string (e.g., "1.5 GB")
   * @private
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  }
}
