import { Injectable } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Time period for analytics
 */
export type TimePeriod = '24h' | '7d' | '30d' | '90d' | 'all';

/**
 * Space savings over time data point
 */
export interface SpaceSavingsDataPoint {
  date: string;
  savedBytes: number;
  savedPercent: number;
  jobCount: number;
}

/**
 * Encoding speed data point
 */
export interface EncodingSpeedDataPoint {
  date: string;
  avgFps: number;
  avgBytesPerSecond: number;
  codec: string;
  jobCount: number;
}

/**
 * Cost savings estimate
 */
export interface CostSavingsEstimate {
  totalSavedGB: number;
  estimatedMonthlyCost: number;
  estimatedYearlyCost: number;
  costPerGB: number;
  provider: string;
}

/**
 * Overall analytics summary
 */
export interface AnalyticsSummary {
  totalJobsProcessed: number;
  totalFilesEncoded: number;
  totalSpaceSavedGB: number;
  avgSavedPercent: number;
  totalProcessingTimeHours: number;
  successRate: number;
  mostEfficientCodec: string;
  fastestNode: string;
  peakEncodingHour: number;
}

/**
 * AnalyticsService
 *
 * Provides analytics and insights for encoding operations.
 *
 * Features:
 * - Space savings over time
 * - Encoding speed trends
 * - Cost savings calculator
 * - Performance metrics by codec/node
 * - Peak usage analysis
 */
@Injectable()
export class AnalyticsService {
  // Storage cost estimates per GB/month (USD)
  private readonly STORAGE_COSTS: Record<string, number> = {
    'AWS S3': 0.023,
    'Google Cloud': 0.02,
    'Azure Blob': 0.018,
    'Backblaze B2': 0.005,
    Wasabi: 0.006,
    'Local HDD': 0.002,
    'Local SSD': 0.008,
  };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get overall analytics summary
   */
  async getSummary(period: TimePeriod = 'all'): Promise<AnalyticsSummary> {
    const dateFilter = this.getDateFilter(period);

    // Total jobs and files
    const totalJobs = await this.prisma.job.count({
      where: {
        stage: JobStage.COMPLETED,
        completedAt: dateFilter,
      },
    });

    // Space savings aggregate
    const savingsAgg = await this.prisma.job.aggregate({
      where: {
        stage: JobStage.COMPLETED,
        completedAt: dateFilter,
      },
      _sum: { savedBytes: true },
      _avg: { savedPercent: true },
    });

    // Processing time (use aggregation instead of loading all rows)
    const timingStats = await this.prisma.job.aggregate({
      where: {
        stage: JobStage.COMPLETED,
        completedAt: dateFilter,
        startedAt: { not: null },
      },
      _count: { id: true },
    });

    // Get average processing time using raw SQL aggregation
    const avgProcessingResult = await this.prisma.$queryRaw<Array<{ avg_duration_ms: number }>>`
      SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as avg_duration_ms
      FROM jobs
      WHERE stage = 'COMPLETED'
        AND started_at IS NOT NULL
        AND completed_at IS NOT NULL
        ${dateFilter ? this.prisma.$queryRaw`AND completed_at >= ${dateFilter.gte} AND completed_at <= ${dateFilter.lte}` : this.prisma.$queryRaw``}
    `;

    const totalProcessingMs =
      (avgProcessingResult[0]?.avg_duration_ms || 0) * (timingStats._count.id || 0);

    // Success rate
    const failedJobs = await this.prisma.job.count({
      where: {
        stage: JobStage.FAILED,
        updatedAt: dateFilter,
      },
    });

    const successRate =
      totalJobs + failedJobs > 0 ? (totalJobs / (totalJobs + failedJobs)) * 100 : 100;

    // Most efficient codec
    const codecEfficiency = await this.prisma.job.groupBy({
      by: ['targetCodec'],
      where: {
        stage: JobStage.COMPLETED,
        completedAt: dateFilter,
      },
      _avg: { savedPercent: true },
      _count: true,
    });

    const mostEfficientCodec =
      codecEfficiency.sort((a, b) => (b._avg.savedPercent || 0) - (a._avg.savedPercent || 0))[0]
        ?.targetCodec || 'N/A';

    // Fastest node
    const nodePerformance = await this.getNodePerformance(period);
    const fastestNode =
      nodePerformance.sort((a, b) => b.avgBytesPerSecond - a.avgBytesPerSecond)[0]?.nodeName ||
      'N/A';

    // Peak hour
    const peakHour = await this.getPeakEncodingHour(period);

    return {
      totalJobsProcessed: totalJobs,
      totalFilesEncoded: totalJobs,
      totalSpaceSavedGB: Number(savingsAgg._sum.savedBytes || 0) / 1024 ** 3,
      avgSavedPercent: savingsAgg._avg.savedPercent || 0,
      totalProcessingTimeHours: totalProcessingMs / (1000 * 60 * 60),
      successRate,
      mostEfficientCodec,
      fastestNode,
      peakEncodingHour: peakHour,
    };
  }

  /**
   * Get space savings over time
   */
  async getSpaceSavingsOverTime(period: TimePeriod = '30d'): Promise<SpaceSavingsDataPoint[]> {
    const dateFilter = this.getDateFilter(period);
    const groupByFormat = this.getGroupByFormat(period);

    // Use raw SQL aggregation with GROUP BY instead of loading all rows
    const groupedResults = await this.prisma.$queryRaw<
      Array<{
        date_group: Date;
        total_saved_bytes: bigint;
        avg_saved_percent: number;
        job_count: number;
      }>
    >`
      SELECT
        DATE_TRUNC(${groupByFormat}, completed_at) as date_group,
        SUM(saved_bytes)::bigint as total_saved_bytes,
        AVG(saved_percent) as avg_saved_percent,
        COUNT(*)::int as job_count
      FROM jobs
      WHERE stage = 'COMPLETED'
        ${dateFilter ? this.prisma.$queryRaw`AND completed_at >= ${dateFilter.gte} AND completed_at <= ${dateFilter.lte}` : this.prisma.$queryRaw``}
      GROUP BY DATE_TRUNC(${groupByFormat}, completed_at)
      ORDER BY date_group ASC
    `;

    // Convert to Map format
    const grouped = new Map<string, { savedBytes: bigint; savedPercent: number; count: number }>();
    for (const row of groupedResults) {
      const dateKey = row.date_group.toISOString().split('T')[0];
      grouped.set(dateKey, {
        savedBytes: row.total_saved_bytes,
        savedPercent: row.avg_saved_percent,
        count: row.job_count,
      });
    }

    // Data already grouped and aggregated by SQL
    return Array.from(grouped.entries()).map(([date, data]) => ({
      date,
      savedBytes: Number(data.savedBytes),
      savedPercent: data.savedPercent, // Already averaged by SQL
      jobCount: data.count,
    }));
  }

  /**
   * Get encoding speed trends
   */
  async getEncodingSpeedTrends(period: TimePeriod = '30d'): Promise<EncodingSpeedDataPoint[]> {
    const dateFilter = this.getDateFilter(period);
    const groupByFormat = this.getGroupByFormat(period);

    const jobs = await this.prisma.job.findMany({
      where: {
        stage: JobStage.COMPLETED,
        completedAt: dateFilter,
        startedAt: { not: null },
        beforeSizeBytes: { gt: 0 },
      },
      select: {
        completedAt: true,
        startedAt: true,
        beforeSizeBytes: true,
        targetCodec: true,
      },
      orderBy: { completedAt: 'asc' },
      take: 10000,
    });

    // Group by date and codec
    const grouped = new Map<
      string,
      { totalBytes: number; totalSeconds: number; count: number; codec: string }
    >();

    for (const job of jobs) {
      if (!job.completedAt || !job.startedAt) continue;

      const dateKey = this.formatDate(job.completedAt, groupByFormat);
      const key = `${dateKey}-${job.targetCodec}`;

      const durationSeconds = (job.completedAt.getTime() - job.startedAt.getTime()) / 1000;
      const bytes = Number(job.beforeSizeBytes);

      if (durationSeconds <= 0) continue;

      const existing = grouped.get(key) || {
        totalBytes: 0,
        totalSeconds: 0,
        count: 0,
        codec: job.targetCodec,
      };

      existing.totalBytes += bytes;
      existing.totalSeconds += durationSeconds;
      existing.count++;

      grouped.set(key, existing);
    }

    return Array.from(grouped.entries()).map(([key, data]) => {
      const date = key.split('-').slice(0, -1).join('-');
      return {
        date,
        avgFps: data.totalBytes / data.totalSeconds / (1024 * 1024), // Approximate FPS
        avgBytesPerSecond: data.totalBytes / data.totalSeconds,
        codec: data.codec,
        jobCount: data.count,
      };
    });
  }

  /**
   * Calculate cost savings estimate
   */
  async getCostSavings(provider = 'AWS S3'): Promise<CostSavingsEstimate> {
    const costPerGB = this.STORAGE_COSTS[provider] || 0.02;

    const savingsAgg = await this.prisma.job.aggregate({
      where: { stage: JobStage.COMPLETED },
      _sum: { savedBytes: true },
    });

    const totalSavedGB = Number(savingsAgg._sum.savedBytes || 0) / 1024 ** 3;
    const estimatedMonthlyCost = totalSavedGB * costPerGB;
    const estimatedYearlyCost = estimatedMonthlyCost * 12;

    return {
      totalSavedGB,
      estimatedMonthlyCost,
      estimatedYearlyCost,
      costPerGB,
      provider,
    };
  }

  /**
   * Get all supported storage providers for cost calculation
   */
  getStorageProviders(): Array<{ name: string; costPerGB: number }> {
    return Object.entries(this.STORAGE_COSTS).map(([name, costPerGB]) => ({
      name,
      costPerGB,
    }));
  }

  /**
   * Get performance metrics by node
   */
  async getNodePerformance(period: TimePeriod = '30d'): Promise<
    Array<{
      nodeId: string;
      nodeName: string;
      jobCount: number;
      avgBytesPerSecond: number;
      avgSavedPercent: number;
      successRate: number;
    }>
  > {
    const dateFilter = this.getDateFilter(period);

    const completedJobs = await this.prisma.job.findMany({
      where: {
        stage: JobStage.COMPLETED,
        completedAt: dateFilter,
        startedAt: { not: null },
      },
      select: {
        nodeId: true,
        beforeSizeBytes: true,
        savedPercent: true,
        startedAt: true,
        completedAt: true,
        node: { select: { name: true } },
      },
      take: 10000,
    });

    const failedByNode = await this.prisma.job.groupBy({
      by: ['nodeId'],
      where: {
        stage: JobStage.FAILED,
        updatedAt: dateFilter,
      },
      _count: true,
    });

    const failedMap = new Map(failedByNode.map((f) => [f.nodeId, f._count]));

    // Group by node
    const nodeData = new Map<
      string,
      {
        nodeName: string;
        totalBytes: number;
        totalSeconds: number;
        totalSavedPercent: number;
        count: number;
      }
    >();

    for (const job of completedJobs) {
      if (!job.startedAt || !job.completedAt) continue;

      const durationSeconds = (job.completedAt.getTime() - job.startedAt.getTime()) / 1000;
      if (durationSeconds <= 0) continue;

      const existing = nodeData.get(job.nodeId) || {
        nodeName: job.node?.name || 'Unknown',
        totalBytes: 0,
        totalSeconds: 0,
        totalSavedPercent: 0,
        count: 0,
      };

      existing.totalBytes += Number(job.beforeSizeBytes);
      existing.totalSeconds += durationSeconds;
      existing.totalSavedPercent += job.savedPercent || 0;
      existing.count++;

      nodeData.set(job.nodeId, existing);
    }

    return Array.from(nodeData.entries()).map(([nodeId, data]) => {
      const failedCount = failedMap.get(nodeId) || 0;
      const totalAttempts = data.count + failedCount;

      return {
        nodeId,
        nodeName: data.nodeName,
        jobCount: data.count,
        avgBytesPerSecond: data.totalSeconds > 0 ? data.totalBytes / data.totalSeconds : 0,
        avgSavedPercent: data.count > 0 ? data.totalSavedPercent / data.count : 0,
        successRate: totalAttempts > 0 ? (data.count / totalAttempts) * 100 : 100,
      };
    });
  }

  /**
   * Get performance metrics by codec
   */
  async getCodecPerformance(period: TimePeriod = '30d'): Promise<
    Array<{
      codec: string;
      jobCount: number;
      avgSavedPercent: number;
      avgBytesPerSecond: number;
    }>
  > {
    const dateFilter = this.getDateFilter(period);

    const jobs = await this.prisma.job.findMany({
      where: {
        stage: JobStage.COMPLETED,
        completedAt: dateFilter,
        startedAt: { not: null },
      },
      select: {
        targetCodec: true,
        beforeSizeBytes: true,
        savedPercent: true,
        startedAt: true,
        completedAt: true,
      },
      take: 10000,
    });

    const codecData = new Map<
      string,
      {
        totalBytes: number;
        totalSeconds: number;
        totalSavedPercent: number;
        count: number;
      }
    >();

    for (const job of jobs) {
      if (!job.startedAt || !job.completedAt) continue;

      const durationSeconds = (job.completedAt.getTime() - job.startedAt.getTime()) / 1000;
      if (durationSeconds <= 0) continue;

      const existing = codecData.get(job.targetCodec) || {
        totalBytes: 0,
        totalSeconds: 0,
        totalSavedPercent: 0,
        count: 0,
      };

      existing.totalBytes += Number(job.beforeSizeBytes);
      existing.totalSeconds += durationSeconds;
      existing.totalSavedPercent += job.savedPercent || 0;
      existing.count++;

      codecData.set(job.targetCodec, existing);
    }

    return Array.from(codecData.entries()).map(([codec, data]) => ({
      codec,
      jobCount: data.count,
      avgSavedPercent: data.count > 0 ? data.totalSavedPercent / data.count : 0,
      avgBytesPerSecond: data.totalSeconds > 0 ? data.totalBytes / data.totalSeconds : 0,
    }));
  }

  /**
   * Get peak encoding hour
   */
  private async getPeakEncodingHour(period: TimePeriod): Promise<number> {
    const dateFilter = this.getDateFilter(period);

    const jobs = await this.prisma.job.findMany({
      where: {
        stage: JobStage.COMPLETED,
        completedAt: dateFilter,
      },
      select: { startedAt: true },
      take: 10000,
    });

    const hourCounts = new Array(24).fill(0);

    for (const job of jobs) {
      if (job.startedAt) {
        hourCounts[job.startedAt.getHours()]++;
      }
    }

    let peakHour = 0;
    let maxCount = 0;

    for (let i = 0; i < 24; i++) {
      if (hourCounts[i] > maxCount) {
        maxCount = hourCounts[i];
        peakHour = i;
      }
    }

    return peakHour;
  }

  /**
   * Get date filter for period
   */
  private getDateFilter(period: TimePeriod): { gte: Date; lte?: Date } | undefined {
    if (period === 'all') return undefined;

    const now = new Date();
    const ms: Record<string, number> = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
    };

    return { gte: new Date(now.getTime() - (ms[period] || 0)), lte: now };
  }

  /**
   * Get group by format for period
   */
  private getGroupByFormat(period: TimePeriod): 'hour' | 'day' | 'week' | 'month' {
    switch (period) {
      case '24h':
        return 'hour';
      case '7d':
        return 'day';
      case '30d':
        return 'day';
      case '90d':
        return 'week';
      default:
        return 'month';
    }
  }

  /**
   * Format date for grouping
   */
  private formatDate(date: Date, format: 'hour' | 'day' | 'week' | 'month'): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');

    switch (format) {
      case 'hour':
        return `${year}-${month}-${day} ${hour}:00`;
      case 'day':
        return `${year}-${month}-${day}`;
      case 'week': {
        const weekStart = new Date(date);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        return `${weekStart.getFullYear()}-W${String(Math.ceil(weekStart.getDate() / 7)).padStart(2, '0')}`;
      }
      case 'month':
        return `${year}-${month}`;
      default:
        return `${year}-${month}-${day}`;
    }
  }
}
