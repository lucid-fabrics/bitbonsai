import { Injectable, Logger } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../common/repositories/job.repository';
import { FfmpegService } from './ffmpeg.service';
import { PoolLockService } from './pool-lock.service';
import { SystemResourceService } from './system-resource.service';

export interface WorkerState {
  workerId: string; // Unique worker identifier: "nodeId-worker-1"
  nodeId: string;
  isRunning: boolean;
  currentJobId: string | null;
  startedAt: Date;
  shutdownPromise?: Promise<void>; // Promise that resolves when worker loop exits
  shutdownResolve?: () => void; // Function to resolve the shutdown promise
}

export interface NodeWorkerPool {
  nodeId: string;
  maxWorkers: number;
  activeWorkers: Set<string>; // Set of workerIds currently running
}

/**
 * WorkerPoolService
 *
 * Manages worker slot lifecycle: creation, tracking, and teardown.
 * Extracted from EncodingProcessorService to isolate pool management concerns.
 *
 * Responsibilities:
 * - Worker pool creation and destruction per node
 * - Worker state tracking (WorkerState, NodeWorkerPool maps)
 * - Graceful shutdown (signal → await → cleanup)
 * - Crash recovery: kill orphaned FFmpeg, reset job to QUEUED, restart worker slot
 */
@Injectable()
export class WorkerPoolService {
  private readonly logger = new Logger(WorkerPoolService.name);

  private readonly workerPools = new Map<string, NodeWorkerPool>();
  private readonly workers = new Map<string, WorkerState>();

  constructor(
    private readonly poolLockService: PoolLockService,
    private readonly systemResourceService: SystemResourceService,
    private readonly ffmpegService: FfmpegService,
    private readonly jobRepository: JobRepository
  ) {}

  // ---------------------------------------------------------------------------
  // Pool-level read access (used by EncodingProcessorService)
  // ---------------------------------------------------------------------------

  getPool(nodeId: string): NodeWorkerPool | undefined {
    return this.workerPools.get(nodeId);
  }

  getWorker(workerId: string): WorkerState | undefined {
    return this.workers.get(workerId);
  }

  getAllWorkers(): Map<string, WorkerState> {
    return this.workers;
  }

  // ---------------------------------------------------------------------------
  // startWorkerPool
  // ---------------------------------------------------------------------------

  /**
   * Start (or expand) a worker pool for a node.
   *
   * ISSUE #10 FIX: Wrapped in mutex lock to prevent concurrent modifications.
   *
   * @param nodeId - Node unique identifier
   * @param maxWorkers - Maximum number of concurrent workers (default: systemResourceService default)
   * @param startWorkerFn - Callback that launches the actual processing loop for a worker slot
   * @returns Number of workers actually started
   */
  async startWorkerPool(
    nodeId: string,
    maxWorkers = this.systemResourceService.defaultWorkersPerNode,
    startWorkerFn: (workerId: string, nodeId: string) => Promise<void>
  ): Promise<number> {
    // CRITICAL #3 FIX: Use withPoolLock to ensure release on error
    return await this.poolLockService.withLock(nodeId, 'startWorkerPool', async () => {
      // Validate maxWorkers
      const validatedMaxWorkers = Math.min(
        Math.max(1, maxWorkers),
        this.systemResourceService.maxWorkersPerNode
      );

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
          await this.startWorker(workerId, nodeId, startWorkerFn);
          workersStarted++;
        } catch (error: unknown) {
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

  // ---------------------------------------------------------------------------
  // startWorker
  // ---------------------------------------------------------------------------

  /**
   * Start a single worker slot and wire up crash recovery.
   *
   * CRITICAL FIX: Wraps the processing loop in try-catch to prevent worker pool
   * memory leak on unhandled rejection.
   *
   * @param workerId - Unique worker identifier (e.g., "nodeId-worker-1")
   * @param nodeId - Node unique identifier
   * @param startWorkerFn - Async function that runs the worker's processing loop
   */
  async startWorker(
    workerId: string,
    nodeId: string,
    startWorkerFn: (workerId: string, nodeId: string) => Promise<void>
  ): Promise<void> {
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
    startWorkerFn(workerId, nodeId).catch(async (error) => {
      this.logger.error(`[${workerId}] Worker crashed:`, error);

      // CRITICAL #7 FIX: Get worker state BEFORE deleting
      const crashedWorker = this.workers.get(workerId);
      const pool = this.workerPools.get(nodeId);

      if (!crashedWorker || !pool) {
        this.logger.error(`[${workerId}] Worker or pool not found during crash cleanup`);
        return;
      }

      // CRITICAL #7 FIX: Kill active FFmpeg process if encoding
      if (crashedWorker.currentJobId) {
        this.logger.warn(
          `[${workerId}] Killing orphaned FFmpeg for job ${crashedWorker.currentJobId}`
        );

        try {
          await this.ffmpegService.killProcess(crashedWorker.currentJobId);
        } catch (killError: unknown) {
          this.logger.error(
            `[${workerId}] Failed to kill FFmpeg for job ${crashedWorker.currentJobId}`,
            killError
          );
        }

        // CRITICAL #7 FIX: Reset job to QUEUED for retry
        try {
          await this.jobRepository.updateById(crashedWorker.currentJobId, {
            stage: JobStage.QUEUED,
            error: `Worker ${workerId} crashed during encoding`,
            retryCount: { increment: 1 },
          });
          this.logger.log(`[${workerId}] Reset job ${crashedWorker.currentJobId} to QUEUED`);
        } catch (jobError: unknown) {
          this.logger.error(
            `[${workerId}] Failed to reset job ${crashedWorker.currentJobId}`,
            jobError
          );
        }
      }

      // CLEANUP: Remove worker from tracking
      pool.activeWorkers.delete(workerId);
      this.workers.delete(workerId);

      // Resolve shutdown promise
      if (crashedWorker.shutdownResolve) {
        crashedWorker.shutdownResolve();
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
          await this.startWorker(newWorkerId, nodeId, startWorkerFn);
          this.logger.log(`[${nodeId}] Replacement worker ${newWorkerId} started`);
        } catch (restartError: unknown) {
          this.logger.error(`[${nodeId}] Failed to restart worker after crash`, restartError);
        }
      }

      this.logger.log(`[${workerId}] Worker cleanup complete after crash`);
    });
  }

  // ---------------------------------------------------------------------------
  // stopWorker
  // ---------------------------------------------------------------------------

  /**
   * Stop worker pool for a node.
   *
   * Gracefully stops all workers for a node after current jobs complete.
   * Will not interrupt running jobs.
   *
   * ISSUE #10 FIX: Wrapped in mutex lock to prevent concurrent modifications.
   *
   * @param nodeId - Node unique identifier
   * @param workerId - Optional specific worker ID to stop (if not provided, stops all workers for node)
   */
  async stopWorker(nodeId: string, workerId?: string): Promise<void> {
    // CRITICAL #3 FIX: Acquire lock before modifying pool
    const holder = workerId ? `stopWorker:${workerId}` : 'stopWorker:all';
    await this.poolLockService.withLock(nodeId, holder, async () => {
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

  // ---------------------------------------------------------------------------
  // Pool state mutators (called from processLoop in EncodingProcessorService)
  // ---------------------------------------------------------------------------

  /**
   * Remove a worker from the active tracking maps.
   * Called by processLoop's finally block on normal exit.
   */
  removeWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      const pool = this.workerPools.get(worker.nodeId);
      if (pool) {
        pool.activeWorkers.delete(workerId);
      }
      this.workers.delete(workerId);
    }
  }

  /**
   * Mark a worker as currently processing a job.
   */
  setWorkerJob(workerId: string, jobId: string | null): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.currentJobId = jobId;
    }
  }

  /**
   * Resolve a worker's shutdown promise (called from processLoop finally).
   */
  resolveShutdown(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (worker?.shutdownResolve) {
      worker.shutdownResolve();
    }
  }
}
