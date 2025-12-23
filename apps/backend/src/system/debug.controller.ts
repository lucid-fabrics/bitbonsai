import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DebugController
 *
 * Debug endpoints for system monitoring and troubleshooting.
 * Uses direct os/process calls to avoid circular module dependencies.
 *
 * Features:
 * - System load monitoring (CPU, memory, load average)
 * - FFmpeg process tracking and zombie detection
 * - Load threshold management
 */
@ApiTags('Debug')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('debug')
export class DebugController {
  private readonly logger = new Logger(DebugController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get current system load information
   */
  @Get('system-load')
  @ApiOperation({
    summary: 'Get system load information',
    description:
      'Returns current CPU load average, memory usage, load threshold settings, and throttling status.',
  })
  @ApiResponse({ status: 200, description: 'System load information' })
  async getSystemLoad() {
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();

    // Get load threshold from current node or use default
    let loadThresholdMultiplier = parseFloat(process.env.LOAD_THRESHOLD_MULTIPLIER || '5.0');
    try {
      const node = await this.getCurrentNode();
      if (node?.loadThresholdMultiplier) {
        loadThresholdMultiplier = node.loadThresholdMultiplier;
      }
    } catch {
      // Use default
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
   * List all FFmpeg processes (system-wide)
   */
  @Get('ffmpeg-processes')
  @ApiOperation({
    summary: 'List FFmpeg processes',
    description: 'Returns all FFmpeg processes running on the system with zombie detection.',
  })
  @ApiResponse({ status: 200, description: 'List of FFmpeg processes' })
  async getFfmpegProcesses() {
    // Get jobs that are currently encoding
    const encodingJobs = await this.prisma.job.findMany({
      where: { stage: 'ENCODING' },
      select: { id: true, startedAt: true, progress: true },
    });

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
  @Delete('ffmpeg-processes/:pid')
  @ApiOperation({
    summary: 'Kill FFmpeg process by PID',
    description: 'Kills a specific FFmpeg process by its PID.',
  })
  @ApiParam({ name: 'pid', type: 'number', description: 'Process ID to kill' })
  @ApiResponse({ status: 200, description: 'Kill result' })
  async killFfmpegProcess(@Param('pid', ParseIntPipe) pid: number) {
    return this.killProcessByPid(pid);
  }

  /**
   * Kill all zombie FFmpeg processes
   */
  @Delete('ffmpeg-processes/zombies')
  @ApiOperation({
    summary: 'Kill all zombie FFmpeg processes',
    description: 'Finds and kills all FFmpeg processes running on the system.',
  })
  @ApiResponse({ status: 200, description: 'Summary of killed processes' })
  async killAllZombies() {
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
  @Post('load-threshold')
  @ApiOperation({
    summary: 'Update load threshold multiplier',
    description:
      'Updates the load threshold multiplier for the current node. ' +
      'Higher values = more tolerant of high load (useful for NAS systems).',
  })
  @ApiResponse({ status: 200, description: 'Load threshold updated' })
  async updateLoadThreshold(@Body() body: { loadThresholdMultiplier: number }) {
    const { loadThresholdMultiplier } = body;

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

      await this.prisma.node.update({
        where: { id: node.id },
        data: { loadThresholdMultiplier },
      });

      const cpuCount = os.cpus().length;
      return {
        success: true,
        loadThresholdMultiplier,
        maxLoad: cpuCount * loadThresholdMultiplier,
        cpuCount,
        message: 'Load threshold updated. Changes take effect immediately.',
      };
    } catch (error) {
      this.logger.error('Failed to update load threshold', error);
      return { success: false, message: 'Failed to update load threshold' };
    }
  }

  // ===== Private helper methods =====

  private async getCurrentNode() {
    const ipAddresses = this.getLocalIpAddresses();
    return this.prisma.node.findFirst({
      where: { ipAddress: { in: ipAddresses } },
    });
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
            command: command.length > 200 ? command.substring(0, 200) + '...' : command,
            cpuPercent,
            memPercent,
            runtimeSeconds,
          });
        }
      }

      return processes;
    } catch (error) {
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

  private async killProcessByPid(pid: number): Promise<{ success: boolean; message: string }> {
    // SECURITY: Validate PID before using in process operations
    this.validatePid(pid);

    try {
      this.logger.log(`Killing FFmpeg process PID ${pid}`);

      // SECURITY: Use execFileSync with array args to prevent shell injection
      try {
        execFileSync('kill', ['-TERM', pid.toString()], { timeout: 2000 });
      } catch {
        // Process may not exist or already dead - continue
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check if process still exists and force kill if needed
      try {
        execFileSync('kill', ['-0', pid.toString()], { timeout: 1000 });
        // Process still exists, force kill
        execFileSync('kill', ['-KILL', pid.toString()], { timeout: 2000 });
      } catch {
        // Process already dead - this is expected
      }

      return { success: true, message: `Killed FFmpeg process PID ${pid}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: `Failed to kill PID ${pid}: ${msg}` };
    }
  }
}
