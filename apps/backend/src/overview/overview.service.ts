import * as os from 'node:os';
import { Injectable, Logger } from '@nestjs/common';
import { JobStage, NodeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { OverviewResponseDto } from './dto/overview-response.dto';
import type {
  OverviewStatsDto,
  QueueStatsDto,
  RecentActivityDto,
  SystemHealthDto,
  TopLibraryDto,
} from './dto/overview-stats.dto';

/**
 * OverviewService
 *
 * Provides aggregated metrics and statistics for the BitBonsai dashboard.
 * Implements efficient Prisma aggregations to minimize database queries.
 */
@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Calculate current CPU utilization percentage
   * @private
   * @returns CPU usage percentage (0-100)
   */
  private calculateCpuUsage(): number {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    // Sum up all CPU times across all cores
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    }

    // Calculate usage percentage
    const cpuUsage = totalTick === 0 ? 0 : 100 - (100 * totalIdle) / totalTick;
    return Number(cpuUsage.toFixed(1));
  }

  /**
   * Get complete overview statistics in a single optimized response
   * with snake_case field names for frontend compatibility
   *
   * This method aggregates:
   * - System health (active nodes, queue status, storage saved, success rate)
   * - Queue summary (job counts by stage)
   * - Recent activity (last 10 completed jobs)
   * - Top libraries (by job count)
   *
   * @returns Complete dashboard statistics in snake_case format
   */
  async getOverview(): Promise<OverviewResponseDto> {
    this.logger.log('Fetching overview statistics for frontend');

    // Execute all queries in parallel for optimal performance
    const [systemHealth, queueStats, recentActivity, topLibraries] = await Promise.all([
      this.getSystemHealth(),
      this.getQueueSummary(),
      this.getRecentActivity(),
      this.getTopLibraries(),
    ]);

    // Calculate total nodes
    const totalNodes = systemHealth.activeNodes + systemHealth.offlineNodes;

    // Calculate storage saved in TB from completed jobs
    const totalSavedBytes = BigInt(queueStats.totalSavedBytes);
    const totalSavedTB = Number(totalSavedBytes) / (1024 * 1024 * 1024 * 1024); // Convert bytes to TB

    // Calculate success rate from queue stats
    const totalJobs = queueStats.completed + queueStats.failed;
    const successRate = totalJobs > 0 ? (queueStats.completed / totalJobs) * 100 : 0;

    // Transform to snake_case format
    return {
      system_health: {
        active_nodes: {
          current: systemHealth.activeNodes,
          total: totalNodes,
        },
        queue_status: {
          encoding_count: queueStats.encoding,
        },
        storage_saved: {
          total_tb: Number(totalSavedTB.toFixed(2)),
        },
        success_rate: {
          percentage: Number(successRate.toFixed(1)),
        },
        cpu_utilization: {
          percentage: systemHealth.cpuPercent,
        },
      },
      queue_summary: {
        queued: queueStats.queued,
        encoding: queueStats.encoding,
        completed: queueStats.completed,
        failed: queueStats.failed,
      },
      recent_activity: recentActivity.map((activity) => {
        const beforeSizeBytes = BigInt(activity.beforeSizeBytes);
        const afterSizeBytes = activity.afterSizeBytes ? BigInt(activity.afterSizeBytes) : null;
        const savedBytes = activity.savedBytes ? BigInt(activity.savedBytes) : null;

        return {
          id: activity.id,
          file_name: activity.fileLabel,
          library: activity.libraryName,
          source_codec: activity.sourceCodec,
          target_codec: activity.targetCodec,
          stage: activity.stage,
          before_size_bytes: Number(beforeSizeBytes),
          after_size_bytes: afterSizeBytes ? Number(afterSizeBytes) : null,
          saved_bytes: savedBytes ? Number(savedBytes) : null,
          saved_percent: activity.savedPercent,
          progress: activity.progress,
          completed_at: activity.completedAt.toISOString(),
        };
      }),
      top_libraries: topLibraries.map((library) => {
        return {
          name: library.name,
          media_type: library.mediaType,
          job_count: library.jobCount,
          completed_jobs: library.completedJobs,
          encoding_jobs: library.encodingJobs,
          total_savings_bytes: Number(library.totalSavedBytes),
          total_before_bytes: Number(library.totalBeforeBytes),
        };
      }),
      last_updated: new Date().toISOString(),
    };
  }

  /**
   * Get complete overview statistics in a single optimized response
   *
   * This method aggregates:
   * - System health (node status, storage)
   * - Queue statistics (job counts by stage, savings)
   * - Recent activity (last 10 completed jobs)
   * - Top libraries (by job count)
   *
   * @returns Complete dashboard statistics
   */
  async getOverviewStats(): Promise<OverviewStatsDto> {
    this.logger.log('Fetching complete overview statistics');

    // Execute all queries in parallel for optimal performance
    const [systemHealth, queueStats, recentActivity, topLibraries] = await Promise.all([
      this.getSystemHealth(),
      this.getQueueSummary(),
      this.getRecentActivity(),
      this.getTopLibraries(),
    ]);

    return {
      systemHealth,
      queueStats,
      recentActivity,
      topLibraries,
      timestamp: new Date(),
    };
  }

  /**
   * Get system health information
   *
   * Aggregates:
   * - Node status (active/offline counts)
   * - Total and used storage across all libraries
   *
   * @returns System health metrics
   */
  async getSystemHealth(): Promise<SystemHealthDto> {
    this.logger.debug('Calculating system health');

    // Get node counts by status
    const nodeStats = await this.prisma.node.groupBy({
      by: ['status'],
      _count: {
        status: true,
      },
    });

    const activeNodes = nodeStats.find((s) => s.status === NodeStatus.ONLINE)?._count.status || 0;
    const offlineNodes =
      (nodeStats.find((s) => s.status === NodeStatus.OFFLINE)?._count.status || 0) +
      (nodeStats.find((s) => s.status === NodeStatus.ERROR)?._count.status || 0);

    // Calculate overall system status
    let status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
    if (activeNodes === 0) {
      status = 'OFFLINE';
    } else if (offlineNodes > 0) {
      status = 'DEGRADED';
    } else {
      status = 'HEALTHY';
    }

    // Get storage statistics
    const storageStats = await this.prisma.library.aggregate({
      _sum: {
        totalSizeBytes: true,
      },
    });

    // For total storage, we'll use 5TB as default capacity
    // In production, this should be calculated from actual disk capacity
    const ESTIMATED_TOTAL_STORAGE = BigInt('5497558138880'); // 5TB in bytes
    const usedStorage = storageStats._sum.totalSizeBytes || BigInt(0);
    const storagePercent = Number((usedStorage * BigInt(100)) / ESTIMATED_TOTAL_STORAGE);

    // Calculate current CPU utilization
    const cpuPercent = this.calculateCpuUsage();

    return {
      status,
      activeNodes,
      offlineNodes,
      totalStorage: ESTIMATED_TOTAL_STORAGE.toString(),
      usedStorage: usedStorage.toString(),
      storagePercent: Number(storagePercent.toFixed(2)),
      cpuPercent,
    };
  }

  /**
   * Get queue summary statistics
   *
   * Aggregates job counts by stage and calculates total savings
   *
   * @returns Queue statistics
   */
  async getQueueSummary(): Promise<QueueStatsDto> {
    this.logger.debug('Calculating queue summary');

    // Get job counts by stage
    const jobsByStage = await this.prisma.job.groupBy({
      by: ['stage'],
      _count: {
        stage: true,
      },
    });

    const queued = jobsByStage.find((s) => s.stage === JobStage.QUEUED)?._count.stage || 0;
    const encoding = jobsByStage.find((s) => s.stage === JobStage.ENCODING)?._count.stage || 0;
    const completed = jobsByStage.find((s) => s.stage === JobStage.COMPLETED)?._count.stage || 0;
    const failed = jobsByStage.find((s) => s.stage === JobStage.FAILED)?._count.stage || 0;

    // Calculate total savings from completed jobs
    const savingsStats = await this.prisma.job.aggregate({
      where: {
        stage: JobStage.COMPLETED,
        savedBytes: {
          not: null,
        },
      },
      _sum: {
        savedBytes: true,
        beforeSizeBytes: true,
      },
    });

    const totalSavedBytes = savingsStats._sum.savedBytes || BigInt(0);
    const totalBeforeBytes = savingsStats._sum.beforeSizeBytes || BigInt(1);

    // Calculate percentage saved
    const totalSavedPercent =
      totalBeforeBytes > BigInt(0) ? Number((totalSavedBytes * BigInt(100)) / totalBeforeBytes) : 0;

    return {
      queued,
      encoding,
      completed,
      failed,
      totalSavedBytes: totalSavedBytes.toString(),
      totalSavedPercent: Number(totalSavedPercent.toFixed(2)),
    };
  }

  /**
   * Get recent activity (last 10 completed or encoding jobs)
   *
   * Shows both completed jobs and currently encoding jobs for better UX
   *
   * @returns Array of recent job activities with details
   */
  async getRecentActivity(): Promise<RecentActivityDto[]> {
    this.logger.debug('Fetching recent activity');

    const recentJobs = await this.prisma.job.findMany({
      where: {
        OR: [
          {
            stage: JobStage.COMPLETED,
            completedAt: {
              not: null,
            },
          },
          {
            stage: JobStage.ENCODING,
          },
        ],
      },
      include: {
        library: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [
        {
          stage: 'asc', // ENCODING jobs first (they come before COMPLETED alphabetically)
        },
        {
          updatedAt: 'desc', // Then by most recent
        },
      ],
      take: 10,
    });

    return recentJobs.map((job) => ({
      id: job.id,
      fileLabel: job.fileLabel,
      libraryName: job.library.name,
      sourceCodec: job.sourceCodec,
      targetCodec: job.targetCodec,
      stage: job.stage,
      beforeSizeBytes: job.beforeSizeBytes.toString(),
      afterSizeBytes: job.afterSizeBytes ? job.afterSizeBytes.toString() : null,
      savedBytes: job.savedBytes ? job.savedBytes.toString() : null,
      savedPercent: job.savedPercent,
      progress: job.stage === JobStage.ENCODING ? job.progress : null,
      completedAt: job.completedAt || job.updatedAt, // Use updatedAt for encoding jobs
    }));
  }

  /**
   * Get top 5 libraries by job count
   *
   * Includes job counts, encoding status, and total savings per library
   *
   * @returns Top libraries sorted by total job count
   */
  async getTopLibraries(): Promise<TopLibraryDto[]> {
    this.logger.debug('Fetching top libraries');

    const libraries = await this.prisma.library.findMany({
      include: {
        _count: {
          select: {
            jobs: true,
          },
        },
        jobs: {
          select: {
            stage: true,
            savedBytes: true,
            beforeSizeBytes: true,
          },
        },
      },
      orderBy: {
        jobs: {
          _count: 'desc',
        },
      },
      take: 5,
    });

    return libraries.map((library) => {
      const completedJobs = library.jobs.filter((j) => j.stage === JobStage.COMPLETED).length;
      const encodingJobs = library.jobs.filter((j) => j.stage === JobStage.ENCODING).length;

      const totalSavedBytes = library.jobs
        .filter((j) => j.stage === JobStage.COMPLETED)
        .reduce((sum, job) => sum + (job.savedBytes || BigInt(0)), BigInt(0));

      const totalBeforeBytes = library.jobs
        .filter((j) => j.stage === JobStage.COMPLETED)
        .reduce((sum, job) => sum + job.beforeSizeBytes, BigInt(0));

      return {
        id: library.id,
        name: library.name,
        mediaType: library.mediaType,
        path: library.path,
        jobCount: library._count.jobs,
        completedJobs,
        encodingJobs,
        totalSavedBytes: totalSavedBytes.toString(),
        totalBeforeBytes: totalBeforeBytes.toString(),
      };
    });
  }
}
