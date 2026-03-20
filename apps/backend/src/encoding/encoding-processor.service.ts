import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Library, Policy } from '@prisma/client';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../common/repositories/job.repository';
import { LibraryRepository } from '../common/repositories/library.repository';
import { PolicyRepository } from '../common/repositories/policy.repository';
import { DataAccessService } from '../core/services/data-access.service';
import { FileRelocatorService } from '../core/services/file-relocator.service';
import { LibrariesService } from '../libraries/libraries.service';
import { NodesService } from '../nodes/nodes.service';
import { QueueService } from '../queue/queue.service';
import { EncodingFileService, type JobResult, type JobWithPolicy } from './encoding-file.service';
import { EncodingStartupService } from './encoding-startup.service';
import { EncodingWatchdogService } from './encoding-watchdog.service';
import { FfmpegService } from './ffmpeg.service';
import { JobRetryStrategyService } from './job-retry-strategy.service';
import { PoolLockService } from './pool-lock.service';
import { SystemResourceService } from './system-resource.service';
import { WorkerPoolService } from './worker-pool.service';

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

  // AUDIT #2 ISSUE #24 FIX: Store watchdog interval for cleanup
  private watchdogIntervalId?: NodeJS.Timeout;

  // CRITICAL #5 FIX: Track ALL active intervals globally to prevent leaks on hot reload
  private static activeIntervals = new Set<NodeJS.Timeout>();

  // Auto-heal timing constants (Code Convention: no magic numbers)
  private readonly AUTO_HEAL_INITIAL_DELAY_MS = 2000; // 2 seconds
  private readonly AUTO_HEAL_STABILIZATION_DELAY_MS = 3000; // 3 seconds
  constructor(
    private readonly jobRepository: JobRepository,
    private readonly libraryRepository: LibraryRepository,
    private readonly policyRepository: PolicyRepository,
    private readonly queueService: QueueService,
    readonly _dataAccessService: DataAccessService,
    private readonly ffmpegService: FfmpegService,
    readonly _librariesService: LibrariesService,
    private readonly nodesService: NodesService,
    private readonly fileRelocatorService: FileRelocatorService,
    private readonly poolLockService: PoolLockService,
    private readonly systemResourceService: SystemResourceService,
    private readonly encodingFileService: EncodingFileService,
    private readonly workerPoolService: WorkerPoolService,
    private readonly jobRetryStrategyService: JobRetryStrategyService,
    private readonly encodingStartupService: EncodingStartupService,
    private readonly encodingWatchdogService: EncodingWatchdogService
  ) {}

  /**
   * Auto-start worker pools for all online nodes on module initialization
   * This ensures encoding workers are running whenever the backend starts
   *
   * Also performs auto-heal to recover from crashes/reboots
   */
  async onModuleInit() {
    this.logger.log('🔧 Initializing encoding processor...');

    this.poolLockService.initialize();
    this.logger.log('✅ Pool lock service initialized');

    // PERF: Log cache pool configuration (loaded from DB via reloadNodeSettings)
    if (this.systemResourceService.getEncodingTempPath()) {
      this.logger.log(
        `⚡ Cache pool ENABLED: Using ${this.systemResourceService.getEncodingTempPath()} for temp files (faster SSD I/O)`
      );
    } else {
      this.logger.log('📂 Cache pool DISABLED: Using source directory for temp files');
    }

    // Load load threshold from database
    await this.systemResourceService.reloadLoadThreshold();

    try {
      // HYBRID APPROACH: Initial delay + volume mount probing + file system stabilization + retry logic
      // Step 1: Small initial delay to let basic initialization complete
      this.logger.log('⏳ Waiting for basic initialization...');
      await new Promise((resolve) => setTimeout(resolve, this.AUTO_HEAL_INITIAL_DELAY_MS));

      // Step 2: Wait for volume mounts to be accessible
      await this.encodingStartupService.waitForVolumeMounts();

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
      await this.encodingStartupService.autoHealOrphanedJobs(currentNode.id);

      // MULTI-NODE AUDIT: Enhanced logging to debug LINKED node encoding issues
      this.logger.log(`🔍 MULTI-NODE: Current node configuration:`);
      this.logger.log(`   - Node ID: ${currentNode.id}`);
      this.logger.log(`   - Node Name: ${currentNode.name}`);
      this.logger.log(`   - Node Role: ${currentNode.role}`);
      this.logger.log(`   - Main Node URL: ${currentNode.mainNodeUrl || 'N/A (this is MAIN)'}`);
      this.logger.log(`   - Has Shared Storage: ${currentNode.hasSharedStorage}`);
      this.logger.log(
        `   - Max Workers: ${currentNode.maxWorkers || this.systemResourceService.defaultWorkersPerNode}`
      );

      // STEP 3: Start worker pool for the current node using its configured maxWorkers
      const maxWorkers = currentNode.maxWorkers || this.systemResourceService.defaultWorkersPerNode;

      this.logger.log(
        `🚀 MULTI-NODE: Starting ${maxWorkers} worker(s) for ${currentNode.role} node: ${currentNode.name}`
      );

      const workersStarted = await this.workerPoolService.startWorkerPool(
        currentNode.id,
        maxWorkers,
        (workerId, nodeId) => this.processLoop(workerId, nodeId)
      );

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
      this.watchdogIntervalId = this.encodingWatchdogService.startStuckJobWatchdog();
      EncodingProcessorService.activeIntervals.add(this.watchdogIntervalId);
    } catch (error: unknown) {
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
   * Start a worker pool for a node.
   * Delegates to WorkerPoolService — see WorkerPoolService.startWorkerPool for full implementation.
   *
   * @param nodeId - Node unique identifier
   * @param maxWorkers - Maximum number of concurrent workers
   * @returns Number of workers actually started
   */
  async startWorkerPool(
    nodeId: string,
    maxWorkers = this.systemResourceService.defaultWorkersPerNode
  ): Promise<number> {
    return this.workerPoolService.startWorkerPool(nodeId, maxWorkers, (workerId, nodeId) =>
      this.processLoop(workerId, nodeId)
    );
  }

  /**
   * Stop worker pool for a node.
   * Delegates to WorkerPoolService — see WorkerPoolService.stopWorker for full implementation.
   *
   * @param nodeId - Node unique identifier
   * @param workerId - Optional specific worker ID to stop (stops all if omitted)
   */
  async stopWorker(nodeId: string, workerId?: string): Promise<void> {
    return this.workerPoolService.stopWorker(nodeId, workerId);
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
    const worker = this.workerPoolService.getWorker(workerId);
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
      this.workerPoolService.setWorkerJob(workerId, job.id);

      try {
        // DEEP AUDIT P2: Fresh check for pauseRequestedAt before starting encoding
        // This closes the window between getNextJob and actual encoding start
        const freshJob = await this.jobRepository.findUniqueSelect<{
          pauseRequestedAt: Date | null;
          stage: JobStage;
        }>({ id: job.id }, { pauseRequestedAt: true, stage: true });

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
            await this.jobRepository.updateById(job.id, {
              filePath: relocationResult.newPath,
              fileLabel: path.basename(relocationResult.newPath),
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
        await this.systemResourceService.performResourcePreflightChecks(job.filePath, job.id);

        // Perform encoding
        const result = await this.encodingFileService.encodeFile(job);

        // Handle successful completion
        await this.handleJobCompletion(job, result);

        return job;
      } catch (error: unknown) {
        // Handle failure with retry logic
        await this.handleJobFailure(job, error);
        return null;
      } finally {
        // Clear current job
        this.workerPoolService.setWorkerJob(workerId, null);
      }
    } catch (error: unknown) {
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
      await this.encodingFileService.updateLibraryStats(job.libraryId, result.savedBytes);

      this.logger.log(
        `Job ${job.id} saved ${this.formatBytes(Number(result.savedBytes))} (${result.savedPercent.toFixed(2)}%)`
      );
    } catch (error: unknown) {
      this.logger.error(`Error completing job ${job.id}:`, error);
      throw error;
    }
  }

  /**
   * Handle job failure — delegates retry logic to JobRetryStrategyService.
   *
   * @param job - Failed job
   * @param error - Error that caused failure
   */
  async handleJobFailure(job: JobWithPolicy, error: unknown): Promise<void> {
    return this.jobRetryStrategyService.handleJobFailure(job, error);
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
    const currentPolicy = job.policyId ? await this.policyRepository.findById(job.policyId) : null;

    // Case 1: Policy exists and codec matches - no healing needed
    if (currentPolicy && job.targetCodec === currentPolicy.targetCodec) {
      return job;
    }

    // Case 2: Policy exists but codec mismatches - update job's codec
    if (currentPolicy && job.targetCodec !== currentPolicy.targetCodec) {
      this.logger.warn(
        `[${job.id}] POLICY HEAL: targetCodec mismatch (job: ${job.targetCodec}, policy: ${currentPolicy.targetCodec}) - updating job`
      );

      const updatedJob = await this.jobRepository.updateByIdWithInclude<JobWithPolicy>(
        job.id,
        { targetCodec: currentPolicy.targetCodec },
        { policy: true }
      );

      return updatedJob;
    }

    // Case 3: Policy is missing - need to find alternative
    this.logger.warn(
      `[${job.id}] POLICY HEAL: Policy ${job.policyId} not found - finding alternative`
    );

    // Get library for this job to find appropriate policy
    const library = (await this.libraryRepository.findUniqueWithInclude(
      { id: job.libraryId },
      { defaultPolicy: true, policies: true }
    )) as (Library & { defaultPolicy: Policy | null; policies: Policy[] }) | null;

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
      const allPolicies = await this.policyRepository.findAll();
      newPolicy = allPolicies[0] ?? null;
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
    const updatedJob = await this.jobRepository.updateByIdWithInclude<JobWithPolicy>(
      job.id,
      { policyId: newPolicy.id, targetCodec: newPolicy.targetCodec },
      { policy: true }
    );

    this.logger.log(
      `[${job.id}] POLICY HEAL: Job updated - policy: ${newPolicy.name}, codec: ${newPolicy.targetCodec}`
    );

    return updatedJob as JobWithPolicy;
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
  private async processLoop(workerId: string, _nodeId: string): Promise<void> {
    const worker = this.workerPoolService.getWorker(workerId);
    if (!worker) return;

    this.logger.log(`[${workerId}] Started processing loop`);

    // CRITICAL #3 FIX: Background heartbeat to prevent auto-heal race condition
    // Updates heartbeat every 30s to keep job alive during silent encoding phases
    const heartbeatInterval = setInterval(async () => {
      if (worker.currentJobId && worker.isRunning) {
        try {
          await this.jobRepository.atomicUpdateMany(
            {
              id: worker.currentJobId,
              stage: { in: ['ENCODING', 'VERIFYING'] },
            },
            {
              lastHeartbeat: new Date(),
              heartbeatNodeId: worker.nodeId,
            }
          );
          this.logger.debug(`[${workerId}] Heartbeat sent for job ${worker.currentJobId}`);
        } catch (error: unknown) {
          this.logger.debug(`[${workerId}] Heartbeat update failed (non-fatal):`, error);
        }
      }
    }, 30000); // Every 30 seconds

    // CRITICAL #12 FIX: Wrap entire loop in try-finally to ensure cleanup always happens
    try {
      while (worker.isRunning) {
        try {
          // LOAD-BASED THROTTLING: Wait if system is overloaded before picking up new job
          await this.systemResourceService.waitForSystemLoad();

          // Check if worker was stopped while waiting
          if (!worker.isRunning) break;

          const job = await this.processNextJob(workerId);

          if (!job) {
            // No job available, wait before polling again
            await this.sleep(5000);
          }
        } catch (error: unknown) {
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
      this.workerPoolService.removeWorker(workerId);
      this.workerPoolService.resolveShutdown(workerId);

      this.logger.debug(`[${workerId}] Worker cleanup complete in finally block`);
    }
  }

  /**
   * Sleep helper
   * @private
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
