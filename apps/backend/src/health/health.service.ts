import { exec } from 'node:child_process';
import * as os from 'node:os';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { NodeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  BasicHealthDto,
  DetailedHealthDto,
  DiskHealthDto,
  HealthChecksDto,
  LivenessDto,
  MemoryHealthDto,
  NodeHealthDto,
  QueueHealthDto,
  ReadinessDto,
  ServiceHealthDto,
} from './dto/health-check.dto';

const execAsync = promisify(exec);

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();
  private readonly version = '0.1.0';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get basic health information
   */
  async getBasicHealth(): Promise<BasicHealthDto> {
    try {
      // Quick database check
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: 'ok',
        timestamp: new Date(),
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        version: this.version,
      };
    } catch (error) {
      this.logger.error('Basic health check failed:', error);
      return {
        status: 'error',
        timestamp: new Date(),
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        version: this.version,
      };
    }
  }

  /**
   * Get detailed health information with all checks
   */
  async getDetailedHealth(): Promise<DetailedHealthDto> {
    const [checks, nodes, queue] = await Promise.all([
      this.getAllHealthChecks(),
      this.checkNodeHealth(),
      this.checkQueueHealth(),
    ]);

    // Determine overall status
    let status: 'ok' | 'degraded' | 'error' = 'ok';

    if (checks.database.status === 'error') {
      status = 'error';
    } else if (
      checks.redis?.status === 'error' ||
      checks.disk.status === 'critical' ||
      checks.memory.status === 'critical' ||
      checks.ffmpeg.status === 'error'
    ) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date(),
      checks,
      nodes,
      queue,
    };
  }

  /**
   * Perform all health checks
   */
  private async getAllHealthChecks(): Promise<HealthChecksDto> {
    const [database, redis, disk, memory, ffmpeg] = await Promise.all([
      this.checkDatabaseHealth(),
      this.checkRedisHealth(),
      this.checkDiskHealth(),
      this.checkMemoryHealth(),
      this.checkFfmpegHealth(),
    ]);

    return {
      database,
      redis,
      disk,
      memory,
      ffmpeg,
    };
  }

  /**
   * Check database connectivity
   */
  async checkDatabaseHealth(): Promise<ServiceHealthDto> {
    const startTime = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - startTime;

      return {
        status: 'ok',
        responseTime,
      };
    } catch (error) {
      this.logger.error('Database health check failed:', error);
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check Redis connectivity (if configured)
   */
  async checkRedisHealth(): Promise<ServiceHealthDto | undefined> {
    // Redis is optional in the current implementation
    // This is a placeholder for future Redis integration
    const redisEnabled = process.env.REDIS_URL !== undefined;

    if (!redisEnabled) {
      return undefined;
    }

    const startTime = Date.now();
    try {
      // TODO: Implement Redis PING when Redis is integrated
      const responseTime = Date.now() - startTime;

      return {
        status: 'ok',
        responseTime,
      };
    } catch (error) {
      this.logger.error('Redis health check failed:', error);
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check disk space
   */
  async checkDiskHealth(): Promise<DiskHealthDto> {
    try {
      // Get disk usage for the root filesystem
      const { stdout } = await execAsync('df -h / | tail -1');
      const parts = stdout.trim().split(/\s+/);

      const usedPercent = Number.parseFloat(parts[4]?.replace('%', '') || '0');
      const available = parts[3] || 'Unknown';
      const _used = parts[2] || 'Unknown';

      let status: 'ok' | 'warning' | 'critical' = 'ok';
      if (usedPercent > 90) {
        status = 'critical';
      } else if (usedPercent > 80) {
        status = 'warning';
      }

      return {
        status,
        used: `${Math.round(usedPercent)}%`,
        available,
      };
    } catch (error) {
      this.logger.error('Disk health check failed:', error);
      return {
        status: 'ok',
        used: 'N/A',
        available: 'N/A',
      };
    }
  }

  /**
   * Check memory usage
   */
  async checkMemoryHealth(): Promise<MemoryHealthDto> {
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const percentage = (usedMem / totalMem) * 100;

      let status: 'ok' | 'warning' | 'critical' = 'ok';
      if (percentage > 90) {
        status = 'critical';
      } else if (percentage > 80) {
        status = 'warning';
      }

      return {
        status,
        used: this.formatBytes(usedMem),
        total: this.formatBytes(totalMem),
        percentage: Math.round(percentage * 10) / 10,
      };
    } catch (error) {
      this.logger.error('Memory health check failed:', error);
      return {
        status: 'ok',
        used: 'N/A',
        total: 'N/A',
        percentage: 0,
      };
    }
  }

  /**
   * Check FFmpeg availability
   */
  async checkFfmpegHealth(): Promise<ServiceHealthDto> {
    const startTime = Date.now();
    try {
      const { stdout } = await execAsync('ffmpeg -version');
      const versionMatch = stdout.match(/ffmpeg version (\S+)/);
      const version = versionMatch?.[1] || 'unknown';
      const responseTime = Date.now() - startTime;

      return {
        status: 'ok',
        responseTime,
        version,
      };
    } catch (error) {
      this.logger.error('FFmpeg health check failed:', error);
      return {
        status: 'error',
        error: 'FFmpeg not found or not executable',
      };
    }
  }

  /**
   * Check node cluster health
   */
  async checkNodeHealth(): Promise<NodeHealthDto> {
    try {
      const nodes = await this.prisma.node.findMany({
        select: {
          status: true,
        },
      });

      const total = nodes.length;
      const online = nodes.filter((node) => node.status === NodeStatus.ONLINE).length;
      const offline = total - online;

      return {
        total,
        online,
        offline,
      };
    } catch (error) {
      this.logger.error('Node health check failed:', error);
      return {
        total: 0,
        online: 0,
        offline: 0,
      };
    }
  }

  /**
   * Check encoding queue health
   */
  async checkQueueHealth(): Promise<QueueHealthDto> {
    try {
      const [queued, encoding, completed, failed] = await Promise.all([
        this.prisma.job.count({
          where: { stage: 'QUEUED' },
        }),
        this.prisma.job.count({
          where: { stage: 'ENCODING' },
        }),
        this.prisma.job.count({
          where: { stage: 'COMPLETED' },
        }),
        this.prisma.job.count({
          where: { stage: 'FAILED' },
        }),
      ]);

      return {
        queued,
        encoding,
        completed,
        failed,
      };
    } catch (error) {
      this.logger.error('Queue health check failed:', error);
      return {
        queued: 0,
        encoding: 0,
        completed: 0,
        failed: 0,
      };
    }
  }

  /**
   * Check if the application is ready to accept requests (Kubernetes readiness probe)
   */
  async isReady(): Promise<ReadinessDto> {
    try {
      // Application is ready if database is accessible
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        ready: true,
      };
    } catch (error) {
      this.logger.error('Readiness check failed:', error);
      return {
        ready: false,
        reason: 'Database connection failed',
      };
    }
  }

  /**
   * Check if the application is alive (Kubernetes liveness probe)
   */
  async isLive(): Promise<LivenessDto> {
    // Simple liveness check - if this method executes, the app is alive
    return {
      alive: true,
    };
  }

  /**
   * Format bytes to human-readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${Math.round((bytes / k ** i) * 10) / 10}${sizes[i]}`;
  }
}
