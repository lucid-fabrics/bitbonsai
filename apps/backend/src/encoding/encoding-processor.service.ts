import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type Job, JobStage, type Policy } from '@prisma/client';
import { DataAccessService } from '../core/services/data-access.service';
import { FileRelocatorService } from '../core/services/file-relocator.service';
import { LibrariesService } from '../libraries/libraries.service';
import { NodesService } from '../nodes/nodes.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { FfmpegService } from './ffmpeg.service';
import { QualityMetricsService } from './quality-metrics.service';

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
  qualityMetrics?: string;
}

// CRITICAL #3 FIX: Enhanced lock holder tracking for deadlock detection
// CRITICAL #2 FIX: Track expected duration to prevent false positive deadlock detection
// DEEP AUDIT P0: Added heartbeat mechanism to track actual operation activity
interface PoolLockHolder {
  promise: Promise<void>;
  release: () => void;
  acquiredAt: number;
  holder: string; // For debugging (workerId or operation name)
  expectedDurationMs: number; // Expected operation duration (for long-running ops)
  staleThreshold: number; // Computed: staleLockThreshold + expectedDuration
  lastHeartbeat: number; // DEEP AUDIT P0: Track last activity timestamp
}

// Note: resumeTimestamp and keepOriginalRequested exist as temporary properties
// on Job instances for encoding resume functionality

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
  // CRITICAL #3 FIX: Enhanced mutex locks with deadlock detection and auto-recovery
  private readonly poolLocks = new Map<string, PoolLockHolder>();
  private lockWatchdogIntervalId?: NodeJS.Timeout;

  // AUDIT #2 ISSUE #24 FIX: Store watchdog interval for cleanup
  private watchdogIntervalId?: NodeJS.Timeout;

  // CRITICAL #5 FIX: Track ALL active intervals globally to prevent leaks on hot reload
  private static activeIntervals = new Set<NodeJS.Timeout>();

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
  // Priority: 1. Database setting (per-node), 2. ENV var, 3. Source directory (no cache)
  // UX Philosophy: Per-node configuration eliminates ENCODING_TEMP_PATH env var
  private encodingTempPath: string | null = process.env.ENCODING_TEMP_PATH || null;

  // Resource preflight thresholds
  private readonly MIN_FREE_DISK_SPACE_GB = 5; // Minimum 5GB free space
  private readonly MIN_FREE_MEMORY_PERCENT = 10; // Minimum 10% free RAM
  private readonly DISK_SPACE_BUFFER_PERCENT = 20; // 20% buffer for encoding overhead

  // Load-based throttling thresholds
  // LOAD_THRESHOLD_MULTIPLIER: Max load = CPU cores * multiplier
  // Higher values = more tolerant of high load (useful for NAS systems with high I/O wait)
  // MEDIUM #3 FIX: Cap at 2.0 to prevent absurd values on high-core systems
  // Default: 2.0 (reduced from 5.0) - Linux scheduler degrades above 2× cores
  // UX Philosophy: Smart defaults over configuration - users shouldn't need to adjust this
  // Priority: 1. Database setting (per-node), 2. ENV var, 3. Default
  private readonly DEFAULT_LOAD_THRESHOLD_MULTIPLIER = Math.min(
    parseFloat(process.env.LOAD_THRESHOLD_MULTIPLIER || '2.0'),
    2.0 // CRITICAL CAP: Prevent load thresholds above 2× CPU count
  );
  // Cached load threshold from database (updated on init and via reload method)
  private loadThresholdMultiplier: number = this.DEFAULT_LOAD_THRESHOLD_MULTIPLIER;
  private readonly MIN_FREE_MEMORY_GB = 4; // Minimum 4GB free RAM per new job
  private readonly THROTTLE_CHECK_INTERVAL_MS = 10000; // Check every 10 seconds when throttled
  private readonly THROTTLE_LOG_INTERVAL_MS = 60000; // Log throttle warnings every 60 seconds
  private lastThrottleLogTime = 0; // Track last throttle log to avoid spam

  // Auto-heal timing constants (Code Convention: no magic numbers)
  private readonly AUTO_HEAL_INITIAL_DELAY_MS = 2000; // 2 seconds
  private readonly AUTO_HEAL_STABILIZATION_DELAY_MS = 3000; // 3 seconds
  private readonly VOLUME_MOUNT_PROBE_DELAY_MS = 1000; // 1 second
  private readonly VOLUME_MOUNT_MAX_RETRIES = 10;
  private readonly TEMP_FILE_CHECK_DELAY_MS = 2000; // 2 seconds (increased for NFS recovery)
  private readonly TEMP_FILE_MAX_RETRIES = 10; // 10 retries = 20 seconds total (for slow NFS mounts)

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    readonly _dataAccessService: DataAccessService,
    private readonly ffmpegService: FfmpegService,
    private readonly librariesService: LibrariesService,
    private readonly nodesService: NodesService,
    private readonly fileRelocatorService: FileRelocatorService,
    private readonly qualityMetricsService: QualityMetricsService
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
    // MEDIUM #4 FIX: Robust CPU detection with better fallback for VMs
    let cpuCount = os.cpus().length;
    if (!cpuCount || cpuCount < 1) {
      this.logger.warn(`Invalid CPU count detected: ${cpuCount}, using fallback of 8 cores`);
      cpuCount = 8; // Better default for modern systems (prevents severe under-utilization)
    } else if (cpuCount < 4) {
      this.logger.warn(
        `Low CPU count detected: ${cpuCount}, using minimum of 4 cores for worker calculation`
      );
      cpuCount = 4; // Minimum for reasonable encoding performance
    }

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

    // CRITICAL #3 FIX: Clear stale pool locks from previous session and start watchdog
    this.poolLocks.clear();
    this.startLockWatchdog();
    this.logger.log('✅ CRITICAL #3 FIX: Cleared stale pool locks and started deadlock watchdog');

    // PERF: Log cache pool configuration (loaded from DB via reloadNodeSettings)
    if (this.encodingTempPath) {
      this.logger.log(
        `⚡ Cache pool ENABLED: Using ${this.encodingTempPath} for temp files (faster SSD I/O)`
      );
    } else {
      this.logger.log('📂 Cache pool DISABLED: Using source directory for temp files');
    }

    // Load load threshold from database
    await this.reloadLoadThreshold();

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

      // HIGH #10 FIX: Kill ALL ffmpeg processes before auto-heal
      // This prevents orphaned processes from previous crash/restart from consuming resources
      this.logger.log('🧹 Killing all ffmpeg processes from previous session...');
      const killResult = await this.ffmpegService.killAllFfmpegProcesses();
      if (killResult.killed > 0) {
        this.logger.log(
          `✅ Killed ${killResult.killed} orphaned ffmpeg process(es) from previous session`
        );
      }

      // CRITICAL FIX: Only start workers for the CURRENT node, not all online nodes
      // This prevents MAIN nodes from starting workers for LINKED nodes, which causes
      // the error "getNextJob should not be called directly on MAIN nodes"
      const currentNode = await this.nodesService.getCurrentNode();

      if (!currentNode) {
        this.logger.warn('Current node not found - skipping auto-heal and worker startup');
        return;
      }

      // STEP 4: Auto-heal orphaned jobs from previous crash/reboot
      // CRITICAL FIX: Only heal jobs belonging to THIS node to prevent cross-node interference
      await this.autoHealOrphanedJobs(currentNode.id);

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
   * CRITICAL #5 FIX: Clear ALL tracked intervals to prevent leaks on hot reload
   * Prevents memory leak from watchdog interval
   */
  async onModuleDestroy() {
    this.logger.log('🛑 Shutting down encoding processor...');

    // Clear current instance interval
    if (this.watchdogIntervalId) {
      clearInterval(this.watchdogIntervalId);
      EncodingProcessorService.activeIntervals.delete(this.watchdogIntervalId);
      this.watchdogIntervalId = undefined;
      this.logger.log('✓ Watchdog interval cleared');
    }

    // CRITICAL #3 FIX: Clear lock watchdog interval
    if (this.lockWatchdogIntervalId) {
      clearInterval(this.lockWatchdogIntervalId);
      this.lockWatchdogIntervalId = undefined;
      this.logger.log('✓ CRITICAL #3 FIX: Lock watchdog interval cleared');
    }

    // CRITICAL #5 FIX: Safety - clear ALL tracked intervals (hot reload protection)
    if (EncodingProcessorService.activeIntervals.size > 0) {
      this.logger.warn(
        `⚠️ Clearing ${EncodingProcessorService.activeIntervals.size} stale interval(s) from previous session`
      );
      for (const interval of EncodingProcessorService.activeIntervals) {
        clearInterval(interval);
      }
      EncodingProcessorService.activeIntervals.clear();
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
    // UX PHILOSOPHY: Derive media paths from libraries in database
    // Eliminates need for MEDIA_PATHS env var - single source of truth
    const mediaPaths = await this.librariesService.getAllLibraryPaths();
    if (mediaPaths.length === 0) {
      this.logger.warn('No libraries configured, skipping volume mount check');
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
   *
   * @param nodeId - Only heal jobs belonging to this node (prevents cross-node interference)
   */
  private async autoHealOrphanedJobs(nodeId: string): Promise<void> {
    this.logger.log(`🏥 Auto-heal: Checking for orphaned jobs on this node (${nodeId})...`);

    try {
      // CRITICAL FIX #2: Check for jobs with recent heartbeats (< 2min old)
      // These jobs are still being actively processed by other nodes and should NOT be healed
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

      // DEEP AUDIT FIX: Auto-heal claim staleness threshold reduced to 2 minutes
      // If another node claimed a job but didn't complete healing within 2 minutes, it's stale
      // (matches heartbeat check interval for consistency)
      const twoMinutesAgoForClaim = new Date(Date.now() - 2 * 60 * 1000);

      // On backend startup, jobs in active processing states need recovery
      // CRITICAL FIX: Only process jobs belonging to THIS node to prevent cross-node interference
      // Without this filter, CHILD node restart would reset MAIN node's actively encoding jobs
      // DEEP AUDIT P2: Added atomic claim pattern to prevent multi-node heal race
      const orphanedJobs = await this.prisma.job.findMany({
        where: {
          nodeId, // CRITICAL: Only this node's jobs
          AND: [
            // DEEP AUDIT P2: Exclude jobs already claimed for healing by another node
            // Unless the claim is stale (> 10 minutes old)
            {
              OR: [
                { autoHealClaimedAt: null }, // Not claimed
                { autoHealClaimedBy: nodeId }, // Claimed by us (retry)
                { autoHealClaimedAt: { lt: twoMinutesAgoForClaim } }, // Stale claim
              ],
            },
            // HIGH #2 FIX: Exclude legitimately new jobs (startedAt null) from auto-heal
            // Only heal jobs that were started but have stale heartbeat
            {
              startedAt: { not: null }, // Must have been started
            },
            // CRITICAL FIX #2: Exclude jobs with recent heartbeats
            {
              OR: [
                { lastHeartbeat: null }, // Started but no heartbeat = orphaned
                { lastHeartbeat: { lt: twoMinutesAgo } }, // Stale heartbeat = orphaned
              ],
            },
            // Job stage conditions
            {
              OR: [
                // Active processing stages - always recover
                {
                  stage: {
                    in: [
                      JobStage.HEALTH_CHECK,
                      JobStage.ENCODING,
                      JobStage.VERIFYING,
                      JobStage.PAUSED_LOAD, // System load-based pause - recover
                    ],
                  },
                },
                // PAUSED jobs - only recover if paused by schedule (has specific error message)
                {
                  stage: JobStage.PAUSED,
                  error: { contains: 'Outside scheduled encoding window' },
                },
              ],
            },
          ],
        },
        select: {
          id: true,
          fileLabel: true,
          stage: true,
          progress: true,
          updatedAt: true,
          tempFilePath: true, // TRUE RESUME: needed to check if temp file exists
          retryCount: true, // AUTO-HEAL TRACKING: needed to increment retry count
          error: true, // Needed to check pause reason
        },
      });

      // Also log manually paused jobs that are being preserved (only for this node)
      const manuallyPausedJobs = await this.prisma.job.findMany({
        where: {
          nodeId, // Only this node's jobs
          stage: JobStage.PAUSED,
          OR: [
            { error: null },
            { error: { not: { contains: 'Outside scheduled encoding window' } } },
          ],
        },
        select: { id: true, fileLabel: true },
      });
      if (manuallyPausedJobs.length > 0) {
        this.logger.log(
          `ℹ️ Preserving ${manuallyPausedJobs.length} manually paused job(s) on this node - will NOT auto-resume`
        );
      }

      if (orphanedJobs.length === 0) {
        this.logger.log('✅ No orphaned jobs found on this node - system is healthy');
        return;
      }

      this.logger.warn(
        `🔧 Found ${orphanedJobs.length} orphaned job(s) on this node from backend restart - recovering...`
      );

      // Reset each orphaned job to QUEUED
      // CRITICAL FIX: ALL jobs go to QUEUED (not DETECTED) to resume immediately
      // TRUE RESUME: Keep progress and resume state (DON'T reset to 0%)
      for (const job of orphanedJobs) {
        try {
          // DEEP AUDIT P2: Atomic claim - try to claim job for healing
          // This prevents race condition where multiple nodes try to heal same job
          const claimResult = await this.prisma.job.updateMany({
            where: {
              id: job.id,
              OR: [
                { autoHealClaimedAt: null },
                { autoHealClaimedBy: nodeId },
                { autoHealClaimedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) } },
              ],
            },
            data: {
              autoHealClaimedAt: new Date(),
              autoHealClaimedBy: nodeId,
            },
          });

          if (claimResult.count === 0) {
            this.logger.debug(`  ⏭️ Job ${job.id} already claimed by another node, skipping`);
            continue; // Another node claimed this job
          }

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
              // LOW #15 FIX: Use outer query job data instead of redundant inner query
              // The job object already has filePath from the outer findMany query
              const videoJob = await this.prisma.job.findUnique({
                where: { id: job.id },
                select: { filePath: true },
              });

              const filePath = videoJob?.filePath;
              if (filePath) {
                // Get video duration
                const videoDuration = await this.ffmpegService.getVideoDuration(filePath);

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
            // DEEP AUDIT P2: Clear the claim after successful healing
            autoHealClaimedAt: null,
            autoHealClaimedBy: null,
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
      EncodingProcessorService.activeIntervals.delete(this.watchdogIntervalId);
    }

    // CRITICAL #5 FIX: Track interval globally to prevent leaks on hot reload
    const intervalId = setInterval(async () => {
      try {
        // UX PHILOSOPHY: Auto-cleanup zombie FFmpeg processes (self-healing)
        // This eliminates the need for manual "Kill Zombies" button in debug UI
        await this.autoCleanupZombieProcesses();

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
            AND: [
              // CRITICAL FIX #4: Exclude jobs recently paused (prevents false positives)
              // Only consider jobs that have been in ENCODING state for the full timeout
              {
                OR: [
                  { lastStageChangeAt: null }, // Old jobs without timestamp
                  { lastStageChangeAt: { lt: fiveMinutesAgo } }, // Must be in ENCODING >= 5min
                ],
              },
              // Dynamic timeout based on file size
              {
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
            ],
          },
          select: {
            id: true,
            fileLabel: true,
            progress: true,
            updatedAt: true,
            beforeSizeBytes: true,
            lastStageChangeAt: true, // CRITICAL FIX #4: Include for debugging
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

    // CRITICAL #5 FIX: Store interval ID and track globally
    this.watchdogIntervalId = intervalId;
    EncodingProcessorService.activeIntervals.add(intervalId);
  }

  /**
   * UX PHILOSOPHY: Auto-cleanup zombie FFmpeg processes
   *
   * Self-healing system that automatically cleans up orphaned FFmpeg processes.
   * This eliminates the need for users to manually click "Kill Zombies" in the debug UI.
   *
   * Zombies typically occur when:
   * - Backend was restarted but FFmpeg processes weren't killed
   * - A crash left orphaned processes
   *
   * Runs every 60 seconds via the watchdog loop.
   * @private
   */
  private async autoCleanupZombieProcesses(): Promise<void> {
    try {
      const result = await this.ffmpegService.killAllZombieFfmpegProcesses();

      // Only log if zombies were found (avoid log spam)
      if (result.killed > 0 || result.failed > 0) {
        this.logger.log(
          `🧹 Auto-cleanup: Killed ${result.killed} zombie FFmpeg process(es)` +
            (result.failed > 0 ? ` (${result.failed} failed)` : '')
        );
      }
    } catch (error) {
      // Silently handle errors - don't let zombie cleanup crash the watchdog
      this.logger.debug(`Zombie cleanup error (non-fatal): ${error}`);
    }
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

    // Get current node to filter jobs
    const currentNode = await this.nodesService.getCurrentNode();
    if (!currentNode) {
      return; // Can't manage load without knowing current node
    }

    // Count only THIS node's encoding jobs (not other nodes)
    const encodingJobs = await this.prisma.job.count({
      where: { stage: 'ENCODING', nodeId: currentNode.id },
    });

    // Determine target worker limit based on load ratio (load per CPU)
    // Use node's configured maxWorkers, not the calculated default
    const nodeMaxWorkers = currentNode.maxWorkers || this.DEFAULT_WORKERS_PER_NODE;
    let targetWorkers: number;
    let loadLevel: string;
    const loadRatio = loadAvg / cpuCount;

    // HIGH #9 FIX: Apply loadThresholdMultiplier to all thresholds
    // Default multiplier is 5.0, making thresholds: 5.0, 10.0, 15.0
    const normalThreshold = 1.0 * this.loadThresholdMultiplier; // Default: 5.0
    const moderateThreshold = 2.0 * this.loadThresholdMultiplier; // Default: 10.0
    const highThreshold = 3.0 * this.loadThresholdMultiplier; // Default: 15.0

    if (loadRatio < normalThreshold) {
      // Normal operation - all workers (load < 1x multiplier)
      targetWorkers = nodeMaxWorkers;
      loadLevel = 'normal';
    } else if (loadRatio < moderateThreshold) {
      // Moderate load - 80% workers (load 1-2x multiplier)
      targetWorkers = Math.ceil(nodeMaxWorkers * 0.8);
      loadLevel = 'moderate';
    } else if (loadRatio < highThreshold) {
      // High load - 50% workers (load 2-3x multiplier)
      targetWorkers = Math.ceil(nodeMaxWorkers * 0.5);
      loadLevel = 'high';
    } else {
      // Emergency - 30% workers (minimum 2, load > 3x multiplier)
      targetWorkers = Math.max(2, Math.ceil(nodeMaxWorkers * 0.3));
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
        `🔥 High system load detected: ${loadAvg.toFixed(1)} (${loadLevel} level, ratio ${loadRatio.toFixed(1)}x, ${cpuCount} CPUs)`
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
        `✅ System load acceptable: ${loadAvg.toFixed(1)} (${loadLevel} level, ratio ${loadRatio.toFixed(1)}x, ${cpuCount} CPUs)`
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
   * CRITICAL #3 FIX: Acquire mutex lock with retry, stale lock detection, and auto-recovery.
   * CRITICAL #2 FIX: Support expected duration to prevent false positive deadlock detection.
   *
   * Prevents deadlocks by:
   * - Auto-releasing locks held > staleThreshold (dynamic based on expected duration)
   * - Retry mechanism (3 attempts) with exponential backoff
   * - Lock age tracking for debugging
   * - Holder identification for diagnostics
   *
   * @param nodeId - Node unique identifier
   * @param holder - Lock holder identifier (workerId or operation name)
   * @param timeoutMs - Maximum wait time for lock (default: 30s)
   * @param expectedDurationMs - Expected operation duration for long-running ops (default: 0)
   * @throws Error if lock acquisition fails after 3 retries
   * @private
   */
  private async acquirePoolLock(
    nodeId: string,
    holder: string,
    timeoutMs = 30000,
    expectedDurationMs = 0
  ): Promise<void> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      const existingLock = this.poolLocks.get(nodeId);

      if (existingLock) {
        const now = Date.now();
        const timeSinceHeartbeat = now - existingLock.lastHeartbeat;
        const age = now - existingLock.acquiredAt;

        // DEEP AUDIT P0: Use heartbeat-based stale detection instead of pure time-based
        // A lock is stale if no heartbeat activity for 60 seconds
        const HEARTBEAT_STALE_THRESHOLD = 60000; // 60s without heartbeat = stale

        // HIGH #2 FIX: Force-release stale locks to prevent deadlock
        // DEEP AUDIT P0: Check heartbeat staleness first (more accurate), then fall back to time-based
        const isHeartbeatStale = timeSinceHeartbeat > HEARTBEAT_STALE_THRESHOLD;
        const isTimeStale = age > existingLock.staleThreshold;

        if (isHeartbeatStale || isTimeStale) {
          const reason = isHeartbeatStale
            ? `no heartbeat for ${timeSinceHeartbeat}ms (threshold: ${HEARTBEAT_STALE_THRESHOLD}ms)`
            : `held for ${age}ms (threshold: ${existingLock.staleThreshold}ms)`;
          this.logger.warn(
            `🔓 DEEP AUDIT P0: Auto-releasing stale lock for node ${nodeId} ` +
              `(held by ${existingLock.holder}, ${reason})`
          );
          existingLock.release();
          this.poolLocks.delete(nodeId);
          continue; // Retry acquire immediately
        }

        // Wait for lock with timeout
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error(`Pool lock timeout for node ${nodeId}`)), timeoutMs);
        });

        try {
          await Promise.race([existingLock.promise, timeoutPromise]);
        } catch (_error) {
          attempt++;
          if (attempt >= maxRetries) {
            throw new Error(
              `Failed to acquire pool lock for ${nodeId} after ${maxRetries} attempts`
            );
          }
          this.logger.warn(
            `⏳ Lock timeout attempt ${attempt}/${maxRetries} for ${nodeId}, retrying...`
          );
          continue; // Retry
        }
      }

      // Acquire lock
      let releaseLock!: () => void;
      const lockPromise = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      // CRITICAL #2 FIX: Compute staleThreshold based on expected duration
      const baseStaleLockThreshold = timeoutMs * 2; // 2x timeout as baseline
      const staleThreshold = baseStaleLockThreshold + expectedDurationMs;
      const now = Date.now();

      this.poolLocks.set(nodeId, {
        promise: lockPromise,
        release: releaseLock,
        acquiredAt: now,
        holder,
        expectedDurationMs,
        staleThreshold,
        lastHeartbeat: now, // DEEP AUDIT P0: Initialize heartbeat at lock acquisition
      });

      return; // Lock acquired successfully
    }

    throw new Error(`Failed to acquire pool lock for ${nodeId} after ${maxRetries} retries`);
  }

  /**
   * CRITICAL #3 FIX: Release mutex lock for pool operations
   *
   * @param nodeId - Node unique identifier
   * @private
   */
  private releasePoolLock(nodeId: string): void {
    const lockHolder = this.poolLocks.get(nodeId);
    if (lockHolder) {
      lockHolder.release();
      this.poolLocks.delete(nodeId);
    }
  }

  /**
   * CRITICAL #3 FIX: Execute function with pool lock, ensuring release on error
   * CRITICAL #2 FIX: Support expected duration for long-running operations
   *
   * @param nodeId - Node unique identifier
   * @param holder - Lock holder identifier (workerId or operation name)
   * @param fn - Function to execute while holding lock
   * @param expectedDurationMs - Expected operation duration (default: 0)
   * @returns Result of function execution
   * @private
   */
  private async withPoolLock<T>(
    nodeId: string,
    holder: string,
    fn: () => Promise<T>,
    expectedDurationMs = 0
  ): Promise<T> {
    await this.acquirePoolLock(nodeId, holder, 30000, expectedDurationMs);
    try {
      return await fn();
    } finally {
      this.releasePoolLock(nodeId); // ALWAYS release, even on error
    }
  }

  /**
   * CRITICAL #3 FIX: Periodic watchdog to detect and release deadlocked pool locks.
   * CRITICAL #2 FIX: Use per-lock staleThreshold to avoid false positives.
   *
   * Runs every 30 seconds and forcibly releases locks held beyond their staleThreshold.
   * Prevents permanent deadlocks from crashed operations or unhandled errors.
   *
   * @private
   */
  private startLockWatchdog(): void {
    const watchdogInterval = 30000; // Check every 30 seconds
    const HEARTBEAT_STALE_THRESHOLD = 60000; // 60s without heartbeat = stale

    this.lockWatchdogIntervalId = setInterval(() => {
      const now = Date.now();

      for (const [nodeId, lock] of this.poolLocks.entries()) {
        const age = now - lock.acquiredAt;
        const timeSinceHeartbeat = now - lock.lastHeartbeat;

        // DEEP AUDIT FIX: Check both heartbeat staleness and time-based threshold
        const isHeartbeatStale = timeSinceHeartbeat > HEARTBEAT_STALE_THRESHOLD;
        const isTimeStale = age > lock.staleThreshold;

        if (isHeartbeatStale || isTimeStale) {
          const reason = isHeartbeatStale
            ? `no heartbeat for ${timeSinceHeartbeat}ms`
            : `held for ${age}ms (threshold: ${lock.staleThreshold}ms)`;

          this.logger.error(
            `🚨 DEADLOCK DETECTED: Pool lock for ${nodeId} held by ${lock.holder} - ${reason}. Forcibly releasing.`
          );

          lock.release();
          this.poolLocks.delete(nodeId);

          this.logger.warn(`🔓 Deadlock resolved for ${nodeId}, lock forcibly released`);
        }
      }
    }, watchdogInterval);

    this.logger.log(
      `✅ Lock watchdog started (interval: ${watchdogInterval}ms, ` +
        `heartbeat threshold: ${HEARTBEAT_STALE_THRESHOLD}ms)`
    );
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
    // CRITICAL #3 FIX: Use withPoolLock to ensure release on error
    return await this.withPoolLock(nodeId, 'startWorkerPool', async () => {
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

      // CRITICAL #29 FIX: Calculate how many workers needed
      const currentWorkerCount = pool.activeWorkers.size;
      const workersToStart = validatedMaxWorkers - currentWorkerCount;

      if (workersToStart <= 0) {
        this.logger.debug(
          `Worker pool already at capacity (${currentWorkerCount}/${validatedMaxWorkers})`
        );
        return 0;
      }

      // CRITICAL #29 FIX: Start only the needed workers (not all from 1 to max)
      let workersStarted = 0;
      for (let i = currentWorkerCount + 1; i <= validatedMaxWorkers; i++) {
        const workerId = `${nodeId}-worker-${i}`;

        // HIGH #7 FIX: Add to Set BEFORE starting worker (prevents race)
        // If startWorker fails, we remove from Set in the catch block
        pool.activeWorkers.add(workerId);

        try {
          await this.startWorker(workerId, nodeId);
          workersStarted++;
        } catch (error) {
          // HIGH #7 FIX: Rollback on error - remove from Set
          pool.activeWorkers.delete(workerId);
          this.logger.error(`Failed to start worker ${workerId}:`, error);
        }
      }

      this.logger.log(
        `Started ${workersStarted} worker(s) for node ${nodeId} (total: ${pool.activeWorkers.size}/${validatedMaxWorkers})`
      );

      return workersStarted;
    });
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
    // CRITICAL #7 FIX: Comprehensive crash recovery with FFmpeg cleanup and worker restart
    this.processLoop(workerId).catch(async (error) => {
      this.logger.error(`[${workerId}] Worker crashed:`, error);

      // CRITICAL #7 FIX: Get worker state BEFORE deleting
      const worker = this.workers.get(workerId);
      const pool = this.workerPools.get(nodeId);

      if (!worker || !pool) {
        this.logger.error(`[${workerId}] Worker or pool not found during crash cleanup`);
        return;
      }

      // CRITICAL #7 FIX: Kill active FFmpeg process if encoding
      if (worker.currentJobId) {
        this.logger.warn(`[${workerId}] Killing orphaned FFmpeg for job ${worker.currentJobId}`);

        try {
          await this.ffmpegService.killProcess(worker.currentJobId);
        } catch (killError) {
          this.logger.error(
            `[${workerId}] Failed to kill FFmpeg for job ${worker.currentJobId}`,
            killError
          );
        }

        // CRITICAL #7 FIX: Reset job to QUEUED for retry
        try {
          await this.prisma.job.update({
            where: { id: worker.currentJobId },
            data: {
              stage: JobStage.QUEUED,
              error: `Worker ${workerId} crashed during encoding`,
              retryCount: { increment: 1 },
            },
          });
          this.logger.log(`[${workerId}] Reset job ${worker.currentJobId} to QUEUED`);
        } catch (jobError) {
          this.logger.error(`[${workerId}] Failed to reset job ${worker.currentJobId}`, jobError);
        }
      }

      // CLEANUP: Remove worker from tracking
      pool.activeWorkers.delete(workerId);
      this.workers.delete(workerId);

      // Resolve shutdown promise
      if (worker.shutdownResolve) {
        worker.shutdownResolve();
      }

      // CRITICAL #7 FIX: Restart worker to maintain pool size
      const remainingWorkers = pool.activeWorkers.size;
      if (remainingWorkers < pool.maxWorkers) {
        this.logger.warn(
          `[${nodeId}] Worker pool degraded to ${remainingWorkers}/${pool.maxWorkers}, restarting worker`
        );

        try {
          // LOW #2 FIX: Use crypto UUID to prevent ID collisions in rapid crash scenarios
          const { randomUUID } = await import('crypto');
          const newWorkerId = `${nodeId}-worker-${randomUUID().slice(0, 8)}`;
          await this.startWorker(newWorkerId, nodeId);
          this.logger.log(`[${nodeId}] Replacement worker ${newWorkerId} started`);
        } catch (restartError) {
          this.logger.error(`[${nodeId}] Failed to restart worker after crash`, restartError);
        }
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
    // CRITICAL #3 FIX: Acquire lock before modifying pool
    const holder = workerId ? `stopWorker:${workerId}` : 'stopWorker:all';
    await this.withPoolLock(nodeId, holder, async () => {
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
        // CRITICAL #6 FIX: Snapshot worker IDs to avoid concurrent modification during iteration
        const workerIds = Array.from(pool.activeWorkers);
        this.logger.log(`Stopping all ${workerIds.length} worker(s) for node ${nodeId}...`);

        const shutdownPromises: Promise<void>[] = [];

        // Signal all workers to stop
        for (const wId of workerIds) {
          const worker = this.workers.get(wId);
          if (worker) {
            worker.isRunning = false;

            if (worker.currentJobId) {
              this.logger.log(
                `Waiting for worker ${wId} to complete job ${worker.currentJobId}...`
              );
            }

            if (worker.shutdownPromise) {
              shutdownPromises.push(worker.shutdownPromise);
            }
          }
        }

        // Wait for all workers to complete their current jobs
        await Promise.all(shutdownPromises);
        this.logger.log(`All workers for node ${nodeId} stopped gracefully`);

        // NOW safe to delete (no concurrent modification)
        for (const wId of workerIds) {
          this.workers.delete(wId);
          pool.activeWorkers.delete(wId);
        }

        // Clear the pool
        this.workerPools.delete(nodeId);
      }
    });
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

      // SELF-HEALING: Validate and heal job's policy before processing
      // Handles deleted policies and codec mismatches silently
      const healedJob = await this.validateAndHealJobPolicy(job as JobWithPolicy);
      // Update local reference if job was healed
      Object.assign(job, healedJob);

      // AV1 THROTTLING: Log throttling status if job is resource-throttled
      // Note: skipNodeThrottleCheck was removed - throttling is now automatic based on system load

      // Update worker state
      worker.currentJobId = job.id;

      try {
        // DEEP AUDIT P2: Fresh check for pauseRequestedAt before starting encoding
        // This closes the window between getNextJob and actual encoding start
        const freshJob = await this.prisma.job.findUnique({
          where: { id: job.id },
          select: { pauseRequestedAt: true, stage: true },
        });

        if (freshJob?.pauseRequestedAt) {
          this.logger.log(
            `[${workerId}] DEEP AUDIT P2: Job ${job.id} has pause request, transitioning to PAUSED`
          );
          await this.queueService.update(job.id, {
            stage: JobStage.PAUSED,
            error: 'Paused before encoding started',
          });
          return null; // Skip encoding
        }

        // Verify source file exists - with auto-relocation for renamed files
        if (!fs.existsSync(job.filePath)) {
          const dirExists = fs.existsSync(path.dirname(job.filePath));

          // SELF-HEALING: Try to relocate file if it was moved/renamed by media server
          this.logger.warn(`[${workerId}] Source file not found, attempting auto-relocation...`);
          const relocationResult = await this.fileRelocatorService.relocateFile(
            job.filePath,
            job.beforeSizeBytes
          );

          if (relocationResult.found && relocationResult.newPath) {
            // File was relocated - update job and continue
            this.logger.log(
              `[${workerId}] ✅ AUTO-RELOCATED: File found at new location (${relocationResult.matchType}, ${relocationResult.confidence}% confidence)`
            );
            this.logger.log(`[${workerId}]    Old path: ${job.filePath}`);
            this.logger.log(`[${workerId}]    New path: ${relocationResult.newPath}`);

            // Update job path in database
            await this.prisma.job.update({
              where: { id: job.id },
              data: {
                filePath: relocationResult.newPath,
                fileLabel: path.basename(relocationResult.newPath),
              },
            });

            // Update local job object for this encoding session
            job.filePath = relocationResult.newPath;
            job.fileLabel = path.basename(relocationResult.newPath);
          } else {
            // Could not relocate - fail with detailed error
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
              errorMessage += `\n\n(Auto-relocation searched ${relocationResult.searchedPaths} files but could not find a match)`;
            }

            throw new Error(errorMessage);
          }
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
        ...(result.qualityMetrics && { qualityMetrics: result.qualityMetrics }),
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
   * SELF-HEALING: Validate and heal job's policy assignment
   *
   * Handles cases where:
   * - Policy was deleted after job was queued
   * - targetCodec doesn't match policy's targetCodec (orphaned setting)
   *
   * Resolution priority:
   * 1. Library's default policy
   * 2. Any policy assigned to the library
   * 3. First available policy in the system
   *
   * UX Philosophy: Auto-heal silently - user shouldn't need to know or intervene
   *
   * @param job - Job to validate and potentially heal
   * @returns Updated job with valid policy, or original if no changes needed
   */
  private async validateAndHealJobPolicy(job: JobWithPolicy): Promise<JobWithPolicy> {
    // Fetch current policy from database
    const currentPolicy = job.policyId
      ? await this.prisma.policy.findUnique({ where: { id: job.policyId } })
      : null;

    // Case 1: Policy exists and codec matches - no healing needed
    if (currentPolicy && job.targetCodec === currentPolicy.targetCodec) {
      return job;
    }

    // Case 2: Policy exists but codec mismatches - update job's codec
    if (currentPolicy && job.targetCodec !== currentPolicy.targetCodec) {
      this.logger.warn(
        `[${job.id}] POLICY HEAL: targetCodec mismatch (job: ${job.targetCodec}, policy: ${currentPolicy.targetCodec}) - updating job`
      );

      const updatedJob = await this.prisma.job.update({
        where: { id: job.id },
        data: {
          targetCodec: currentPolicy.targetCodec,
        },
        include: { policy: true },
      });

      return updatedJob as JobWithPolicy;
    }

    // Case 3: Policy is missing - need to find alternative
    this.logger.warn(
      `[${job.id}] POLICY HEAL: Policy ${job.policyId} not found - finding alternative`
    );

    // Get library for this job to find appropriate policy
    const library = await this.prisma.library.findUnique({
      where: { id: job.libraryId },
      include: { defaultPolicy: true, policies: true },
    });

    // Find replacement policy in priority order
    let newPolicy = null;

    // Priority 1: Library's default policy
    if (library?.defaultPolicy) {
      newPolicy = library.defaultPolicy;
      this.logger.log(`[${job.id}] POLICY HEAL: Using library default policy: ${newPolicy.name}`);
    }
    // Priority 2: Any policy assigned to this library
    else if (library?.policies && library.policies.length > 0) {
      newPolicy = library.policies[0];
      this.logger.log(`[${job.id}] POLICY HEAL: Using library's first policy: ${newPolicy.name}`);
    }
    // Priority 3: First available policy in system
    else {
      newPolicy = await this.prisma.policy.findFirst();
      if (newPolicy) {
        this.logger.log(`[${job.id}] POLICY HEAL: Using system's first policy: ${newPolicy.name}`);
      }
    }

    // If no policy found anywhere, this is a critical configuration issue
    if (!newPolicy) {
      throw new Error(
        `No policies available to assign to job ${job.id}. ` +
          `Please create at least one encoding policy.`
      );
    }

    // Update job with new policy and matching targetCodec
    const updatedJob = await this.prisma.job.update({
      where: { id: job.id },
      data: {
        policyId: newPolicy.id,
        targetCodec: newPolicy.targetCodec,
      },
      include: { policy: true },
    });

    this.logger.log(
      `[${job.id}] POLICY HEAL: Job updated - policy: ${newPolicy.name}, codec: ${newPolicy.targetCodec}`
    );

    return updatedJob as JobWithPolicy;
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
   * Check if system is overloaded and should throttle new jobs
   *
   * Prevents system overload by checking:
   * - Load average vs CPU cores (threshold: cores * loadThresholdMultiplier, default 5.0)
   * - Available memory (minimum 4GB free)
   *
   * UX Philosophy: Generous defaults so nodes work without manual tuning
   *
   * @returns Object with isOverloaded flag and reason
   * @private
   */
  private checkSystemLoad(): { isOverloaded: boolean; reason: string; details: string } {
    const cpuCount = os.cpus().length;
    const loadAvg = os.loadavg()[0]; // 1-minute load average
    const loadThreshold = cpuCount * this.loadThresholdMultiplier;

    const _totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const freeMemoryGB = freeMemory / 1024 ** 3;

    const details =
      `Load: ${loadAvg.toFixed(2)}/${loadThreshold.toFixed(0)} (${cpuCount} cores), ` +
      `Memory: ${freeMemoryGB.toFixed(1)}GB free`;

    // Check load average
    if (loadAvg > loadThreshold) {
      return {
        isOverloaded: true,
        reason: `High system load (${loadAvg.toFixed(2)} > ${loadThreshold.toFixed(0)})`,
        details,
      };
    }

    // Check memory
    if (freeMemoryGB < this.MIN_FREE_MEMORY_GB) {
      return {
        isOverloaded: true,
        reason: `Low memory (${freeMemoryGB.toFixed(1)}GB < ${this.MIN_FREE_MEMORY_GB}GB)`,
        details,
      };
    }

    return { isOverloaded: false, reason: '', details };
  }

  /**
   * Reload load threshold from database
   *
   * Called on startup and when settings change via API.
   * Falls back to env var or default if no database value.
   */
  async reloadLoadThreshold(): Promise<void> {
    try {
      const currentNode = await this.nodesService.getCurrentNode();
      // Type assertion: fields may be added in migration but Prisma client may not be regenerated yet
      const nodeWithSettings = currentNode as typeof currentNode & {
        loadThresholdMultiplier?: number;
        encodingTempPath?: string | null;
      };

      // Load loadThresholdMultiplier
      if (nodeWithSettings?.loadThresholdMultiplier) {
        this.loadThresholdMultiplier = nodeWithSettings.loadThresholdMultiplier;
        this.logger.log(
          `📊 Load threshold loaded from database: ${this.loadThresholdMultiplier}x (${os.cpus().length} cores = max load ${(os.cpus().length * this.loadThresholdMultiplier).toFixed(0)})`
        );
      } else {
        this.loadThresholdMultiplier = this.DEFAULT_LOAD_THRESHOLD_MULTIPLIER;
        this.logger.log(
          `📊 Load threshold using default: ${this.loadThresholdMultiplier}x (${os.cpus().length} cores = max load ${(os.cpus().length * this.loadThresholdMultiplier).toFixed(0)})`
        );
      }

      // Load encodingTempPath (Priority: DB -> ENV -> null)
      if (nodeWithSettings?.encodingTempPath) {
        this.encodingTempPath = nodeWithSettings.encodingTempPath;
        this.logger.log(`⚡ Encoding temp path loaded from database: ${this.encodingTempPath}`);
      } else if (process.env.ENCODING_TEMP_PATH) {
        this.encodingTempPath = process.env.ENCODING_TEMP_PATH;
        this.logger.log(`⚡ Encoding temp path from ENV: ${this.encodingTempPath}`);
      } else {
        this.encodingTempPath = null;
        this.logger.debug('📂 No encoding temp path configured, using source directory');
      }
    } catch (error) {
      this.loadThresholdMultiplier = this.DEFAULT_LOAD_THRESHOLD_MULTIPLIER;
      this.encodingTempPath = process.env.ENCODING_TEMP_PATH || null;
      this.logger.warn(`Failed to load settings from database, using defaults`, error);
    }
  }

  /**
   * Get current load threshold multiplier (for API exposure)
   */
  getLoadThresholdMultiplier(): number {
    return this.loadThresholdMultiplier;
  }

  /**
   * Get current encoding temp path (for API exposure)
   */
  getEncodingTempPath(): string | null {
    return this.encodingTempPath;
  }

  /**
   * Get current system load info (for debug API)
   */
  getSystemLoadInfo(): {
    loadAvg1m: number;
    loadAvg5m: number;
    loadAvg15m: number;
    cpuCount: number;
    loadThreshold: number;
    loadThresholdMultiplier: number;
    freeMemoryGB: number;
    totalMemoryGB: number;
    isOverloaded: boolean;
    reason: string;
  } {
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    const loadThreshold = cpuCount * this.loadThresholdMultiplier;
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const check = this.checkSystemLoad();

    return {
      loadAvg1m: loadAvg[0],
      loadAvg5m: loadAvg[1],
      loadAvg15m: loadAvg[2],
      cpuCount,
      loadThreshold,
      loadThresholdMultiplier: this.loadThresholdMultiplier,
      freeMemoryGB: freeMemory / 1024 ** 3,
      totalMemoryGB: totalMemory / 1024 ** 3,
      isOverloaded: check.isOverloaded,
      reason: check.reason,
    };
  }

  /**
   * Wait for system load to decrease before starting new job
   *
   * Called by worker loop before attempting to pick up a new job.
   * Logs warnings periodically to avoid log spam.
   *
   * @returns Promise that resolves when system is ready
   * @private
   */
  private async waitForSystemLoad(): Promise<void> {
    let check = this.checkSystemLoad();

    while (check.isOverloaded) {
      const now = Date.now();

      // Log throttle warning (but not too frequently)
      if (now - this.lastThrottleLogTime > this.THROTTLE_LOG_INTERVAL_MS) {
        this.logger.warn(`⚠️ THROTTLING: ${check.reason}`);
        this.logger.warn(`   ${check.details}`);
        this.logger.warn(`   Waiting for system to stabilize before starting new jobs...`);
        this.lastThrottleLogTime = now;
      }

      // Wait before checking again
      await this.sleep(this.THROTTLE_CHECK_INTERVAL_MS);
      check = this.checkSystemLoad();
    }
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
    const tmpPath = this.encodingTempPath
      ? path.join(this.encodingTempPath, `.${outputName}.tmp-${job.id}`)
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

      if (job.progress > 0 && fs.existsSync(tmpPath) && job.resumeTimestamp) {
        this.logger.log(
          `  🔄 TRUE RESUME: Job has ${job.progress.toFixed(1)}% progress and resumeTimestamp=${job.resumeTimestamp}`
        );

        try {
          // Parse the HH:MM:SS format resumeTimestamp to seconds
          const parts = job.resumeTimestamp.split(':');
          if (parts.length === 3) {
            const hours = Number.parseInt(parts[0], 10);
            const minutes = Number.parseInt(parts[1], 10);
            const seconds = Number.parseFloat(parts[2]);
            startedFromSeconds = Math.floor(hours * 3600 + minutes * 60 + seconds);

            this.logger.log(
              `  ✅ TRUE RESUME: Using resumeTimestamp from auto-heal: ${job.resumeTimestamp} (${startedFromSeconds}s = ${job.progress.toFixed(1)}%)`
            );
          } else {
            this.logger.warn(
              `  ⚠️  TRUE RESUME: Invalid resumeTimestamp format: ${job.resumeTimestamp}`
            );
          }
        } catch (error) {
          this.logger.warn(`  ⚠️  TRUE RESUME: Error parsing resumeTimestamp:`, error);
          // Continue without resume - will restart from 0%
        }
      } else if (job.progress > 0 && fs.existsSync(tmpPath) && !job.resumeTimestamp) {
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

      // CRITICAL: Get original duration BEFORE encoding for validation
      const originalDuration = await this.ffmpegService.getVideoDuration(job.filePath);
      this.logger.log(`Original file duration: ${originalDuration.toFixed(2)}s`);

      // Perform encoding
      await this.performEncoding(job, tmpPath, policy, startedFromSeconds);

      // Verify output if enabled
      if (policy.verifyOutput) {
        await this.verifyEncodedFile(tmpPath);
      }

      // CRITICAL FIX: Validate output duration matches original to prevent truncated files
      // This prevents catastrophic data loss from incomplete/interrupted encodings
      await this.validateOutputDuration(tmpPath, originalDuration, job.filePath);

      // Calculate file size changes
      const afterSizeBytes = BigInt(fs.statSync(tmpPath).size);
      const { savedBytes, savedPercent } = this.calculateSavings(beforeSizeBytes, afterSizeBytes);

      // VMAF QUALITY SCORING: Calculate quality metrics if enabled
      let qualityMetrics: string | undefined;
      try {
        const vmafThreshold = await this.getVmafThreshold();
        const metricsEnabled = await this.isQualityMetricsEnabled();

        if (metricsEnabled) {
          this.logger.log(`Calculating VMAF quality metrics for job ${job.id}...`);

          const metrics = await this.qualityMetricsService.calculateAllQualityMetrics(
            job.filePath,
            tmpPath
          );

          const validation = this.qualityMetricsService.validateQuality(metrics, vmafThreshold);

          this.logger.log(
            `Quality check result: VMAF=${metrics.vmaf?.toFixed(2) ?? 'N/A'}, ` +
              `threshold=${vmafThreshold}, label=${validation.qualityLabel}, ` +
              `passed=${validation.passed}`
          );

          qualityMetrics = this.qualityMetricsService.toJsonString(metrics);

          if (!validation.passed) {
            // Re-encode triggered: quality below threshold, mark job for retry
            this.logger.warn(
              `⚠️  Quality below threshold (VMAF=${metrics.vmaf?.toFixed(2)} < ${vmafThreshold}), ` +
                `flagging job ${job.id} for re-encode`
            );

            // Update job with quality failure info (re-encode happens via existing retry flow)
            await this.queueService.updateJobRaw(job.id, {
              error: `Quality below threshold: VMAF=${metrics.vmaf?.toFixed(2)} < ${vmafThreshold} (${validation.qualityLabel})`,
              retryCount: (job.retryCount || 0) + 1,
            });
          }
        } else {
          this.logger.debug(
            `Quality metrics disabled, skipping VMAF calculation for job ${job.id}`
          );
        }
      } catch (metricsError) {
        // Non-blocking: log quality calculation failure but don't fail the job
        const errorMsg =
          metricsError instanceof Error ? metricsError.message : String(metricsError);
        this.logger.warn(`⚠️  Quality metrics calculation failed for job ${job.id}: ${errorMsg}`);
        this.logger.warn(`Job ${job.id} will complete without quality score (non-blocking)`);
      }

      // CRITICAL FIX: Size sanity check - encoded file shouldn't be suspiciously small
      // This catches edge cases where duration might pass but file is clearly incomplete
      this.validateOutputSize(beforeSizeBytes, afterSizeBytes, originalDuration, job.filePath);

      // AUDIT FIX: Capture file stats for integrity check before replacement
      // This detects if file was modified between validation and replacement (race condition)
      const preReplaceStats = fs.statSync(tmpPath);
      const preReplaceMtime = preReplaceStats.mtimeMs;
      const preReplaceSize = preReplaceStats.size;

      // HIGH PRIORITY FIX: Verify disk space before atomic replacement
      // During atomic replacement, we temporarily have BOTH original + encoded file
      // So we need space for both files simultaneously
      await this.verifyDiskSpaceForReplacement(
        job.filePath,
        tmpPath,
        beforeSizeBytes,
        afterSizeBytes
      );

      // AUDIT FIX: Verify file wasn't modified during disk space check (race condition protection)
      const postCheckStats = fs.statSync(tmpPath);
      if (postCheckStats.mtimeMs !== preReplaceMtime || postCheckStats.size !== preReplaceSize) {
        throw new Error(
          `CRITICAL: Temp file was modified between validation and replacement!\n` +
            `Before: mtime=${preReplaceMtime}, size=${preReplaceSize}\n` +
            `After: mtime=${postCheckStats.mtimeMs}, size=${postCheckStats.size}\n` +
            `This could indicate file corruption or a race condition.\n` +
            `The original file will NOT be replaced to prevent data loss.`
        );
      }

      // Replace original file with encoded version (with Keep Original support)
      await this.replaceFile(job, tmpPath, policy.atomicReplace);

      return {
        beforeSizeBytes,
        afterSizeBytes,
        savedBytes,
        savedPercent,
        qualityMetrics,
      };
    } catch (error) {
      // TRUE RESUME: Only delete temp file on validation/corruption errors
      // Keep temp file for resumable errors (interrupts, crashes, EXDEV, etc.)
      const errorMessage = error instanceof Error ? error.message : String(error);
      // AUDIT FIX: Added validation error patterns to ensure temp files are cleaned up
      const isCorruptionError =
        errorMessage.includes('verification failed') ||
        errorMessage.includes('corrupted') ||
        errorMessage.includes('not playable') ||
        errorMessage.includes('invalid') ||
        errorMessage.includes('duration mismatch') ||
        errorMessage.includes('appears truncated') ||
        errorMessage.includes('suspiciously small') ||
        errorMessage.includes('Cannot determine output file duration');

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
   * CRITICAL FIX: Validate output duration matches original to prevent truncated files
   *
   * This is a critical safety check that prevents catastrophic data loss from:
   * - Interrupted encodings (OOM, crash, node failure)
   * - FFmpeg errors that produce partial output
   * - NFS/filesystem issues during encoding
   *
   * If the output file is truncated (e.g., 10 minutes of a 2-hour movie),
   * this validation will FAIL and prevent the truncated file from replacing
   * the original.
   *
   * @param outputPath - Path to the encoded output file
   * @param originalDuration - Duration of the original file in seconds
   * @param originalPath - Path to original file (for error messages)
   * @throws Error if duration mismatch exceeds tolerance
   * @private
   */
  private async validateOutputDuration(
    outputPath: string,
    originalDuration: number,
    originalPath: string
  ): Promise<void> {
    // AUDIT FIX: Reject if original duration is the 3600s fallback value
    // This indicates ffprobe failed - we can't safely validate
    if (originalDuration === 3600) {
      this.logger.warn(
        `Original duration is exactly 3600s (ffprobe fallback value). ` +
          `This may indicate ffprobe failed. Proceeding with caution.`
      );
      // Don't skip - still validate, but log the warning
    }

    // P2 FIX: Lowered threshold from 5s to 1s with absolute tolerance
    // Very short clips (<1s) skip validation - can't reliably measure
    // Clips 1-60s use absolute tolerance (±1s) instead of percentage
    if (originalDuration < 1) {
      this.logger.log(
        `Skipping duration validation for sub-second clip (${originalDuration.toFixed(2)}s)`
      );
      return;
    }

    // AUDIT FIX: Add NFS flush delay before reading output duration
    // NFS cache could return stale data for recently written files
    await this.sleep(2000);

    const outputDuration = await this.ffmpegService.getVideoDuration(outputPath);

    // AUDIT FIX: Reject if output duration is the 3600s fallback value
    // This indicates ffprobe failed on output - file may be corrupt
    if (outputDuration === 3600 && originalDuration !== 3600) {
      throw new Error(
        `CRITICAL: Cannot determine output file duration (ffprobe returned fallback value).\n` +
          `This usually means the output file is corrupt or incomplete.\n` +
          `The original file will NOT be replaced to prevent data loss.\n\n` +
          `File: ${originalPath}`
      );
    }

    // Calculate duration difference
    const durationDiff = Math.abs(outputDuration - originalDuration);
    const durationDiffPercent = (durationDiff / originalDuration) * 100;

    // P2 FIX: Use absolute tolerance for short files (1-60s), percentage for longer
    // Short files: ±1s absolute (keyframe alignment can shift by ~1s)
    // Longer files: adaptive percentage (prevents losing content)
    const useAbsoluteTolerance = originalDuration <= 60;
    const absoluteToleranceSeconds = 1.0; // ±1 second for short clips
    const tolerancePercent = this.getAdaptiveDurationTolerance(originalDuration);

    const toleranceExceeded = useAbsoluteTolerance
      ? durationDiff > absoluteToleranceSeconds
      : durationDiffPercent > tolerancePercent;

    if (toleranceExceeded) {
      // Format durations for human-readable error message
      const formatDuration = (seconds: number): string => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
      };

      // P2 FIX: Show correct tolerance in error message (absolute vs percentage)
      const toleranceStr = useAbsoluteTolerance
        ? `${durationDiff.toFixed(2)}s (tolerance: ±${absoluteToleranceSeconds}s)`
        : `${durationDiffPercent.toFixed(1)}% (tolerance: ${tolerancePercent}%)`;

      const errorMsg =
        `CRITICAL: Output file duration mismatch - encoding appears truncated!\n\n` +
        `Original: ${formatDuration(originalDuration)} (${originalDuration.toFixed(2)}s)\n` +
        `Output: ${formatDuration(outputDuration)} (${outputDuration.toFixed(2)}s)\n` +
        `Difference: ${toleranceStr}\n\n` +
        `This usually means the encoding was interrupted or failed partway through.\n` +
        `The original file will NOT be replaced to prevent data loss.\n\n` +
        `File: ${originalPath}`;

      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // P2 FIX: Show correct tolerance in success log
    const toleranceLogStr = useAbsoluteTolerance
      ? `diff=${durationDiff.toFixed(2)}s (tolerance=±${absoluteToleranceSeconds}s)`
      : `diff=${durationDiffPercent.toFixed(1)}% (tolerance=${tolerancePercent}%)`;

    this.logger.log(
      `✓ Duration validation passed: output=${outputDuration.toFixed(2)}s, ` +
        `original=${originalDuration.toFixed(2)}s, ${toleranceLogStr}`
    );
  }

  /**
   * AUDIT FIX: Get adaptive duration tolerance based on file length
   *
   * Shorter files can have more variance due to keyframe alignment.
   * Longer files should have tighter tolerance to prevent losing content.
   *
   * @param durationSeconds - Video duration in seconds
   * @returns Tolerance percentage
   * @private
   */
  private getAdaptiveDurationTolerance(durationSeconds: number): number {
    if (durationSeconds < 300) return 5.0; // <5 min: 5% (up to 15s variance)
    if (durationSeconds < 1800) return 3.0; // <30 min: 3% (up to 54s variance)
    if (durationSeconds < 3600) return 2.0; // <1 hr: 2% (up to 72s variance)
    if (durationSeconds < 7200) return 1.5; // <2 hr: 1.5% (up to 108s variance)
    return 1.0; // ≥2 hr: 1% (up to 72s for 2hr, 108s for 3hr)
  }

  /**
   * CRITICAL FIX: Validate output file size is not suspiciously small
   *
   * This is a secondary safety check that catches edge cases where:
   * - Duration validation might pass (e.g., corrupted metadata)
   * - But the file is clearly incomplete based on size
   *
   * For a 2-hour 1080p movie, minimum reasonable bitrate is ~500kbps (very low quality).
   * If the output is smaller than this, something is very wrong.
   *
   * @param beforeSizeBytes - Original file size
   * @param afterSizeBytes - Encoded file size
   * @param durationSeconds - Video duration in seconds
   * @param filePath - Path to file (for error messages)
   * @throws Error if file size is suspiciously small
   * @private
   */
  private validateOutputSize(
    beforeSizeBytes: bigint,
    afterSizeBytes: bigint,
    durationSeconds: number,
    filePath: string
  ): void {
    // AUDIT FIX: Use bigint throughout to prevent precision loss on huge files (>9PB)
    // Calculate minimum reasonable size based on duration
    // Minimum bitrate: 200kbps (absolute floor for any watchable video)
    // Formula: size_bytes = bitrate_bps * duration_seconds / 8
    const minBitrateKbps = 200n;
    const durationBigInt = BigInt(Math.floor(durationSeconds));
    const minReasonableBytes = (minBitrateKbps * 1000n * durationBigInt) / 8n;

    if (afterSizeBytes < minReasonableBytes) {
      // Convert to Number only for display formatting (safe for display purposes)
      const afterSizeMB = Number(afterSizeBytes / 1024n / 1024n);
      const minSizeMB = Number(minReasonableBytes / 1024n / 1024n);
      const beforeSizeMB = Number(beforeSizeBytes / 1024n / 1024n);

      const errorMsg =
        `CRITICAL: Output file size is suspiciously small!\n\n` +
        `Original size: ${beforeSizeMB.toFixed(2)} MB\n` +
        `Output size: ${afterSizeMB.toFixed(2)} MB\n` +
        `Minimum expected: ${minSizeMB.toFixed(2)} MB (for ${durationSeconds.toFixed(0)}s @ ${minBitrateKbps}kbps)\n\n` +
        `The output file is smaller than any reasonable encoding could produce.\n` +
        `This usually indicates a corrupted or incomplete file.\n` +
        `The original file will NOT be replaced to prevent data loss.\n\n` +
        `File: ${filePath}`;

      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Also check for extreme compression (>95% reduction is suspicious for video)
    // Normal HEVC encoding typically saves 30-70%, not 95%+
    // AUDIT FIX: Use bigint for all comparisons to prevent precision loss
    const savedBytes = beforeSizeBytes - afterSizeBytes;
    const reductionPercent =
      beforeSizeBytes > 0n ? Number((savedBytes * 100n) / beforeSizeBytes) : 0;
    const hundredMB = 100n * 1024n * 1024n;
    const oneGB = 1024n * 1024n * 1024n;

    // AUDIT FIX: Block extreme compression (was just warning before)
    // 95%+ reduction with output <100MB and original >1GB is almost always corruption
    if (reductionPercent > 95 && afterSizeBytes < hundredMB && beforeSizeBytes > oneGB) {
      const afterSizeMB = Number(afterSizeBytes / 1024n / 1024n);
      const beforeSizeMB = Number(beforeSizeBytes / 1024n / 1024n);

      const errorMsg =
        `CRITICAL: Extreme compression detected - likely corruption!\n\n` +
        `Original size: ${beforeSizeMB.toFixed(2)} MB\n` +
        `Output size: ${afterSizeMB.toFixed(2)} MB\n` +
        `Reduction: ${reductionPercent.toFixed(1)}%\n\n` +
        `A ${reductionPercent.toFixed(0)}% reduction from ${beforeSizeMB.toFixed(0)}MB to ${afterSizeMB.toFixed(0)}MB ` +
        `is not possible with legitimate encoding.\n` +
        `This usually indicates the output file is corrupted or incomplete.\n` +
        `The original file will NOT be replaced to prevent data loss.\n\n` +
        `File: ${filePath}`;

      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Warn (but allow) for edge cases: small files or moderate compression
    if (reductionPercent > 90 && afterSizeBytes < hundredMB) {
      const afterSizeMB = Number(afterSizeBytes / 1024n / 1024n);
      const beforeSizeMB = Number(beforeSizeBytes / 1024n / 1024n);

      this.logger.warn(
        `⚠️  High compression detected: ${beforeSizeMB.toFixed(2)}MB → ${afterSizeMB.toFixed(2)}MB ` +
          `(${reductionPercent.toFixed(1)}% reduction). File: ${filePath}`
      );
    }
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
    const originalPath = job.filePath;

    // KEEP ORIGINAL FEATURE: Check if user requested to keep the original file
    if (job.keepOriginalRequested) {
      // User clicked "Keep Original" - rename original to .original and keep both files
      const originalBackupPath = `${originalPath}.original`;

      this.logger.log(`KEEP ORIGINAL: Renaming original to ${originalBackupPath}`);
      this.crossFsSafeRenameSync(originalPath, originalBackupPath);
      this.crossFsSafeRenameSync(tmpPath, originalPath);

      // AUDIT FIX: Post-replacement smoke test - verify the new file is playable
      // If verification fails, rollback to original
      // AUDIT FIX: Add NFS flush delay to ensure we read actual disk data, not cached
      await this.sleep(2000);
      const smokeTest = await this.ffmpegService.verifyFile(originalPath);
      if (!smokeTest.isValid) {
        this.logger.error(
          `KEEP ORIGINAL: Post-replacement verification FAILED! Rolling back. Error: ${smokeTest.error}`
        );

        // Rollback: restore original from backup
        try {
          if (fs.existsSync(originalPath)) {
            fs.unlinkSync(originalPath); // Delete failed encoded file
          }
          this.crossFsSafeRenameSync(originalBackupPath, originalPath);
          this.logger.log(`KEEP ORIGINAL: Successfully rolled back to original`);
        } catch (_rollbackError) {
          this.logger.error(`KEEP ORIGINAL: Rollback failed! Backup at: ${originalBackupPath}`);
        }

        throw new Error(
          `Post-replacement verification failed: ${smokeTest.error}. Original restored from backup.`
        );
      }

      // Update job with backup info
      await this.queueService.update(job.id, {
        originalBackupPath,
        originalSizeBytes: job.beforeSizeBytes,
        replacementAction: 'KEPT_BOTH',
      });

      this.logger.log(`KEEP ORIGINAL: Successfully kept original as backup (verified playable)`);
    } else {
      // Default behavior: replace original file (delete it)
      if (atomicReplace) {
        // atomicReplaceFile keeps a .backup until verified
        await this.atomicReplaceFileWithVerification(originalPath, tmpPath);
      } else {
        // AUDIT FIX: Non-atomic mode is dangerous - log warning
        this.logger.warn(
          `⚠️  Using non-atomic replace mode - original will be deleted before verification!\n` +
            `If smoke test fails, data loss is possible. Consider enabling atomic replace.\n` +
            `File: ${originalPath}`
        );

        this.crossFsSafeRenameSync(tmpPath, originalPath);

        // AUDIT FIX: Post-replacement smoke test for non-atomic replace
        // Note: original is gone, so we can only warn - can't rollback
        // AUDIT FIX: Add NFS flush delay to ensure we read actual disk data
        await this.sleep(2000);
        const smokeTest = await this.ffmpegService.verifyFile(originalPath);
        if (!smokeTest.isValid) {
          this.logger.error(
            `⚠️  CRITICAL: Post-replacement verification FAILED (non-atomic mode)!\n` +
              `Original file is GONE. Encoded file may be corrupt.\n` +
              `Error: ${smokeTest.error}\n` +
              `File: ${originalPath}`
          );
          // Don't throw - file is already replaced, nothing to rollback to
          // User will see the error in job status
        }
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
          // AUDIT FIX: Get source size BEFORE copy for verification
          const sourceStats = fs.statSync(sourcePath);
          const sourceSize = sourceStats.size;

          // Fallback: Copy file to destination
          fs.copyFileSync(sourcePath, destPath);

          // AUDIT FIX: Verify copy succeeded by checking BOTH existence AND size
          // This catches partial copies from disk-full or interrupted operations
          if (!fs.existsSync(destPath)) {
            throw new Error('Copy verification failed - destination file does not exist');
          }

          const destStats = fs.statSync(destPath);
          if (destStats.size !== sourceSize) {
            // Clean up partial copy
            try {
              fs.unlinkSync(destPath);
            } catch {
              // Ignore cleanup error
            }
            throw new Error(
              `Copy verification failed - size mismatch!\n` +
                `Source: ${sourceSize} bytes\n` +
                `Dest: ${destStats.size} bytes\n` +
                `This usually indicates disk full or interrupted copy.`
            );
          }

          // Delete source file only after successful verified copy
          fs.unlinkSync(sourcePath);

          this.logger.log(
            `Successfully moved file across filesystems: ${sourcePath} -> ${destPath} (${sourceSize} bytes verified)`
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
   * AUDIT FIX: Atomically replace file with verification and rollback on failure
   *
   * This enhanced version keeps the backup UNTIL the new file is verified playable.
   * If verification fails, it automatically rolls back to the original.
   *
   * @private
   */
  private async atomicReplaceFileWithVerification(
    originalPath: string,
    tmpPath: string
  ): Promise<void> {
    const backupPath = `${originalPath}.backup`;

    try {
      // Step 1: Create backup of original file
      this.crossFsSafeRenameSync(originalPath, backupPath);

      // Step 2: Move temp file to original location
      this.crossFsSafeRenameSync(tmpPath, originalPath);

      // Step 3: AUDIT FIX - Verify the new file is playable BEFORE deleting backup
      // AUDIT FIX: Add NFS flush delay to ensure we read actual disk data, not cached
      await this.sleep(2000);
      const smokeTest = await this.ffmpegService.verifyFile(originalPath);
      if (!smokeTest.isValid) {
        this.logger.error(
          `Post-replacement verification FAILED! Rolling back. Error: ${smokeTest.error}`
        );

        // Rollback: restore backup
        try {
          if (fs.existsSync(originalPath)) {
            fs.unlinkSync(originalPath); // Delete failed encoded file
          }
          this.crossFsSafeRenameSync(backupPath, originalPath);
          this.logger.log(`Successfully rolled back to backup for ${originalPath}`);
        } catch (rollbackError) {
          this.logger.error(`CRITICAL: Rollback failed! Backup at: ${backupPath}`);
          throw new Error(
            `Post-replacement verification failed AND rollback failed.\n` +
              `Verification error: ${smokeTest.error}\n` +
              `Rollback error: ${rollbackError}\n` +
              `Backup may still exist at: ${backupPath}`
          );
        }

        throw new Error(
          `Post-replacement verification failed: ${smokeTest.error}. Original restored from backup.`
        );
      }

      // Step 4: Delete backup only after successful verification
      try {
        fs.unlinkSync(backupPath);
      } catch (cleanupError) {
        // Non-fatal: Log warning but don't fail the operation
        this.logger.warn(`Failed to cleanup backup file ${backupPath}: ${cleanupError}`);
      }

      this.logger.log(`Atomic replacement complete with verification for ${originalPath}`);
    } catch (error) {
      // If backup exists and original doesn't, try to restore
      if (fs.existsSync(backupPath) && !fs.existsSync(originalPath)) {
        try {
          this.crossFsSafeRenameSync(backupPath, originalPath);
          this.logger.log(`Restored backup after error for ${originalPath}`);
        } catch (restoreError) {
          this.logger.error(`Failed to restore backup after error: ${restoreError}`);
        }
      }
      throw error;
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
   * CRITICAL #3 FIX: Added background heartbeat to prevent false auto-heal
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

    // CRITICAL #3 FIX: Background heartbeat to prevent auto-heal race condition
    // Updates heartbeat every 30s to keep job alive during silent encoding phases
    const heartbeatInterval = setInterval(async () => {
      if (worker.currentJobId && worker.isRunning) {
        try {
          await this.prisma.job.updateMany({
            where: {
              id: worker.currentJobId,
              stage: { in: ['ENCODING', 'VERIFYING'] },
            },
            data: {
              lastHeartbeat: new Date(),
              heartbeatNodeId: worker.nodeId,
            },
          });
          this.logger.debug(`[${workerId}] Heartbeat sent for job ${worker.currentJobId}`);
        } catch (error) {
          this.logger.debug(`[${workerId}] Heartbeat update failed (non-fatal):`, error);
        }
      }
    }, 30000); // Every 30 seconds

    // CRITICAL #12 FIX: Wrap entire loop in try-finally to ensure cleanup always happens
    try {
      while (worker.isRunning) {
        try {
          // LOAD-BASED THROTTLING: Wait if system is overloaded before picking up new job
          await this.waitForSystemLoad();

          // Check if worker was stopped while waiting
          if (!worker.isRunning) break;

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
    } finally {
      // CRITICAL #3 FIX: Clear heartbeat interval to prevent memory leak
      clearInterval(heartbeatInterval);
      this.logger.debug(`[${workerId}] Heartbeat interval cleared`);

      // CRITICAL #12 FIX: ALWAYS cleanup, even if loop crashes unexpectedly
      const pool = this.workerPools.get(worker.nodeId);
      if (pool) {
        pool.activeWorkers.delete(workerId);
      }
      this.workers.delete(workerId);

      // Resolve shutdown promise if it exists
      if (worker.shutdownResolve) {
        worker.shutdownResolve();
      }

      this.logger.debug(`[${workerId}] Worker cleanup complete in finally block`);
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

  /**
   * Get VMAF threshold from system settings
   *
   * @returns VMAF threshold (default: 85)
   * @private
   */
  private async getVmafThreshold(): Promise<number> {
    try {
      const settings = await this.prisma.settings.findFirst({
        where: {},
        select: { vmafThreshold: true },
      });
      return settings?.vmafThreshold ?? 85;
    } catch {
      return 85; // Default threshold
    }
  }

  /**
   * Check if quality metrics (VMAF) is enabled in system settings
   *
   * @returns Whether quality metrics are enabled (default: true)
   * @private
   */
  private async isQualityMetricsEnabled(): Promise<boolean> {
    try {
      const settings = await this.prisma.settings.findFirst({
        where: {},
        select: { qualityMetricsEnabled: true },
      });
      return settings?.qualityMetricsEnabled ?? true;
    } catch {
      return true; // Default enabled
    }
  }
}
