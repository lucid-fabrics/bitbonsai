import { type ChildProcess, spawn } from 'node:child_process';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EncodingCancelledEvent, EncodingProcessMarkedEvent } from '../../common/events';
import { JobRepository } from '../../common/repositories/job.repository';
import { FfmpegProcessCleanupService } from '../ffmpeg-process-cleanup.service';

/**
 * Active encoding process tracking
 */
export interface ActiveEncoding {
  jobId: string;
  process: ChildProcess;
  startTime: Date;
  lastProgress: number;
  lastStderr: string; // Last 2000 chars of stderr for error reporting
  lastOutputTime: Date; // Last time FFmpeg produced ANY output (for stuck detection)
  isPauseOrCancelRequested: boolean; // Set before killing to prevent false FAILED state
  completionHandled: boolean; // Guards against double close+error event firing
}

/**
 * FfmpegProcessManager
 *
 * Owns process lifecycle: spawn, kill, cleanup, stderr capture, process tracking.
 * Also manages the stderrCache and per-job preview throttle tracking.
 */
@Injectable()
export class FfmpegProcessManager {
  readonly logger = new Logger(FfmpegProcessManager.name);
  readonly activeEncodings = new Map<string, ActiveEncoding>();

  // Cache stderr output for recently completed/failed jobs
  private readonly stderrCache = new Map<string, { stderr: string; timestamp: Date }>();
  private readonly STDERR_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private stderrCleanupInterval?: NodeJS.Timeout;

  // Preview generation throttling (jobId -> last generation timestamp)
  readonly lastPreviewGeneration = new Map<string, number>();
  readonly PREVIEW_THROTTLE_MS = 30 * 1000; // 30 seconds

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly eventEmitter: EventEmitter2,
    readonly processCleanup: FfmpegProcessCleanupService
  ) {}

  startStderrCleanupInterval(): void {
    this.stderrCleanupInterval = setInterval(
      () => {
        this.cleanupStaleStderrCache();
      },
      15 * 60 * 1000
    );
  }

  stopStderrCleanupInterval(): void {
    if (this.stderrCleanupInterval) {
      clearInterval(this.stderrCleanupInterval);
    }
  }

  private cleanupStaleStderrCache(): void {
    const now = Date.now();
    let removed = 0;

    for (const [jobId, entry] of this.stderrCache.entries()) {
      if (now - entry.timestamp.getTime() > this.STDERR_CACHE_TTL_MS) {
        this.stderrCache.delete(jobId);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug(`🧹 Cleaned up ${removed} stale stderr cache entries`);
    }
  }

  private cleanupStderrCache(): void {
    const now = Date.now();
    for (const [jobId, entry] of this.stderrCache.entries()) {
      if (now - entry.timestamp.getTime() > this.STDERR_CACHE_TTL_MS) {
        this.stderrCache.delete(jobId);
      }
    }
  }

  cacheStderr(jobId: string, stderr: string): void {
    if (stderr) {
      this.stderrCache.set(jobId, {
        stderr,
        timestamp: new Date(),
      });
    }
  }

  getLastStderr(jobId: string): string | null {
    const activeEncoding = this.activeEncodings.get(jobId);
    if (activeEncoding?.lastStderr) {
      return activeEncoding.lastStderr;
    }

    const cachedStderr = this.stderrCache.get(jobId);
    if (cachedStderr) {
      this.cleanupStderrCache();
      return cachedStderr.stderr;
    }

    return null;
  }

  clearAllCaches(): void {
    this.stderrCache.clear();
    this.lastPreviewGeneration.clear();
  }

  getNiceValue(priority: number): number {
    switch (priority) {
      case 2:
        return -10;
      case 1:
        return -5;
      default:
        return 0;
    }
  }

  spawnFfmpegProcess(args: string[], niceValue: number): ChildProcess {
    if (niceValue !== 0) {
      return spawn('nice', ['-n', niceValue.toString(), 'ffmpeg', ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    }
    return spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
  }

  createActiveEncoding(jobId: string, process: ChildProcess): ActiveEncoding {
    const activeEncoding: ActiveEncoding = {
      jobId,
      process,
      startTime: new Date(),
      lastProgress: 0,
      lastStderr: '',
      lastOutputTime: new Date(),
      isPauseOrCancelRequested: false,
      completionHandled: false,
    };
    this.activeEncodings.set(jobId, activeEncoding);
    return activeEncoding;
  }

  /**
   * Kill FFmpeg process for a job without marking it as cancelled
   */
  async killProcess(jobId: string, markProcessed = true): Promise<boolean> {
    const activeEncoding = this.activeEncodings.get(jobId);
    if (!activeEncoding) {
      return false;
    }

    try {
      if (markProcessed) {
        const jobStatus = await this.jobRepository.findStatusFields(jobId);
        const updateData: Record<string, Date> = {};
        if (jobStatus?.pauseRequestedAt && !jobStatus.pauseProcessedAt) {
          updateData.pauseProcessedAt = new Date();
        }
        if (jobStatus?.cancelRequestedAt && !jobStatus.cancelProcessedAt) {
          updateData.cancelProcessedAt = new Date();
        }
        if (Object.keys(updateData).length > 0) {
          this.eventEmitter.emit(
            EncodingProcessMarkedEvent.event,
            new EncodingProcessMarkedEvent(jobId, updateData)
          );
        }
      }

      try {
        if (activeEncoding.process.pid) {
          process.kill(-activeEncoding.process.pid, 'SIGTERM');
        } else {
          this.logger.warn(`killProcess: no PID for job ${jobId}, process may already be dead`);
        }
      } catch (killError) {
        const err = killError as NodeJS.ErrnoException;
        if (err.code !== 'ESRCH') throw killError;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (!activeEncoding.process.killed) {
        try {
          if (activeEncoding.process.pid) {
            process.kill(-activeEncoding.process.pid, 'SIGKILL');
          } else {
            this.logger.warn(`killProcess: no PID for force-kill of job ${jobId}`);
          }
        } catch (killError) {
          const err = killError as NodeJS.ErrnoException;
          if (err.code !== 'ESRCH') throw killError;
        }
      }

      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to kill FFmpeg process for job ${jobId}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Cancel encoding job — kills process and emits cancellation event
   */
  async cancelEncoding(jobId: string): Promise<boolean> {
    const activeEncoding = this.activeEncodings.get(jobId);
    if (!activeEncoding) {
      this.logger.warn(`Cannot cancel job ${jobId}: not currently encoding`);
      return false;
    }

    this.logger.log(`Cancelling encoding for job ${jobId}`);

    try {
      try {
        if (activeEncoding.process.pid) {
          process.kill(-activeEncoding.process.pid, 'SIGTERM');
        } else {
          this.logger.warn(`killProcess: no PID for job ${jobId}, process may already be dead`);
        }
      } catch (killError) {
        const err = killError as NodeJS.ErrnoException;
        if (err.code !== 'ESRCH') throw killError;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (!activeEncoding.process.killed) {
        try {
          if (activeEncoding.process.pid) {
            process.kill(-activeEncoding.process.pid, 'SIGKILL');
          } else {
            this.logger.warn(`killProcess: no PID for force-kill of job ${jobId}`);
          }
        } catch (killError) {
          const err = killError as NodeJS.ErrnoException;
          if (err.code !== 'ESRCH') throw killError;
        }
      }

      this.eventEmitter.emit(EncodingCancelledEvent.event, new EncodingCancelledEvent(jobId));

      if (activeEncoding.lastStderr) {
        this.cacheStderr(jobId, activeEncoding.lastStderr);
      }

      this.activeEncodings.delete(jobId);
      this.logger.log(`Encoding cancelled for job ${jobId}`);
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to cancel job ${jobId}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Pause encoding job via SIGSTOP
   */
  async pauseEncoding(jobId: string): Promise<boolean> {
    const activeEncoding = this.activeEncodings.get(jobId);
    if (!activeEncoding) {
      this.logger.warn(`Cannot pause job ${jobId}: not currently encoding`);
      return false;
    }

    this.logger.log(`Pausing encoding for job ${jobId}`);

    try {
      activeEncoding.process.kill('SIGSTOP');
      this.logger.log(`Encoding paused for job ${jobId}`);
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to pause job ${jobId}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Resume encoding job via SIGCONT
   */
  async resumeEncoding(jobId: string): Promise<boolean> {
    const activeEncoding = this.activeEncodings.get(jobId);
    if (!activeEncoding) {
      this.logger.warn(`Cannot resume job ${jobId}: not currently encoding`);
      return false;
    }

    this.logger.log(`Resuming encoding for job ${jobId}`);

    try {
      activeEncoding.process.kill('SIGCONT');
      this.logger.log(`Encoding resumed for job ${jobId}`);
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to resume job ${jobId}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Renice an active FFmpeg process
   */
  async reniceProcess(jobId: string, priority: number): Promise<boolean> {
    const activeEncoding = this.activeEncodings.get(jobId);
    if (!activeEncoding || !activeEncoding.process.pid) {
      this.logger.warn(`Cannot renice job ${jobId}: no active FFmpeg process`);
      return false;
    }

    const niceValue = this.getNiceValue(priority);
    const pid = activeEncoding.process.pid;

    this.logger.log(`Renicing FFmpeg process ${pid} (job ${jobId}) to nice ${niceValue}`);

    return new Promise((resolve, reject) => {
      const renice = spawn('renice', ['-n', niceValue.toString(), '-p', pid.toString()]);

      renice.on('close', (code) => {
        if (code === 0) {
          this.logger.log(
            `Successfully reniced FFmpeg process ${pid} (job ${jobId}) to nice ${niceValue}`
          );
          resolve(true);
        } else {
          const error = `renice command failed with exit code ${code}`;
          this.logger.error(error);
          reject(new Error(error));
        }
      });

      renice.on('error', (err) => {
        this.logger.error(`Failed to execute renice: ${err.message}`);
        reject(err);
      });
    });
  }

  hasActiveProcess(jobId: string): boolean {
    return this.activeEncodings.has(jobId);
  }

  getActiveEncodings(): string[] {
    return Array.from(this.activeEncodings.keys());
  }

  getEncodingStatus(
    jobId: string
  ): { jobId: string; startTime: Date; elapsedSeconds: number } | null {
    const activeEncoding = this.activeEncodings.get(jobId);
    if (!activeEncoding) return null;

    const elapsedSeconds = Math.floor((Date.now() - activeEncoding.startTime.getTime()) / 1000);

    return {
      jobId: activeEncoding.jobId,
      startTime: activeEncoding.startTime,
      elapsedSeconds,
    };
  }

  getActiveEncodingsDetails(): Array<{
    jobId: string;
    pid: number | undefined;
    startTime: Date;
    lastProgress: number;
    lastOutputTime: Date;
    runtimeSeconds: number;
  }> {
    const result: Array<{
      jobId: string;
      pid: number | undefined;
      startTime: Date;
      lastProgress: number;
      lastOutputTime: Date;
      runtimeSeconds: number;
    }> = [];

    for (const [jobId, encoding] of this.activeEncodings) {
      result.push({
        jobId,
        pid: encoding.process.pid,
        startTime: encoding.startTime,
        lastProgress: encoding.lastProgress,
        lastOutputTime: encoding.lastOutputTime,
        runtimeSeconds: Math.floor((Date.now() - encoding.startTime.getTime()) / 1000),
      });
    }

    return result;
  }

  getLastOutputTime(jobId: string): Date | undefined {
    return this.activeEncodings.get(jobId)?.lastOutputTime;
  }

  isProcessTrulyStuck(jobId: string, timeoutMinutes: number): boolean {
    const encoding = this.activeEncodings.get(jobId);
    if (!encoding) return false;

    const now = new Date();
    const minutesSinceOutput = (now.getTime() - encoding.lastOutputTime.getTime()) / 1000 / 60;
    return minutesSinceOutput >= timeoutMinutes;
  }

  async findSystemFfmpegProcesses(): Promise<
    Array<{
      pid: number;
      command: string;
      cpuPercent: number;
      memPercent: number;
      runtimeSeconds: number;
    }>
  > {
    return this.processCleanup.findSystemFfmpegProcesses();
  }

  async detectZombieFfmpegProcesses(): Promise<
    Array<{
      pid: number;
      command: string;
      cpuPercent: number;
      memPercent: number;
      runtimeSeconds: number;
      isZombie: boolean;
      trackedJobId: string | null;
    }>
  > {
    const systemProcesses = await this.processCleanup.findSystemFfmpegProcesses();
    const trackedPids = new Set<number>();

    for (const encoding of this.activeEncodings.values()) {
      if (encoding.process.pid) {
        trackedPids.add(encoding.process.pid);
      }
    }

    const pidToJobId = new Map<number, string>();
    for (const [jobId, encoding] of this.activeEncodings) {
      if (encoding.process.pid) {
        pidToJobId.set(encoding.process.pid, jobId);
      }
    }

    return systemProcesses.map((proc) => ({
      ...proc,
      isZombie: !trackedPids.has(proc.pid),
      trackedJobId: pidToJobId.get(proc.pid) || null,
    }));
  }

  async killFfmpegByPid(pid: number): Promise<{ success: boolean; message: string }> {
    const trackedPids = new Set<number>();
    const trackedPidToJobId = new Map<number, string>();
    for (const [jobId, encoding] of this.activeEncodings) {
      if (encoding.process.pid) {
        trackedPids.add(encoding.process.pid);
        trackedPidToJobId.set(encoding.process.pid, jobId);
      }
    }
    return this.processCleanup.killFfmpegByPid(pid, trackedPids, trackedPidToJobId);
  }

  async killAllZombieFfmpegProcesses(): Promise<{
    killed: number;
    failed: number;
    details: Array<{ pid: number; success: boolean; message: string }>;
  }> {
    const zombies = await this.detectZombieFfmpegProcesses();
    const zombieProcesses = zombies.filter((p) => p.isZombie);

    const details: Array<{ pid: number; success: boolean; message: string }> = [];
    let killed = 0;
    let failed = 0;

    for (const zombie of zombieProcesses) {
      const result = await this.killFfmpegByPid(zombie.pid);
      details.push({ pid: zombie.pid, ...result });
      if (result.success) {
        killed++;
      } else {
        failed++;
      }
    }

    this.logger.log(`Zombie cleanup complete: ${killed} killed, ${failed} failed`);
    return { killed, failed, details };
  }

  async killAllFfmpegProcesses(): Promise<{
    killed: number;
    failed: number;
    details: Array<{ pid: number; success: boolean; message: string }>;
  }> {
    const allProcesses = await this.detectZombieFfmpegProcesses();

    const details: Array<{ pid: number; success: boolean; message: string }> = [];
    let killed = 0;
    let failed = 0;

    for (const proc of allProcesses) {
      const result = await this.killFfmpegByPid(proc.pid);
      details.push({ pid: proc.pid, ...result });
      if (result.success) {
        killed++;
      } else {
        failed++;
      }
    }

    this.logger.log(`All ffmpeg processes cleanup: ${killed} killed, ${failed} failed`);
    return { killed, failed, details };
  }

  /**
   * Kill all active encodings during shutdown
   */
  async killAllActiveEncodings(): Promise<void> {
    const activeJobIds = Array.from(this.activeEncodings.keys());

    if (activeJobIds.length === 0) {
      this.logger.log('No active FFmpeg processes to kill');
      return;
    }

    this.logger.log(`Killing ${activeJobIds.length} active FFmpeg process(es)...`);

    const killPromises = activeJobIds.map(async (jobId) => {
      const encoding = this.activeEncodings.get(jobId);
      if (!encoding) return;

      try {
        if (encoding.process.pid) {
          process.kill(-encoding.process.pid, 'SIGTERM');
          this.logger.log(
            `Killed FFmpeg process group for job ${jobId} (PID: ${encoding.process.pid})`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));

        if (!encoding.process.killed) {
          if (encoding.process.pid) {
            process.kill(-encoding.process.pid, 'SIGKILL');
            this.logger.log(`Force killed FFmpeg process group for job ${jobId}`);
          }
        }
      } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== 'ESRCH') {
          this.logger.warn(`Failed to kill FFmpeg for job ${jobId}: ${error}`);
        }
      }
    });

    await Promise.allSettled(killPromises);

    this.activeEncodings.clear();
    this.logger.log('FFmpeg cleanup complete');
  }
}
