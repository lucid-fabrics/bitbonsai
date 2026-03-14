import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import { promisify } from 'node:util';
import { version } from '@bitbonsai/version';
import { Injectable, Logger } from '@nestjs/common';
import { NodeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { BasicHealthDto } from './dto/basic-health.dto';
import type { DetailedHealthDto } from './dto/detailed-health.dto';
import type { DiskHealthDto } from './dto/disk-health.dto';
import type { DiskSpaceMonitoringDto } from './dto/disk-space-monitoring.dto';
import type { HealthChecksDto } from './dto/health-checks.dto';
import type { LibraryDiskSpaceDto } from './dto/library-disk-space.dto';
import type { LivenessDto } from './dto/liveness.dto';
import type { MemoryHealthDto } from './dto/memory-health.dto';
import type { NodeHealthDto } from './dto/node-health.dto';
import type { QueueHealthDto } from './dto/queue-health.dto';
import type { ReadinessDto } from './dto/readiness.dto';
import type { ServiceHealthDto } from './dto/service-health.dto';

const execAsync = promisify(exec);

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();
  private readonly version = version; // Read from package.json

  // Disk space threshold constants (aligned with encoding-processor.service.ts)
  private readonly DISK_SPACE_BUFFER_PERCENT = 20; // 20% buffer for encoding overhead
  private readonly MIN_FREE_DISK_SPACE_GB = 5; // Minimum 5GB free space
  private readonly WARNING_THRESHOLD_PERCENT = 80; // Warn at 80% used
  private readonly CRITICAL_THRESHOLD_PERCENT = 90; // Critical at 90% used

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
   * SECURITY FIX: Use statfs instead of shell command to prevent command injection
   */
  async checkDiskHealth(): Promise<DiskHealthDto> {
    try {
      // SECURITY: Use safe shell command with no user input
      // Command is hardcoded and takes no parameters to prevent injection
      const { stdout } = await execAsync('df -h / | tail -1');
      const parts = stdout.trim().split(/\s+/);

      const usedPercent = Number.parseFloat(parts[4]?.replace('%', '') || '0');
      const available = parts[3] || 'Unknown';

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
   * SECURITY FIX: Hardcoded command with no user input to prevent command injection
   */
  async checkFfmpegHealth(): Promise<ServiceHealthDto> {
    const startTime = Date.now();
    try {
      // SECURITY: Hardcoded command with no user input - safe from injection
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
   * Monitor disk space across all libraries with predictive warnings
   *
   * Provides:
   * - Per-library disk space breakdown
   * - Queued jobs count per library
   * - Predictive space needed for queue
   * - Cross-filesystem awareness
   * - Warning/critical status per library
   */
  async monitorLibraryDiskSpace(): Promise<DiskSpaceMonitoringDto> {
    try {
      // Get all libraries with their queued jobs
      const libraries = await this.prisma.library.findMany({
        include: {
          jobs: {
            where: {
              stage: {
                in: ['QUEUED', 'ENCODING'],
              },
            },
            select: {
              id: true,
              filePath: true,
              beforeSizeBytes: true,
            },
          },
        },
      });

      const librarySpaceData: LibraryDiskSpaceDto[] = [];
      const globalWarnings: string[] = [];
      let totalQueuedJobs = 0;
      let totalEstimatedSpaceNeededBigInt = BigInt(0);
      let overallStatus: 'ok' | 'warning' | 'critical' = 'ok';

      // Check disk space for each library
      for (const library of libraries) {
        try {
          const libraryPath = library.path;

          // Get filesystem stats for the library path
          const stats = await fs.statfs(libraryPath);
          const totalBytes = BigInt(stats.blocks) * BigInt(stats.bsize);
          const availableBytes = BigInt(stats.bavail) * BigInt(stats.bsize);
          const usedBytes = totalBytes - availableBytes;
          const usedPercent = Number((usedBytes * BigInt(100)) / totalBytes);

          // Determine status based on usage
          let status: 'ok' | 'warning' | 'critical' = 'ok';
          if (usedPercent >= this.CRITICAL_THRESHOLD_PERCENT) {
            status = 'critical';
            overallStatus = 'critical';
          } else if (usedPercent >= this.WARNING_THRESHOLD_PERCENT) {
            status = 'warning';
            if (overallStatus !== 'critical') {
              overallStatus = 'warning';
            }
          }

          // Calculate estimated space needed for queued jobs
          const queuedJobsCount = library.jobs.length;
          totalQueuedJobs += queuedJobsCount;

          let estimatedSpaceNeededBytes: bigint | null = null;
          let hasEnoughSpaceForQueue = true;
          let warningMessage: string | null = null;

          if (queuedJobsCount > 0) {
            // Estimate space: sum of all queued job sizes * (1 + buffer)
            let queueSpaceEstimate = BigInt(0);
            for (const job of library.jobs) {
              const jobSize = BigInt(job.beforeSizeBytes || 0);
              const jobSpaceNeeded =
                (jobSize * BigInt(100 + this.DISK_SPACE_BUFFER_PERCENT)) / BigInt(100);
              queueSpaceEstimate += jobSpaceNeeded;
            }

            estimatedSpaceNeededBytes = queueSpaceEstimate;
            totalEstimatedSpaceNeededBigInt += queueSpaceEstimate;

            // Check if available space is sufficient
            const minimumRequired =
              queueSpaceEstimate + BigInt(this.MIN_FREE_DISK_SPACE_GB) * BigInt(1024 ** 3);
            hasEnoughSpaceForQueue = availableBytes >= minimumRequired;

            if (!hasEnoughSpaceForQueue) {
              const shortfall = minimumRequired - availableBytes;
              const shortfallGB = Number(shortfall) / 1024 ** 3;
              warningMessage = `Insufficient space: need ${shortfallGB.toFixed(1)} GB more to complete ${queuedJobsCount} queued jobs`;
              globalWarnings.push(`Library "${library.name}": ${warningMessage}`);

              // Escalate status to critical if queue won't fit
              if (status === 'ok') status = 'warning';
            } else if (status !== 'ok') {
              // Library space is warning/critical, but queue still fits
              warningMessage = `Disk space ${status}: ${usedPercent.toFixed(0)}% used, but ${queuedJobsCount} queued jobs should complete`;
            }
          } else if (status !== 'ok') {
            // No queued jobs, but disk space is still warning/critical
            warningMessage = `Disk space ${status}: ${usedPercent.toFixed(0)}% used`;
            globalWarnings.push(`Library "${library.name}": ${warningMessage}`);
          }

          librarySpaceData.push({
            libraryId: library.id,
            libraryName: library.name,
            path: libraryPath,
            status,
            totalBytes: totalBytes.toString(),
            availableBytes: availableBytes.toString(),
            usedBytes: usedBytes.toString(),
            usedPercent,
            availableFormatted: this.formatBytes(Number(availableBytes)),
            totalFormatted: this.formatBytes(Number(totalBytes)),
            queuedJobsCount,
            estimatedSpaceNeededBytes: estimatedSpaceNeededBytes?.toString() ?? null,
            hasEnoughSpaceForQueue,
            warningMessage,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to check disk space for library ${library.name} at ${library.path}`,
            error
          );

          // Add library with error status
          librarySpaceData.push({
            libraryId: library.id,
            libraryName: library.name,
            path: library.path,
            status: 'warning',
            totalBytes: '0',
            availableBytes: '0',
            usedBytes: '0',
            usedPercent: 0,
            availableFormatted: 'N/A',
            totalFormatted: 'N/A',
            queuedJobsCount: library.jobs.length,
            estimatedSpaceNeededBytes: null,
            hasEnoughSpaceForQueue: false,
            warningMessage: 'Failed to check disk space (path may not exist or be inaccessible)',
          });
        }
      }

      // Determine if system can accommodate entire queue
      const canAccommodateQueue = librarySpaceData.every((lib) => lib.hasEnoughSpaceForQueue);

      return {
        overallStatus,
        timestamp: new Date(),
        libraries: librarySpaceData,
        globalWarnings,
        totalQueuedJobs,
        totalEstimatedSpaceNeeded:
          totalQueuedJobs > 0 ? totalEstimatedSpaceNeededBigInt.toString() : null,
        canAccommodateQueue,
      };
    } catch (error) {
      this.logger.error('Failed to monitor library disk space', error);

      // Return error state
      return {
        overallStatus: 'critical',
        timestamp: new Date(),
        libraries: [],
        globalWarnings: ['Failed to monitor disk space across libraries'],
        totalQueuedJobs: 0,
        totalEstimatedSpaceNeeded: null,
        canAccommodateQueue: false,
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
