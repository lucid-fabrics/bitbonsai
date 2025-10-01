import { Injectable, Logger } from '@nestjs/common';
import { JobStage, NodeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

    return {
      status,
      activeNodes,
      offlineNodes,
      totalStorage: ESTIMATED_TOTAL_STORAGE.toString(),
      usedStorage: usedStorage.toString(),
      storagePercent: Number(storagePercent.toFixed(2)),
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
   * Get recent activity (last 10 completed jobs)
   *
   * @returns Array of recent job completions with details
   */
  async getRecentActivity(): Promise<RecentActivityDto[]> {
    this.logger.debug('Fetching recent activity');

    const recentJobs = await this.prisma.job.findMany({
      where: {
        stage: JobStage.COMPLETED,
        completedAt: {
          not: null,
        },
      },
      include: {
        library: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        completedAt: 'desc',
      },
      take: 10,
    });

    return recentJobs.map((job) => ({
      id: job.id,
      fileLabel: job.fileLabel,
      libraryName: job.library.name,
      sourceCodec: job.sourceCodec,
      targetCodec: job.targetCodec,
      stage: job.stage,
      savedBytes: (job.savedBytes || BigInt(0)).toString(),
      savedPercent: job.savedPercent || 0,
      completedAt: job.completedAt!,
    }));
  }

  /**
   * Get top 5 libraries by job count
   *
   * Includes job counts and total savings per library
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
          where: {
            stage: JobStage.COMPLETED,
          },
          select: {
            savedBytes: true,
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
      const completedJobs = library.jobs.length;
      const totalSavedBytes = library.jobs.reduce(
        (sum, job) => sum + (job.savedBytes || BigInt(0)),
        BigInt(0)
      );

      return {
        id: library.id,
        name: library.name,
        path: library.path,
        jobCount: library._count.jobs,
        completedJobs,
        totalSavedBytes: totalSavedBytes.toString(),
      };
    });
  }
}
