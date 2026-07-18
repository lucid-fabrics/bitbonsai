import * as os from 'node:os';
import { Injectable, Logger } from '@nestjs/common';
import { JobRepository } from '../common/repositories/job.repository';
import { NodesService } from '../nodes/nodes.service';
import { QueueService } from '../queue/queue.service';
import { FfmpegService } from './ffmpeg.service';
import { SystemResourceService } from './system-resource.service';
import { WorkerPoolService } from './worker-pool.service';

/**
 * EncodingWatchdogService
 *
 * Background health management for the encoding system:
 * - Auto-cleans zombie FFmpeg processes
 * - Manages load-based job pausing and resuming
 * - Provides system diagnostics for stuck-job error messages
 *
 * Stuck/frozen ENCODING job recovery lives in StuckJobRecoveryWorker, not
 * here - see startStuckJobWatchdog() for why.
 */
@Injectable()
export class EncodingWatchdogService {
  private readonly logger = new Logger(EncodingWatchdogService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly queueService: QueueService,
    private readonly nodesService: NodesService,
    private readonly ffmpegService: FfmpegService,
    private readonly systemResourceService: SystemResourceService,
    private readonly workerPoolService: WorkerPoolService
  ) {}

  /**
   * Start background watchdog for zombie cleanup and load management.
   *
   * Stuck-ENCODING-job detection intentionally lives in
   * StuckJobRecoveryWorker, not here. This watchdog used to independently
   * kill+FAIL jobs stuck 5-15min purely on `updatedAt` staleness, with no
   * check for whether ffmpeg was actually still alive and producing output.
   * StuckJobRecoveryWorker runs the same detection with a real liveness
   * check (isProcessTrulyStuck), preserves resume state instead of failing
   * outright, and respects a recovery cap + circuit breaker. Having both
   * meant this watchdog's cruder 5-minute check usually fired first and
   * permanently failed jobs that were merely slow, not stuck.
   *
   * - Runs every 60 seconds
   * - Auto-cleans zombie FFmpeg processes
   * - Auto-pauses jobs when load is high, resumes when load drops
   *
   * @returns The interval ID so caller can clear it on module destroy
   */
  startStuckJobWatchdog(): NodeJS.Timeout {
    this.logger.log(
      '👀 Starting watchdog (checks every 60s: zombie cleanup, load-based auto-pause)'
    );

    return setInterval(async () => {
      try {
        // UX PHILOSOPHY: Auto-cleanup zombie FFmpeg processes (self-healing)
        // This eliminates the need for manual "Kill Zombies" button in debug UI
        await this.autoCleanupZombieProcesses();

        // CRITICAL FIX: Intelligent load management
        await this.manageLoadBasedPausing();
      } catch (error: unknown) {
        this.logger.error('Watchdog check failed:', error);
      }
    }, 60 * 1000); // Every 60 seconds
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
    } catch (error: unknown) {
      // Silently handle errors - don't let zombie cleanup crash the watchdog
      this.logger.debug(`Zombie cleanup error (non-fatal): ${error}`);
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
   */
  async manageLoadBasedPausing(): Promise<void> {
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
    const encodingJobs = await this.jobRepository.countWhere({
      stage: 'ENCODING',
      nodeId: currentNode.id,
    });

    // Determine target worker limit based on load ratio (load per CPU)
    // Use node's configured maxWorkers, not the calculated default
    const nodeMaxWorkers =
      currentNode.maxWorkers || this.systemResourceService.defaultWorkersPerNode;
    let targetWorkers: number;
    let loadLevel: string;
    const loadRatio = loadAvg / cpuCount;

    // HIGH #9 FIX: Apply loadThresholdMultiplier to all thresholds
    // Default multiplier is 5.0, making thresholds: 5.0, 10.0, 15.0
    const normalThreshold = 1.0 * this.systemResourceService.getLoadThresholdMultiplier(); // Default: 5.0
    const moderateThreshold = 2.0 * this.systemResourceService.getLoadThresholdMultiplier(); // Default: 10.0
    const highThreshold = 3.0 * this.systemResourceService.getLoadThresholdMultiplier(); // Default: 15.0

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
    const pausedJobs = await this.jobRepository.countWhere({
      stage: 'PAUSED_LOAD',
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
      const jobsToAutoPause = await this.jobRepository.findManyWithInclude<{
        id: string;
        fileLabel: string;
        priority: number;
      }>({
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
      const jobsToAutoResume = await this.jobRepository.findManyWithInclude<{
        id: string;
        fileLabel: string;
        priority: number;
      }>({
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
   */
  async getSystemDiagnostics(jobId: string): Promise<string> {
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
      const allWorkers = Array.from(this.workerPoolService.getAllWorkers().values());
      const activeWorkers = allWorkers.filter((w) => w.currentJobId !== null);
      diagnostics.push(`- Active workers: ${activeWorkers.length}/${allWorkers.length}`);

      // FFmpeg process status
      const hasProcess = this.ffmpegService.hasActiveProcess(jobId);
      diagnostics.push(`- FFmpeg process active: ${hasProcess ? 'Yes' : 'No'}`);
    } catch (error: unknown) {
      diagnostics.push(`- Diagnostic collection failed: ${error}`);
    }

    return diagnostics.join('\n');
  }
}
