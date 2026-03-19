import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../common/repositories/job.repository';
import { NodeRepository } from '../common/repositories/node.repository';

/**
 * DebugService
 *
 * Encapsulates system-level operations and database queries for debug endpoints.
 * Handles OS calls, FFmpeg process management, and node configuration.
 */
@Injectable()
export class DebugService {
  private readonly logger = new Logger(DebugService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly nodeRepository: NodeRepository
  ) {}

  /**
   * Get current system load information
   */
  async getSystemLoad(): Promise<{
    loadAvg1m: number;
    loadAvg5m: number;
    loadAvg15m: number;
    cpuCount: number;
    loadThreshold: number;
    loadThresholdMultiplier: number;
    freeMemoryGB: number;
    totalMemoryGB: number;
    isOverloaded: boolean;
    reason: string;
  }> {
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();

    // Get load threshold from current node or use default
    let loadThresholdMultiplier = parseFloat(process.env.LOAD_THRESHOLD_MULTIPLIER || '5.0');
    try {
      const node = (await this.getCurrentNode()) as { loadThresholdMultiplier?: number } | null;
      if (node?.loadThresholdMultiplier) {
        loadThresholdMultiplier = node.loadThresholdMultiplier;
      }
    } catch (error: unknown) {
      this.logger.warn(
        `[getSystemLoad] Failed to read node load threshold, using default: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const loadThreshold = cpuCount * loadThresholdMultiplier;
    const freeMemoryGB = freeMemory / 1024 ** 3;
    const isOverloaded = loadAvg[0] > loadThreshold || freeMemoryGB < 4;

    return {
      loadAvg1m: loadAvg[0],
      loadAvg5m: loadAvg[1],
      loadAvg15m: loadAvg[2],
      cpuCount,
      loadThreshold,
      loadThresholdMultiplier,
      freeMemoryGB,
      totalMemoryGB: totalMemory / 1024 ** 3,
      isOverloaded,
      reason: isOverloaded
        ? loadAvg[0] > loadThreshold
          ? `High load (${loadAvg[0].toFixed(2)} > ${loadThreshold.toFixed(0)})`
          : `Low memory (${freeMemoryGB.toFixed(1)}GB < 4GB)`
        : '',
    };
  }

  /**
   * Get encoding jobs and system FFmpeg processes
   */
  async getFfmpegProcesses(): Promise<{
    trackedEncodings: Array<{
      jobId: string;
      pid: undefined;
      startTime: Date | null;
      lastProgress: number;
      runtimeSeconds: number;
    }>;
    systemProcesses: Array<{
      pid: number;
      command: string;
      cpuPercent: number;
      memPercent: number;
      runtimeSeconds: number;
      isZombie: boolean;
      trackedJobId: null;
    }>;
    zombieCount: number;
    note: string;
  }> {
    // Get jobs that are currently encoding
    const encodingJobs = await this.jobRepository.findManySelect<{
      id: string;
      startedAt: Date | null;
      progress: number | null;
    }>({ stage: JobStage.ENCODING }, { id: true, startedAt: true, progress: true });

    // Get system FFmpeg processes
    const systemProcesses = await this.findSystemFfmpegProcesses();

    // We can't perfectly match PIDs to jobs without the FfmpegService tracking,
    // so we mark all processes as "untracked" (potential zombies)
    const processesWithZombieInfo = systemProcesses.map((proc) => ({
      ...proc,
      isZombie: true, // Conservative: mark all as zombie since we can't track them from here
      trackedJobId: null,
    }));

    return {
      trackedEncodings: encodingJobs.map((job) => ({
        jobId: job.id,
        pid: undefined, // Can't get PID without FfmpegService
        startTime: job.startedAt,
        lastProgress: job.progress || 0,
        runtimeSeconds: job.startedAt
          ? Math.floor((Date.now() - new Date(job.startedAt).getTime()) / 1000)
          : 0,
      })),
      systemProcesses: processesWithZombieInfo,
      zombieCount: processesWithZombieInfo.length,
      note: 'All system processes shown as zombies since exact tracking requires backend restart.',
    };
  }

  /**
   * Kill a specific FFmpeg process by PID
   */
  async killProcessByPid(pid: number): Promise<{ success: boolean; message: string }> {
    // SECURITY: Validate PID before using in process operations
    this.validatePid(pid);

    try {
      this.logger.log(`Killing FFmpeg process PID ${pid}`);

      // SECURITY: Use execFileSync with array args to prevent shell injection
      try {
        execFileSync('kill', ['-TERM', pid.toString()], { timeout: 2000 });
      } catch (error: unknown) {
        this.logger.warn(
          `[killProcessByPid] SIGTERM failed for PID ${pid}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check if process still exists and force kill if needed
      try {
        execFileSync('kill', ['-0', pid.toString()], { timeout: 1000 });
        // Process still exists, force kill
        execFileSync('kill', ['-KILL', pid.toString()], { timeout: 2000 });
      } catch (error: unknown) {
        this.logger.warn(
          `[killProcessByPid] Process PID ${pid} already dead: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      return { success: true, message: `Killed FFmpeg process PID ${pid}` };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: `Failed to kill PID ${pid}: ${msg}` };
    }
  }

  /**
   * Kill all zombie FFmpeg processes
   */
  async killAllZombies(): Promise<{
    killed: number;
    failed: number;
    details: Array<{ pid: number; success: boolean; message: string }>;
  }> {
    const processes = await this.findSystemFfmpegProcesses();
    const details: Array<{ pid: number; success: boolean; message: string }> = [];
    let killed = 0;
    let failed = 0;

    for (const proc of processes) {
      const result = await this.killProcessByPid(proc.pid);
      details.push({ pid: proc.pid, ...result });
      if (result.success) killed++;
      else failed++;
    }

    return { killed, failed, details };
  }

  /**
   * Update load threshold multiplier for current node
   */
  async updateLoadThreshold(loadThresholdMultiplier: number): Promise<{
    success: boolean;
    message: string;
    loadThresholdMultiplier?: number;
    maxLoad?: number;
    cpuCount?: number;
  }> {
    if (loadThresholdMultiplier < 1.0 || loadThresholdMultiplier > 10.0) {
      return {
        success: false,
        message: 'Load threshold multiplier must be between 1.0 and 10.0',
      };
    }

    try {
      const node = await this.getCurrentNode();
      if (!node) {
        return { success: false, message: 'Current node not found' };
      }

      await this.nodeRepository.updateById(node.id, { loadThresholdMultiplier });

      const cpuCount = os.cpus().length;
      return {
        success: true,
        loadThresholdMultiplier,
        maxLoad: cpuCount * loadThresholdMultiplier,
        cpuCount,
        message: 'Load threshold updated. Changes take effect immediately.',
      };
    } catch (error: unknown) {
      this.logger.error('Failed to update load threshold', error);
      return { success: false, message: 'Failed to update load threshold' };
    }
  }

  // ===== Private helper methods =====

  private async getCurrentNode() {
    const ipAddresses = this.getLocalIpAddresses();
    return this.nodeRepository.findFirstByIpAddresses(ipAddresses);
  }

  private getLocalIpAddresses(): string[] {
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push(iface.address);
        }
      }
    }
    return addresses;
  }

  private async findSystemFfmpegProcesses(): Promise<
    Array<{
      pid: number;
      command: string;
      cpuPercent: number;
      memPercent: number;
      runtimeSeconds: number;
    }>
  > {
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
          const etime = parts[3];
          const command = parts.slice(4).join(' ');

          let runtimeSeconds = 0;
          const timeParts = etime.split(/[-:]/).reverse();
          if (timeParts.length >= 1) runtimeSeconds += parseInt(timeParts[0], 10) || 0;
          if (timeParts.length >= 2) runtimeSeconds += (parseInt(timeParts[1], 10) || 0) * 60;
          if (timeParts.length >= 3) runtimeSeconds += (parseInt(timeParts[2], 10) || 0) * 3600;
          if (timeParts.length >= 4) runtimeSeconds += (parseInt(timeParts[3], 10) || 0) * 86400;

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
   * Validate PID is a positive integer to prevent command injection
   */
  private validatePid(pid: number): void {
    if (!Number.isInteger(pid) || pid <= 0 || pid > 4194304) {
      throw new BadRequestException(`Invalid PID: ${pid}`);
    }
  }
}
