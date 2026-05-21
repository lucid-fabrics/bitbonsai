import { exec } from 'node:child_process';
import * as os from 'node:os';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import type { MemoryHealthDto } from '../dto/memory-health.dto';
import type { ServiceHealthDto } from '../dto/service-health.dto';

const execAsync = promisify(exec);

@Injectable()
export class SystemHealthService {
  private readonly logger = new Logger(SystemHealthService.name);

  async checkMemoryHealth(): Promise<MemoryHealthDto> {
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const percentage = (usedMem / totalMem) * 100;

      let status: 'ok' | 'warning' | 'critical' = 'ok';
      if (percentage > 90) status = 'critical';
      else if (percentage > 80) status = 'warning';

      return {
        status,
        used: this.formatBytes(usedMem),
        total: this.formatBytes(totalMem),
        percentage: Math.round(percentage * 10) / 10,
      };
    } catch (error: unknown) {
      this.logger.error('Memory health check failed:', error);
      return { status: 'ok', used: 'N/A', total: 'N/A', percentage: 0 };
    }
  }

  async checkFfmpegHealth(): Promise<ServiceHealthDto> {
    const startTime = Date.now();
    try {
      const { stdout } = await execAsync('ffmpeg -version');
      const versionMatch = stdout.match(/ffmpeg version (\S+)/);
      return {
        status: 'ok',
        responseTime: Date.now() - startTime,
        version: versionMatch?.[1] || 'unknown',
      };
    } catch (error: unknown) {
      this.logger.error('FFmpeg health check failed:', error);
      return { status: 'error', error: 'FFmpeg not found or not executable' };
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / k ** i) * 10) / 10}${sizes[i]}`;
  }
}
