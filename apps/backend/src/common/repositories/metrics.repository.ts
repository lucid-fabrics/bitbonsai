import { Injectable } from '@nestjs/common';
import { type Metric } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from './base.repository';

interface MetricAggregateResult {
  _sum: {
    jobsCompleted: number | null;
    jobsFailed: number | null;
    totalSavedBytes: bigint | null;
  };
  _avg: {
    avgThroughputFilesPerHour: number | null;
  };
}

@Injectable()
export class MetricsRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma, 'metric');
  }

  async findByDateRange(params: {
    startDate: Date;
    endDate: Date;
    nodeId?: string;
    licenseId?: string; // kept for call-site compatibility — ignored (column removed)
  }): Promise<Metric[]> {
    return this.findMany<Metric>({
      where: {
        date: {
          gte: params.startDate,
          lte: params.endDate,
        },
        nodeId: params.nodeId || undefined,
      },
      orderBy: { date: 'asc' },
    });
  }

  async aggregateByLicense(_licenseId?: string): Promise<MetricAggregateResult> {
    // licenseId column removed — aggregate across all metrics
    return this.aggregate<MetricAggregateResult>({
      where: {},
      _sum: {
        jobsCompleted: true,
        jobsFailed: true,
        totalSavedBytes: true,
      },
      _avg: {
        avgThroughputFilesPerHour: true,
      },
    });
  }

  async findCodecDistributions(_licenseId?: string): Promise<Pick<Metric, 'codecDistribution'>[]> {
    // licenseId column removed — return all
    return this.findMany<Pick<Metric, 'codecDistribution'>>({
      where: {},
      select: { codecDistribution: true },
    });
  }

  async findByDateRangeOrdered(params: {
    startDate: Date;
    endDate: Date;
    licenseId?: string; // kept for call-site compatibility — ignored (column removed)
  }): Promise<Metric[]> {
    return this.findMany<Metric>({
      where: {
        date: {
          gte: params.startDate,
          lte: params.endDate,
        },
      },
      orderBy: { date: 'asc' },
    });
  }
}
