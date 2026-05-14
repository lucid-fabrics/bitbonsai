import * as fs from 'node:fs';
import { dirname } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';

interface MonitorEntry {
  interval: ReturnType<typeof setInterval>;
  pid: number;
  mountPath: string;
  isStopped: boolean;
  recoveryInterval: ReturnType<typeof setInterval> | null;
}

const POLL_INTERVAL_MS = 30_000;
const RECOVERY_POLL_MS = 10_000;
const MAX_RECOVERY_ATTEMPTS = 30; // 5 minutes

@Injectable()
export class NfsHealthService {
  private readonly logger = new Logger(NfsHealthService.name);
  private readonly monitors = new Map<string, MonitorEntry>();

  startMonitoring(jobId: string, filePath: string, ffmpegPid: number): void {
    if (this.monitors.has(jobId)) {
      this.stopMonitoring(jobId);
    }

    const mountPath = dirname(filePath);

    const interval = setInterval(() => {
      void this.checkHealth(jobId);
    }, POLL_INTERVAL_MS);

    this.monitors.set(jobId, {
      interval,
      pid: ffmpegPid,
      mountPath,
      isStopped: false,
      recoveryInterval: null,
    });

    this.logger.debug(`[${jobId}] NFS monitor started for ${mountPath} (pid ${ffmpegPid})`);
  }

  stopMonitoring(jobId: string): void {
    const entry = this.monitors.get(jobId);
    if (!entry) return;

    clearInterval(entry.interval);
    if (entry.recoveryInterval) {
      clearInterval(entry.recoveryInterval);
    }

    if (entry.isStopped) {
      this.sendSignal(entry.pid, 'SIGCONT', jobId, 'stop cleanup');
    }

    this.monitors.delete(jobId);
    this.logger.debug(`[${jobId}] NFS monitor stopped`);
  }

  private async checkHealth(jobId: string): Promise<void> {
    const entry = this.monitors.get(jobId);
    if (!entry || entry.isStopped) return;

    const isReachable = await this.isMountReachable(entry.mountPath);
    if (isReachable) return;

    this.logger.warn(
      `NFS mount ${entry.mountPath} unreachable, sending SIGSTOP to ffmpeg pid ${entry.pid}`
    );

    // Guard against sending SIGSTOP to a recycled PID
    const stillFfmpeg = await this.isPidStillFfmpeg(entry.pid);
    if (!stillFfmpeg) {
      this.logger.warn(
        `[${jobId}] PID ${entry.pid} is no longer an ffmpeg process — skipping SIGSTOP`
      );
      this.stopMonitoring(jobId);
      return;
    }

    entry.isStopped = true;
    this.sendSignal(entry.pid, 'SIGSTOP', jobId, 'NFS outage');

    // Stop the regular health poll while in recovery
    clearInterval(entry.interval);
    entry.interval = null as unknown as ReturnType<typeof setInterval>;

    let attempts = 0;
    const recoveryInterval = setInterval(async () => {
      attempts++;
      const current = this.monitors.get(jobId);
      if (!current) {
        clearInterval(recoveryInterval);
        return;
      }

      const recovered = await this.isMountReachable(current.mountPath);

      if (recovered) {
        clearInterval(recoveryInterval);
        current.recoveryInterval = null;
        current.isStopped = false;

        this.logger.log(`NFS mount recovered, sending SIGCONT to ffmpeg pid ${current.pid}`);
        this.sendSignal(current.pid, 'SIGCONT', jobId, 'NFS recovery');

        // Restart the regular health poll
        current.interval = setInterval(() => {
          void this.checkHealth(jobId);
        }, POLL_INTERVAL_MS);

        return;
      }

      if (attempts >= MAX_RECOVERY_ATTEMPTS) {
        clearInterval(recoveryInterval);
        current.recoveryInterval = null;
        current.isStopped = false;

        this.logger.warn(
          `[${jobId}] NFS mount ${current.mountPath} did not recover after 5 minutes — sending SIGCONT to let FFmpeg fail naturally`
        );
        this.sendSignal(current.pid, 'SIGCONT', jobId, '5-min timeout');

        // Restart the regular health poll so monitoring continues
        current.interval = setInterval(() => {
          void this.checkHealth(jobId);
        }, POLL_INTERVAL_MS);
      }
    }, RECOVERY_POLL_MS);

    entry.recoveryInterval = recoveryInterval;
  }

  private async isMountReachable(mountPath: string): Promise<boolean> {
    try {
      await fs.promises.access(mountPath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check whether the given PID still belongs to an ffmpeg process.
   * On Linux, reads /proc/<pid>/comm. On macOS (no /proc), falls back to a
   * signal-0 existence check — if the process is gone entirely, returns false.
   */
  private async isPidStillFfmpeg(pid: number): Promise<boolean> {
    try {
      const comm = await fs.promises.readFile(`/proc/${pid}/comm`, 'utf8');
      return comm.trim() === 'ffmpeg';
    } catch {
      // /proc not available (macOS) or process already gone
      try {
        process.kill(pid, 0); // signal 0 = existence check only
        return true; // process exists; can't verify name without /proc, allow it
      } catch {
        return false; // ESRCH — process gone
      }
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
          `[${jobId}] FFmpeg pid ${pid} no longer exists during ${context} (${signal}) — skipping`
        );
      } else {
        this.logger.error(
          `[${jobId}] Failed to send ${signal} to pid ${pid} during ${context}: ${err}`
        );
      }
    }
  }
}
