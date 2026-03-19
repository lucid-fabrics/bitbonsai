import * as os from 'node:os';
import { Injectable, Logger } from '@nestjs/common';
import { JobStage, NodeStatus } from '@prisma/client';
import { JobRepository } from '../common/repositories/job.repository';
import { LibraryRepository } from '../common/repositories/library.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import type { NodeStatusModel, OverviewResponseDto } from './dto/overview-response.dto';
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
  private lastCpuMeasure: { idle: number; total: number; timestamp: number } | null = null;

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly nodeRepository: NodeRepository,
    private readonly libraryRepository: LibraryRepository
  ) {}

  /**
   * Calculate current CPU utilization percentage using delta measurement
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

    const now = Date.now();

    // If we don't have a previous measure, store current and return 0
    if (!this.lastCpuMeasure) {
      this.lastCpuMeasure = { idle: totalIdle, total: totalTick, timestamp: now };
      return 0;
    }

    // Calculate deltas since last measurement
    const idleDelta = totalIdle - this.lastCpuMeasure.idle;
    const totalDelta = totalTick - this.lastCpuMeasure.total;

    // Update last measurement
    this.lastCpuMeasure = { idle: totalIdle, total: totalTick, timestamp: now };

    // Calculate usage percentage from delta
    const cpuUsage = totalDelta === 0 ? 0 : 100 - (100 * idleDelta) / totalDelta;
    return Number(cpuUsage.toFixed(1));
  }

  /**
   * Get complete overview statistics in a single optimized response
   * with snake_case field names for frontend compatibility
   *
   * This method aggregates:
   * - System health (active nodes, queue status, storage saved, success rate)
   * - Queue summary (job counts by stage)
   * - Node status (per-node statistics)
   * - Recent activity (last 10 completed jobs)
   * - Top libraries (by job count)
   *
   * @returns Complete dashboard statistics in snake_case format
   */
  async getOverview(): Promise<OverviewResponseDto> {
    this.logger.log('Fetching overview statistics for frontend');

    // Execute all queries in parallel for optimal performance
    const [systemHealth, queueStats, nodeStatus, recentActivity, topLibraries] = await Promise.all([
      this.getSystemHealth(),
      this.getQueueSummary(),
      this.getNodeStatus(),
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
      node_status: nodeStatus,
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
    const nodeStats = await this.nodeRepository.groupByStatusCount();

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
    const storageStats = await this.libraryRepository.aggregateTotalSizeBytes();

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
    const jobsByStage = await this.jobRepository.groupByStageCount({});

    const queued = jobsByStage.find((s) => s.stage === JobStage.QUEUED)?._count || 0;
    const encoding = jobsByStage.find((s) => s.stage === JobStage.ENCODING)?._count || 0;
    const completed = jobsByStage.find((s) => s.stage === JobStage.COMPLETED)?._count || 0;
    const failed = jobsByStage.find((s) => s.stage === JobStage.FAILED)?._count || 0;

    // Calculate total savings from completed jobs
    const savingsStats = await this.jobRepository.aggregateSumWhere(
      { stage: JobStage.COMPLETED, savedBytes: { not: null } },
      { savedBytes: true, beforeSizeBytes: true }
    );

    const totalSavedBytes =
      (savingsStats._sum as Record<string, bigint | null>).savedBytes || BigInt(0);
    const totalBeforeBytes =
      (savingsStats._sum as Record<string, bigint | null>).beforeSizeBytes || BigInt(1);

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

    const recentJobs = await this.jobRepository.findManyWithInclude<any>({
      where: {
        OR: [
          { stage: JobStage.COMPLETED, completedAt: { not: null } },
          { stage: JobStage.ENCODING },
        ],
      },
      include: { library: { select: { name: true } } },
      orderBy: [{ stage: 'asc' }, { updatedAt: 'desc' }],
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
   * Get node status with statistics for all nodes
   *
   * Provides per-node statistics including:
   * - Encoding job count
   * - Completed job count
   * - Total savings
   * - CPU usage (from latest heartbeat)
   * - Estimated time remaining
   *
   * @returns Array of node status objects
   */
  async getNodeStatus(): Promise<NodeStatusModel[]> {
    this.logger.debug('Fetching node status with statistics');

    // Get all nodes with their job counts
    const nodes = await this.nodeRepository.findManyWithJobCountOrdered();

    // Get encoding job counts per node
    const encodingCounts = await this.jobRepository.groupByNodeIdCount({
      stage: JobStage.ENCODING,
    });

    // Get completed job counts and savings per node
    const completedStats = await this.jobRepository.groupByNodeIdSum(
      { stage: JobStage.COMPLETED },
      { savedBytes: true }
    );

    // Get failed job counts per node
    const failedCounts = await this.jobRepository.groupByNodeIdCount({ stage: JobStage.FAILED });

    // Get queued jobs per node (for time estimation)
    const queuedJobsByNode = await this.jobRepository.groupByNodeIdCount({
      stage: JobStage.QUEUED,
    });

    // Calculate average encoding time per job (in seconds)
    const completedJobs = await this.jobRepository.findManySelect<{
      startedAt: Date | null;
      completedAt: Date | null;
    }>(
      { stage: JobStage.COMPLETED, startedAt: { not: null }, completedAt: { not: null } },
      { startedAt: true, completedAt: true }
    );

    let avgEncodingTime = 0;
    if (completedJobs.length > 0) {
      const totalTime = completedJobs.reduce((sum, job) => {
        if (job.startedAt && job.completedAt) {
          return sum + (job.completedAt.getTime() - job.startedAt.getTime());
        }
        return sum;
      }, 0);
      avgEncodingTime = totalTime / completedJobs.length / 1000; // Convert to seconds
    }

    // Get system CPU usage for MAIN node
    const systemCpuUsage = this.calculateCpuUsage();

    // Map nodes to response format
    return nodes.map((node) => {
      const encodingCount = encodingCounts.find((c) => c.nodeId === node.id)?._count || 0;
      const completedStat = completedStats.find((s) => s.nodeId === node.id);
      const completedCount = completedStat?._count?.id || 0;
      const failedCount = failedCounts.find((f) => f.nodeId === node.id)?._count || 0;
      const totalSavedBytes =
        (completedStat?._sum as Record<string, bigint | null> | undefined)?.savedBytes || BigInt(0);

      // Calculate success rate (show 0% if no jobs completed yet)
      const totalJobs = completedCount + failedCount;
      const successRate =
        totalJobs > 0 ? Number(((completedCount / totalJobs) * 100).toFixed(1)) : 0;

      // Calculate total queue time for this specific node
      const queuedForNode = queuedJobsByNode.find((q) => q.nodeId === node.id)?._count || 0;
      const totalQueueTime =
        queuedForNode > 0 && avgEncodingTime > 0
          ? Math.ceil(queuedForNode * avgEncodingTime)
          : null;

      return {
        id: node.id,
        name: node.name,
        role: node.role,
        status: node.status,
        acceleration: node.acceleration,
        cpu_usage: node.role === 'MAIN' ? systemCpuUsage : null, // Use system CPU for MAIN node
        encoding_count: encodingCount,
        completed_count: completedCount,
        failed_count: failedCount,
        total_saved_bytes: Number(totalSavedBytes),
        success_rate: successRate,
        total_queue_time_seconds: totalQueueTime,
        last_heartbeat: node.lastHeartbeat.toISOString(),
      };
    });
  }

  /**
   * Get top 5 libraries by job count
   *
   * Includes job counts, encoding status, and total savings per library
   * Uses optimized Prisma aggregations to avoid loading all job records
   *
   * @returns Top libraries sorted by total job count
   */
  async getTopLibraries(): Promise<TopLibraryDto[]> {
    this.logger.debug('Fetching top libraries');

    // Get top 5 libraries with total job counts only (no job data)
    const libraries = await this.libraryRepository.findManyWithJobCountOrdered(5);

    // If no libraries, return empty array
    if (libraries.length === 0) {
      return [];
    }

    const libraryIds = libraries.map((l) => l.id);

    // Aggregate completed job counts per library
    const completedCounts = await this.jobRepository.groupByLibraryIdCount({
      stage: JobStage.COMPLETED,
      libraryId: { in: libraryIds },
    });

    // Aggregate encoding job counts per library
    const encodingCounts = await this.jobRepository.groupByLibraryIdCount({
      stage: JobStage.ENCODING,
      libraryId: { in: libraryIds },
    });

    // Aggregate savings per library
    const librarySavings = await this.jobRepository.groupByLibraryIdSum(
      { stage: JobStage.COMPLETED, libraryId: { in: libraryIds } },
      { savedBytes: true, beforeSizeBytes: true }
    );

    // Combine the data
    return libraries.map((library) => {
      const completed = completedCounts.find((c) => c.libraryId === library.id)?._count?.id || 0;
      const encoding = encodingCounts.find((e) => e.libraryId === library.id)?._count?.id || 0;
      const savings = librarySavings.find((s) => s.libraryId === library.id);

      return {
        id: library.id,
        name: library.name,
        mediaType: library.mediaType,
        path: library.path,
        jobCount: library._count.jobs,
        completedJobs: completed,
        encodingJobs: encoding,
        totalSavedBytes: (
          (savings?._sum as Record<string, bigint | null> | undefined)?.savedBytes || BigInt(0)
        ).toString(),
        totalBeforeBytes: (
          (savings?._sum as Record<string, bigint | null> | undefined)?.beforeSizeBytes || BigInt(0)
        ).toString(),
      };
    });
  }
}
