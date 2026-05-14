import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';

interface MonitorEntry {
  interval: ReturnType<typeof setInterval>;
  pid: number;
  outputDir: string;
  isPaused: boolean;
  recoveryInterval: ReturnType<typeof setInterval> | null;
}

const POLL_INTERVAL_MS = 30_000; // check every 30s
const RECOVERY_POLL_MS = 10_000; // re-check every 10s while paused
const MAX_RECOVERY_WAIT_MS = 10 * 60 * 1000; // 10 minutes
const MIN_FREE_BYTES = BigInt(2 * 1024 ** 3); // 2 GB hard floor

/**
 * DiskSpaceGuardService
 *
 * Monitors free disk space on the output filesystem during active encodes.
 * If free space drops below 2 GB the ffmpeg process is paused (SIGSTOP) to prevent
 * a mid-encode ENOSPC failure. Encoding resumes automatically (SIGCONT) once space
 * is freed. After 10 minutes without recovery, SIGCONT is sent anyway so ffmpeg can
 * fail naturally with ENOSPC rather than hanging forever.
 *
 * Follows the same SIGSTOP/SIGCONT pattern as NfsHealthService.
 */
@Injectable()
export class DiskSpaceGuardService {
  private readonly logger = new Logger(DiskSpaceGuardService.name);
  private readonly monitors = new Map<string, MonitorEntry>();

  startMonitoring(jobId: string, tempOutputPath: string, ffmpegPid: number): void {
    if (this.monitors.has(jobId)) {
      this.stopMonitoring(jobId);
    }

    const outputDir = dirname(tempOutputPath);

    const interval = setInterval(() => {
      void this.checkDiskSpace(jobId);
    }, POLL_INTERVAL_MS);

    this.monitors.set(jobId, {
      interval,
      pid: ffmpegPid,
      outputDir,
      isPaused: false,
      recoveryInterval: null,
    });

    this.logger.debug(`[${jobId}] Disk space guard started for ${outputDir} (pid ${ffmpegPid})`);
  }

  stopMonitoring(jobId: string): void {
    const entry = this.monitors.get(jobId);
    if (!entry) return;

    clearInterval(entry.interval);
    if (entry.recoveryInterval) {
      clearInterval(entry.recoveryInterval);
    }

    if (entry.isPaused) {
      this.sendSignal(entry.pid, 'SIGCONT', jobId, 'stop cleanup');
    }

    this.monitors.delete(jobId);
    this.logger.debug(`[${jobId}] Disk space guard stopped`);
  }

  private async checkDiskSpace(jobId: string): Promise<void> {
    const entry = this.monitors.get(jobId);
    if (!entry || entry.isPaused) return;

    const freeBytes = await this.checkFreeSpace(entry.outputDir);

    if (freeBytes >= MIN_FREE_BYTES) return;

    const freeMB = Number(freeBytes / BigInt(1024 ** 2));
    this.logger.warn(
      `Disk pressure on ${entry.outputDir}: ${freeMB}MB remaining — pausing ffmpeg pid ${entry.pid}`
    );

    entry.isPaused = true;
    this.sendSignal(entry.pid, 'SIGSTOP', jobId, 'disk pressure');

    // Stop the regular poll while in recovery
    clearInterval(entry.interval);
    entry.interval = null as unknown as ReturnType<typeof setInterval>;

    const recoveryStart = Date.now();

    const recoveryInterval = setInterval(async () => {
      const current = this.monitors.get(jobId);
      if (!current) {
        clearInterval(recoveryInterval);
        return;
      }

      const currentFreeBytes = await this.checkFreeSpace(current.outputDir);

      if (currentFreeBytes >= MIN_FREE_BYTES) {
        clearInterval(recoveryInterval);
        current.recoveryInterval = null;
        current.isPaused = false;

        const freeMBNow = Number(currentFreeBytes / BigInt(1024 ** 2));
        this.logger.log(
          `Disk space recovered (${freeMBNow}MB free) — resuming ffmpeg pid ${current.pid}`
        );
        this.sendSignal(current.pid, 'SIGCONT', jobId, 'disk recovery');

        // Restart regular poll
        current.interval = setInterval(() => {
          void this.checkDiskSpace(jobId);
        }, POLL_INTERVAL_MS);

        return;
      }

      if (Date.now() - recoveryStart >= MAX_RECOVERY_WAIT_MS) {
        clearInterval(recoveryInterval);
        current.recoveryInterval = null;
        current.isPaused = false;

        this.logger.warn(
          `[${jobId}] Disk space did not recover after 10 minutes — sending SIGCONT to let ffmpeg fail naturally`
        );
        this.sendSignal(current.pid, 'SIGCONT', jobId, '10-min timeout');

        // Stop monitoring entirely — restarting the poll would immediately detect disk pressure
        // again and cause another SIGSTOP/SIGCONT loop. Let ffmpeg hit ENOSPC and fail cleanly.
        this.stopMonitoring(jobId);
      }
    }, RECOVERY_POLL_MS);

    entry.recoveryInterval = recoveryInterval;
  }

  /**
   * Returns available bytes on the filesystem containing `dir`.
   * Uses Node 18.13+ native fs.promises.statfs().
   * Returns 0 on any error so the caller treats it conservatively.
   */
  private async checkFreeSpace(dir: string): Promise<bigint> {
    try {
      const stats = await fs.statfs(dir);
      return BigInt(stats.bfree) * BigInt(stats.bsize);
    } catch (err) {
      this.logger.debug(`Failed to statfs ${dir}: ${err}`);
      return BigInt(0);
    }
  }

  private sendSignal(
    pid: number,
    signal: 'SIGSTOP' | 'SIGCONT',
    jobId: string,
    context: string
  ): void {
    try {
      process.kill(pid, signal);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') {
        this.logger.debug(
          `[${jobId}] ffmpeg pid ${pid} no longer exists during ${context} (${signal}) — skipping`
        );
      } else {
        this.logger.error(
          `[${jobId}] Failed to send ${signal} to pid ${pid} during ${context}: ${err}`
        );
      }
    }
  }
}
