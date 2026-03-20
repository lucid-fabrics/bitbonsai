import { Injectable, Logger } from '@nestjs/common';

/**
 * FfmpegProcessCleanupService
 *
 * Handles system-level FFmpeg process discovery and termination.
 * Operates independently of the activeEncodings map (no job tracking).
 *
 * Responsibilities:
 * - Scanning the OS process table for FFmpeg processes
 * - Killing individual FFmpeg processes by PID
 * - Cleaning up orphaned temp files from previous crashes
 */
@Injectable()
export class FfmpegProcessCleanupService {
  private readonly logger = new Logger(FfmpegProcessCleanupService.name);

  /**
   * Find system FFmpeg processes using ps command.
   * Returns list of FFmpeg processes running on the system.
   */
  async findSystemFfmpegProcesses(): Promise<
    Array<{
      pid: number;
      command: string;
      cpuPercent: number;
      memPercent: number;
      runtimeSeconds: number;
    }>
  > {
    const { execFileSync } = await import('node:child_process');

    try {
      // SECURITY: Use execFileSync to avoid shell injection
      // Get all processes first, then filter for ffmpeg in code
      const psOutput = execFileSync('ps', ['-eo', 'pid,%cpu,%mem,etime,args'], {
        encoding: 'utf-8',
        timeout: 5000,
      });

      const processes: Array<{
        pid: number;
        command: string;
        cpuPercent: number;
        memPercent: number;
        runtimeSeconds: number;
      }> = [];

      for (const line of psOutput.split('\n').filter(Boolean)) {
        // Filter for ffmpeg processes in code instead of grep
        if (!line.toLowerCase().includes('ffmpeg')) continue;

        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const pid = parseInt(parts[0], 10);
          const cpuPercent = parseFloat(parts[1]) || 0;
          const memPercent = parseFloat(parts[2]) || 0;
          const etime = parts[3]; // Format: [[DD-]HH:]MM:SS
          const command = parts.slice(4).join(' ');

          // Parse elapsed time to seconds
          let runtimeSeconds = 0;
          const timeParts = etime.split(/[-:]/).reverse();
          if (timeParts.length >= 1) runtimeSeconds += parseInt(timeParts[0], 10) || 0; // seconds
          if (timeParts.length >= 2) runtimeSeconds += (parseInt(timeParts[1], 10) || 0) * 60; // minutes
          if (timeParts.length >= 3) runtimeSeconds += (parseInt(timeParts[2], 10) || 0) * 3600; // hours
          if (timeParts.length >= 4) runtimeSeconds += (parseInt(timeParts[3], 10) || 0) * 86400; // days

          processes.push({
            pid,
            command: command.length > 200 ? `${command.substring(0, 200)}...` : command,
            cpuPercent,
            memPercent,
            runtimeSeconds,
          });
        }
      }

      return processes;
    } catch (error: unknown) {
      this.logger.warn(`Failed to find system FFmpeg processes: ${error}`);
      return [];
    }
  }

  /**
   * Kill a specific FFmpeg process by PID.
   *
   * Used to clean up zombie/orphaned FFmpeg processes.
   * Pass a set of tracked PIDs to prevent killing managed processes.
   *
   * @param pid - Process ID to kill
   * @param trackedPids - Set of PIDs managed by activeEncodings (safety guard)
   * @param trackedPidToJobId - Map from PID to jobId for error messages
   * @returns Result with success flag and message
   */
  async killFfmpegByPid(
    pid: number,
    trackedPids: Set<number> = new Set(),
    trackedPidToJobId: Map<number, string> = new Map()
  ): Promise<{ success: boolean; message: string }> {
    const { execFileSync } = await import('node:child_process');

    // SECURITY: Validate PID is a positive integer
    if (!Number.isInteger(pid) || pid <= 0 || pid > 4194304) {
      return { success: false, message: `Invalid PID: ${pid}` };
    }

    // Safety check: don't kill tracked processes this way
    if (trackedPids.has(pid)) {
      const jobId = trackedPidToJobId.get(pid);
      return {
        success: false,
        message: `PID ${pid} is tracked by job ${jobId}. Use cancel endpoint instead.`,
      };
    }

    try {
      // SECURITY: Use execFileSync with array args to prevent shell injection
      // First try SIGTERM for graceful shutdown
      this.logger.log(`Killing zombie FFmpeg process PID ${pid} with SIGTERM`);
      try {
        execFileSync('kill', ['-TERM', pid.toString()], { timeout: 2000 });
      } catch {
        // Process may not exist - continue
      }

      // Wait a moment
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check if process still exists
      try {
        execFileSync('kill', ['-0', pid.toString()], { timeout: 1000 });
        // Process still alive, use SIGKILL
        this.logger.log(`Process PID ${pid} still alive, using SIGKILL`);
        execFileSync('kill', ['-KILL', pid.toString()], { timeout: 2000 });
      } catch {
        // Process already dead (good)
      }

      return { success: true, message: `Successfully killed FFmpeg process PID ${pid}` };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to kill FFmpeg process PID ${pid}: ${errorMessage}`);
      return { success: false, message: `Failed to kill PID ${pid}: ${errorMessage}` };
    }
  }

  /**
   * Clean up orphaned temp files from previous crash/restart.
   * Removes *.tmp.* files that were left behind when encoding was interrupted.
   */
  async cleanupOrphanedTempFiles(): Promise<void> {
    try {
      const { glob } = await import('glob');
      const { unlink } = await import('fs/promises');

      // Find all .tmp. files in /tmp directory (typical temp file location)
      const tempFiles = await glob('/tmp/**/*.tmp.*', {
        nodir: true,
        absolute: true,
      });

      if (tempFiles.length === 0) {
        this.logger.log('🧹 No orphaned temp files found');
        return;
      }

      this.logger.log(`🧹 Found ${tempFiles.length} orphaned temp files, cleaning up...`);

      let removed = 0;
      for (const file of tempFiles) {
        try {
          await unlink(file);
          removed++;
        } catch (error: unknown) {
          // File may have been deleted already or permission denied - skip it
          this.logger.debug(`Failed to delete temp file ${file}: ${error}`);
        }
      }

      this.logger.log(`✅ Cleaned up ${removed}/${tempFiles.length} orphaned temp files`);
    } catch (error: unknown) {
      // Don't crash on cleanup failure - log and continue
      this.logger.warn(`Failed to cleanup orphaned temp files: ${error}`);
    }
  }
}
