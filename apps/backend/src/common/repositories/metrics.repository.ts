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
    licenseId?: string;
  }): Promise<Metric[]> {
    return this.findMany<Metric>({
      where: {
        date: {
          gte: params.startDate,
          lte: params.endDate,
        },
        nodeId: params.nodeId || undefined,
        licenseId: params.licenseId || undefined,
      },
      orderBy: { date: 'asc' },
    });
  }

  async aggregateByLicense(licenseId?: string): Promise<MetricAggregateResult> {
    const where = licenseId ? { licenseId } : {};
    return this.aggregate<MetricAggregateResult>({
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
  }

  async findCodecDistributions(licenseId?: string): Promise<Pick<Metric, 'codecDistribution'>[]> {
    return this.findMany<Pick<Metric, 'codecDistribution'>>({
      where: licenseId ? { licenseId } : {},
      select: { codecDistribution: true },
    });
  }

  async findByDateRangeOrdered(params: {
    startDate: Date;
    endDate: Date;
    licenseId?: string;
  }): Promise<Metric[]> {
    const where: Record<string, unknown> = {
      date: {
        gte: params.startDate,
        lte: params.endDate,
      },
    };

    if (params.licenseId) {
      where.licenseId = params.licenseId;
    }

    return this.findMany<Metric>({
      where,
      orderBy: { date: 'asc' },
    });
  }
}
