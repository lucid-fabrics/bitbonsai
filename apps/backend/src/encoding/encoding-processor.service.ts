import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type JobResult, type JobWithPolicy } from './encoding-file.service';
import { ProcessorLifecycleService } from './processor-lifecycle.service';
import { ProcessorLoopService } from './processor-loop.service';
import { SystemResourceService } from './system-resource.service';

// Note: resumeTimestamp and keepOriginalRequested exist as temporary properties
// on Job instances for encoding resume functionality

/**
 * EncodingProcessorService
 *
 * Thin orchestrator: delegates lifecycle to ProcessorLifecycleService
 * and per-worker loop/job execution to ProcessorLoopService.
 *
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
  constructor(
    private readonly lifecycle: ProcessorLifecycleService,
    private readonly loop: ProcessorLoopService,
    private readonly systemResourceService: SystemResourceService
  ) {}

  /**
   * Auto-start worker pools for all online nodes on module initialization.
   * Also performs auto-heal to recover from crashes/reboots.
   */
  async onModuleInit(): Promise<void> {
    await this.lifecycle.initialize((workerId, nodeId) => this.loop.processLoop(workerId, nodeId));
  }

  /**
   * AUDIT #2 ISSUE #24 FIX: Cleanup on module destruction.
   * CRITICAL #5 FIX: Clear ALL tracked intervals to prevent leaks on hot reload.
   */
  onModuleDestroy(): void {
    this.lifecycle.destroy();
  }

  /**
   * Start a worker pool for a node.
   *
   * @param nodeId - Node unique identifier
   * @param maxWorkers - Maximum number of concurrent workers
   * @returns Number of workers actually started
   */
  async startWorkerPool(
    nodeId: string,
    maxWorkers = this.systemResourceService.defaultWorkersPerNode
  ): Promise<number> {
    return this.lifecycle.startWorkerPool(nodeId, maxWorkers, (workerId, nId) =>
      this.loop.processLoop(workerId, nId)
    );
  }

  /**
   * Stop worker pool for a node.
   *
   * @param nodeId - Node unique identifier
   * @param workerId - Optional specific worker ID to stop (stops all if omitted)
   */
  async stopWorker(nodeId: string, workerId?: string): Promise<void> {
    return this.lifecycle.stopWorker(nodeId, workerId);
  }

  /**
   * Process next job for a worker.
   * Delegates to ProcessorLoopService.
   *
   * @param workerId - Unique worker identifier
   * @returns Processed job or null if none available
   */
  async processNextJob(workerId: string): Promise<JobWithPolicy | null> {
    return this.loop.processNextJob(workerId);
  }

  /**
   * Handle job completion — delegates to ProcessorLoopService → EncodingValidatorService.
   */
  async handleJobCompletion(job: JobWithPolicy, result: JobResult): Promise<void> {
    return this.loop.handleJobCompletion(job, result);
  }

  /**
   * Handle job failure — delegates to ProcessorLoopService → EncodingValidatorService.
   */
  async handleJobFailure(job: JobWithPolicy, error: unknown): Promise<void> {
    return this.loop.handleJobFailure(job, error);
  }
}
