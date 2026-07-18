import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../common/repositories/job.repository';
import { FileRelocatorService } from '../core/services/file-relocator.service';
import { QueueService } from '../queue/queue.service';
import { CircuitBreakerService } from '../queue/services/circuit-breaker.service';
import { OwnershipLeaseService } from '../queue/services/ownership-lease.service';
import { EncodingFileService, type JobResult, type JobWithPolicy } from './encoding-file.service';
import { EncodingValidatorService } from './encoding-validator.service';
import { InsufficientDiskSpaceError, SystemResourceService } from './system-resource.service';
import { WorkerPoolService } from './worker-pool.service';

// ADMISSION CONTROL: how long to defer a job that couldn't claim enough disk
// space before rechecking. Short enough that a job doesn't sit idle long
// after another job frees space; long enough to avoid hammering statfs.
const DISK_SPACE_RETRY_DELAY_MS = parseInt(
  process.env.DISK_SPACE_RETRY_DELAY_MS || `${5 * 60 * 1000}`,
  10
);

/**
 * ProcessorLoopService
 *
 * Owns the per-worker processing loop and job execution:
 * - processLoop: drives the continuous poll-and-encode cycle per worker
 * - processNextJob: dequeues one job, encodes it, handles completion/failure
 * - sleep: internal polling delay helper
 */
@Injectable()
export class ProcessorLoopService {
  private readonly logger = new Logger(ProcessorLoopService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly queueService: QueueService,
    private readonly workerPoolService: WorkerPoolService,
    private readonly systemResourceService: SystemResourceService,
    private readonly encodingFileService: EncodingFileService,
    private readonly fileRelocatorService: FileRelocatorService,
    private readonly encodingValidator: EncodingValidatorService,
    private readonly ownershipLease: OwnershipLeaseService,
    private readonly circuitBreaker: CircuitBreakerService
  ) {}

  /**
   * Processing loop for a worker.
   * CRITICAL #3 FIX: Added background heartbeat to prevent false auto-heal.
   *
   * Continuously polls for new jobs while worker is running.
   * Each worker runs independently and competes for jobs from the queue.
   *
   * @param workerId - Unique worker identifier
   * @param _nodeId - Node identifier (unused directly; resolved via workerPoolService)
   */
  async processLoop(workerId: string, _nodeId: string): Promise<void> {
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
   * Process next job for a worker.
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
      const healedJob = await this.encodingValidator.validateAndHealJobPolicy(job as JobWithPolicy);
      // Update local reference if job was healed
      Object.assign(job, healedJob);

      // AV1 THROTTLING: Log throttling status if job is resource-throttled
      // Note: skipNodeThrottleCheck was removed - throttling is now automatic based on system load

      // Update worker state
      this.workerPoolService.setWorkerJob(workerId, job.id);

      // LEASE: Stamp initial lease expiry and begin renewal loop so MAIN can detect
      // network-partitioned workers. Lease is set atomically here; renewal runs every 30s.
      await this.jobRepository.updateById(job.id, {
        ownershipLeaseExpiry: new Date(Date.now() + 60_000),
      });
      this.ownershipLease.startRenewing(job.id, nodeId);

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
        await this.systemResourceService.performResourcePreflightChecks(
          job.filePath,
          job.id,
          job.targetCodec,
          job.beforeSizeBytes
        );

        // Perform encoding
        const result = await this.encodingFileService.encodeFile(job);

        // Handle successful completion
        await this.encodingValidator.handleJobCompletion(job, result);

        return job;
      } catch (error: unknown) {
        if (error instanceof InsufficientDiskSpaceError) {
          // ADMISSION CONTROL: defer, don't fail - low disk space is usually
          // a transient, queue-wide condition. Leave the job QUEUED with a
          // future nextRetryAt instead of burning a retry attempt.
          await this.deferJobForDiskSpace(job, error);
          return null;
        }
        // Handle failure with retry logic
        await this.encodingValidator.handleJobFailure(job, error);
        return null;
      } finally {
        // LEASE: Stop renewal and clear lease - job is done (success, failure, or pause).
        this.ownershipLease.stopRenewing(job.id);
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
   * ADMISSION CONTROL: leave a disk-space-blocked job in QUEUED with a future
   * nextRetryAt instead of failing it. The claim query already skips jobs
   * whose nextRetryAt is in the future, so this simply reschedules the job -
   * no retryCount increment, no failure tracking, since the file itself did
   * nothing wrong.
   *
   * Still routed through the global circuit breaker: a disk that is
   * permanently too full (not just transiently busy) would otherwise defer
   * this job every 5 minutes forever with no cap and no visible failure -
   * every other requeue loop in this codebase (corrupted-requeue, stuck-
   * recovery) shares that same cap, so this one does too.
   */
  private async deferJobForDiskSpace(
    job: JobWithPolicy,
    error: InsufficientDiskSpaceError
  ): Promise<void> {
    const broken = await this.circuitBreaker.checkAndBreak(
      job.id,
      `insufficient disk space (${error.availableGB.toFixed(2)}GB available, ${error.requiredGB.toFixed(2)}GB needed)`
    );
    if (broken) {
      this.logger.warn(
        `[${job.id}] Circuit broken after repeated disk-space deferrals: ${job.fileLabel} -> FAILED permanently`
      );
      return;
    }

    const nextRetryAt = new Date(Date.now() + DISK_SPACE_RETRY_DELAY_MS);
    this.logger.warn(
      `[${job.id}] Deferring job (${job.fileLabel}) - insufficient disk space ` +
        `(${error.availableGB.toFixed(2)}GB available, ${error.requiredGB.toFixed(2)}GB needed). ` +
        `Will retry at ${nextRetryAt.toISOString()}`
    );

    await this.jobRepository.updateById(job.id, {
      stage: JobStage.QUEUED,
      startedAt: null,
      nextRetryAt,
      error: `Waiting for disk space: ${error.availableGB.toFixed(1)}GB available, ${error.requiredGB.toFixed(1)}GB needed. Retrying automatically.`,
    });
  }

  /**
   * Handle job completion - delegates to EncodingValidatorService.
   */
  async handleJobCompletion(job: JobWithPolicy, result: JobResult): Promise<void> {
    return this.encodingValidator.handleJobCompletion(job, result);
  }

  /**
   * Handle job failure - delegates to EncodingValidatorService.
   */
  async handleJobFailure(job: JobWithPolicy, error: unknown): Promise<void> {
    return this.encodingValidator.handleJobFailure(job, error);
  }

  /**
   * Sleep helper
   * @private
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
