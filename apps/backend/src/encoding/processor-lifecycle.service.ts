import { Injectable, Logger } from '@nestjs/common';
import { NodesService } from '../nodes/nodes.service';
import { EncodingStartupService } from './encoding-startup.service';
import { EncodingWatchdogService } from './encoding-watchdog.service';
import { FfmpegService } from './ffmpeg.service';
import { PoolLockService } from './pool-lock.service';
import { SystemResourceService } from './system-resource.service';
import { WorkerPoolService } from './worker-pool.service';

// Auto-heal timing constants (Code Convention: no magic numbers)
const AUTO_HEAL_INITIAL_DELAY_MS = 2000; // 2 seconds
const AUTO_HEAL_STABILIZATION_DELAY_MS = 3000; // 3 seconds

/**
 * ProcessorLifecycleService
 *
 * Handles the startup and shutdown lifecycle of the encoding processor:
 * - Module initialization (volume wait, auto-heal, worker pool start, watchdog)
 * - Module destruction (interval cleanup)
 * - Public startWorkerPool / stopWorker delegation surface
 */
@Injectable()
export class ProcessorLifecycleService {
  private readonly logger = new Logger(ProcessorLifecycleService.name);

  // AUDIT #2 ISSUE #24 FIX: Store watchdog interval for cleanup
  private watchdogIntervalId?: NodeJS.Timeout;

  // CRITICAL #5 FIX: Track ALL active intervals globally to prevent leaks on hot reload
  private static activeIntervals = new Set<NodeJS.Timeout>();

  constructor(
    private readonly poolLockService: PoolLockService,
    private readonly systemResourceService: SystemResourceService,
    private readonly ffmpegService: FfmpegService,
    private readonly nodesService: NodesService,
    private readonly encodingStartupService: EncodingStartupService,
    private readonly workerPoolService: WorkerPoolService,
    private readonly encodingWatchdogService: EncodingWatchdogService
  ) {}

  /**
   * Auto-start worker pools for all online nodes on module initialization.
   * Also performs auto-heal to recover from crashes/reboots.
   *
   * @param processLoopFn - Callback invoked per worker to run the processing loop
   */
  async initialize(
    processLoopFn: (workerId: string, nodeId: string) => Promise<void>
  ): Promise<void> {
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
      await new Promise((resolve) => setTimeout(resolve, AUTO_HEAL_INITIAL_DELAY_MS));

      // Step 2: Wait for volume mounts to be accessible
      await this.encodingStartupService.waitForVolumeMounts();

      // Step 3: Let file system stabilize after volumes are mounted
      this.logger.log('⏳ Waiting for file system to stabilize...');
      await new Promise((resolve) => setTimeout(resolve, AUTO_HEAL_STABILIZATION_DELAY_MS));

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
        processLoopFn
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
      ProcessorLifecycleService.activeIntervals.add(this.watchdogIntervalId);
    } catch (error: unknown) {
      this.logger.error('Failed to initialize encoding processor:', error);
    }
  }

  /**
   * AUDIT #2 ISSUE #24 FIX: Cleanup on module destruction.
   * CRITICAL #5 FIX: Clear ALL tracked intervals to prevent leaks on hot reload.
   * Prevents memory leak from watchdog interval.
   */
  destroy(): void {
    this.logger.log('🛑 Shutting down encoding processor...');

    // Clear current instance interval
    if (this.watchdogIntervalId) {
      clearInterval(this.watchdogIntervalId);
      ProcessorLifecycleService.activeIntervals.delete(this.watchdogIntervalId);
      this.watchdogIntervalId = undefined;
      this.logger.log('✓ Watchdog interval cleared');
    }

    // CRITICAL #5 FIX: Safety - clear ALL tracked intervals (hot reload protection)
    if (ProcessorLifecycleService.activeIntervals.size > 0) {
      this.logger.warn(
        `⚠️ Clearing ${ProcessorLifecycleService.activeIntervals.size} stale interval(s) from previous session`
      );
      for (const interval of ProcessorLifecycleService.activeIntervals) {
        clearInterval(interval);
      }
      ProcessorLifecycleService.activeIntervals.clear();
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
   * @param processLoopFn - Callback invoked per worker to run the processing loop
   * @returns Number of workers actually started
   */
  async startWorkerPool(
    nodeId: string,
    maxWorkers: number,
    processLoopFn: (workerId: string, nodeId: string) => Promise<void>
  ): Promise<number> {
    return this.workerPoolService.startWorkerPool(nodeId, maxWorkers, processLoopFn);
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
}
