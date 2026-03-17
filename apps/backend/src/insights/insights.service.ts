import { Injectable, Logger } from '@nestjs/common';
import type { Metric } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CodecDistributionDto } from './dto/codec-distribution.dto';
import type { InsightsStatsDto } from './dto/insights-stats.dto';
import type { NodeComparisonDto } from './dto/node-comparison.dto';
import type { SavingsTrendDto } from './dto/savings-trend.dto';

/**
 * Service for analytics and insights
 * Provides aggregated metrics, trends, and performance comparisons
 */
@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get time-series metrics for a date range with optional filters
   */
  async getTimeSeriesMetrics(params: {
    startDate: Date;
    endDate: Date;
    nodeId?: string;
    licenseId?: string;
  }): Promise<Metric[]> {
    this.logger.log(
      `Fetching time-series metrics from ${params.startDate.toISOString()} to ${params.endDate.toISOString()}`
    );

    return this.prisma.metric.findMany({
      where: {
        date: {
          gte: params.startDate,
          lte: params.endDate,
        },
        nodeId: params.nodeId || undefined,
        licenseId: params.licenseId || undefined,
      },
      orderBy: {
        date: 'asc',
      },
    });
  }

  /**
   * Get aggregated statistics across all jobs and nodes
   */
  async getAggregatedStats(licenseId?: string): Promise<InsightsStatsDto> {
    this.logger.log(`Calculating aggregated stats${licenseId ? ` for license ${licenseId}` : ''}`);

    const where = licenseId ? { licenseId } : {};

    const result = await this.prisma.metric.aggregate({
      where,
      _sum: {
        jobsCompleted: true,
        jobsFailed: true,
        totalSavedBytes: true,
      },
      _avg: {
        avgThroughputFilesPerHour: true,
      },
    });

    const totalCompleted = result._sum.jobsCompleted || 0;
    const totalFailed = result._sum.jobsFailed || 0;
    const totalJobs = totalCompleted + totalFailed;
    const successRate = totalJobs > 0 ? (totalCompleted / totalJobs) * 100 : 0;

    // Convert BigInt to string and GB
    const totalSavedBytes = result._sum.totalSavedBytes || BigInt(0);
    const totalSavedGB = Number(totalSavedBytes) / (1024 * 1024 * 1024);

    return {
      totalJobsCompleted: totalCompleted,
      totalJobsFailed: totalFailed,
      totalSavedBytes: totalSavedBytes.toString(),
      totalSavedGB: Math.round(totalSavedGB * 100) / 100,
      avgThroughput: Math.round((result._avg.avgThroughputFilesPerHour || 0) * 100) / 100,
      successRate: Math.round(successRate * 100) / 100,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get codec distribution chart data
   */
  async getCodecDistribution(licenseId?: string): Promise<CodecDistributionDto> {
    this.logger.log(
      `Calculating codec distribution${licenseId ? ` for license ${licenseId}` : ''}`
    );

    const where = licenseId ? { licenseId } : {};

    // Aggregate codec counts from metrics
    const metrics = await this.prisma.metric.findMany({
      where,
      select: {
        codecDistribution: true,
      },
    });

    // Merge all codec distributions
    const codecCounts: Record<string, number> = {};
    let totalFiles = 0;

    for (const metric of metrics) {
      const distribution = metric.codecDistribution as Record<string, number>;
      for (const [codec, count] of Object.entries(distribution)) {
        codecCounts[codec] = (codecCounts[codec] || 0) + count;
        totalFiles += count;
      }
    }

    // Convert to array and calculate percentages
    const distribution = Object.entries(codecCounts)
      .map(([codec, count]) => ({
        codec,
        count,
        percentage: totalFiles > 0 ? Math.round((count / totalFiles) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      distribution,
      totalFiles,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get savings trend over a specified number of days
   */
  async getSavingsTrend(days: number, licenseId?: string): Promise<SavingsTrendDto> {
    this.logger.log(
      `Calculating savings trend for ${days} days${licenseId ? ` for license ${licenseId}` : ''}`
    );

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    const where: { date: { gte: Date; lte: Date }; licenseId?: string } = {
      date: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (licenseId) {
      where.licenseId = licenseId;
    }

    const metrics = await this.prisma.metric.findMany({
      where,
      orderBy: {
        date: 'asc',
      },
    });

    // Group by date and sum metrics
    const dailyMetrics = new Map<string, { savedBytes: bigint; jobsCompleted: number }>();

    for (const metric of metrics) {
      const dateKey = metric.date.toISOString().split('T')[0];
      const existing = dailyMetrics.get(dateKey) || { savedBytes: BigInt(0), jobsCompleted: 0 };

      dailyMetrics.set(dateKey, {
        savedBytes: existing.savedBytes + metric.totalSavedBytes,
        jobsCompleted: existing.jobsCompleted + metric.jobsCompleted,
      });
    }

    // Convert to trend array
    const trend = Array.from(dailyMetrics.entries())
      .map(([date, data]) => ({
        date,
        savedBytes: data.savedBytes.toString(),
        savedGB: Math.round((Number(data.savedBytes) / (1024 * 1024 * 1024)) * 100) / 100,
        jobsCompleted: data.jobsCompleted,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calculate totals
    let totalSavedBytes = BigInt(0);
    for (const point of trend) {
      totalSavedBytes += BigInt(point.savedBytes);
    }

    const totalSavedGB = Math.round((Number(totalSavedBytes) / (1024 * 1024 * 1024)) * 100) / 100;

    return {
      trend,
      totalSavedBytes: totalSavedBytes.toString(),
      totalSavedGB,
      days: trend.length,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get performance comparison across nodes
   */
  async getNodeComparison(licenseId?: string): Promise<NodeComparisonDto> {
    this.logger.log(`Calculating node comparison${licenseId ? ` for license ${licenseId}` : ''}`);

    // Get all nodes with their metrics
    const nodes = await this.prisma.node.findMany({
      where: licenseId ? { licenseId } : undefined,
      include: {
        metrics: true,
      },
    });

    const nodeMetrics = nodes.map((node) => {
      // Aggregate metrics for this node
      let jobsCompleted = 0;
      let jobsFailed = 0;
      let totalSavedBytes = BigInt(0);
      let totalThroughput = 0;
      let metricCount = 0;

      for (const metric of node.metrics) {
        jobsCompleted += metric.jobsCompleted;
        jobsFailed += metric.jobsFailed;
        totalSavedBytes += metric.totalSavedBytes;
        totalThroughput += metric.avgThroughputFilesPerHour;
        metricCount++;
      }

      const totalJobs = jobsCompleted + jobsFailed;
      const successRate = totalJobs > 0 ? (jobsCompleted / totalJobs) * 100 : 0;
      const avgThroughput = metricCount > 0 ? totalThroughput / metricCount : 0;
      const totalSavedGB = Number(totalSavedBytes) / (1024 * 1024 * 1024);

      return {
        nodeId: node.id,
        nodeName: node.name,
        acceleration: node.acceleration,
        jobsCompleted,
        jobsFailed,
        successRate: Math.round(successRate * 100) / 100,
        totalSavedBytes: totalSavedBytes.toString(),
        totalSavedGB: Math.round(totalSavedGB * 100) / 100,
        avgThroughput: Math.round(avgThroughput * 100) / 100,
        status: node.status,
      };
    });

    // Sort by total saved bytes (descending)
    nodeMetrics.sort((a, b) => Number(BigInt(b.totalSavedBytes) - BigInt(a.totalSavedBytes)));

    return {
      nodes: nodeMetrics,
      timestamp: new Date().toISOString(),
    };
  }
}
