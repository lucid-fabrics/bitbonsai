import { Injectable, Logger } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { normalizeCodec } from '../../common/utils/codec.util';
import { PrismaService } from '../../prisma/prisma.service';
import type { JobStatsDto } from '../dto/job-stats.dto';

/**
 * QueueJobStatsService
 *
 * Handles aggregated job statistics calculations.
 * Extracted from QueueJobCrudService to separate stats concerns.
 */
@Injectable()
export class QueueJobStatsService {
  private readonly logger = new Logger(QueueJobStatsService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Get job statistics
   */
  async getJobStats(nodeId?: string): Promise<JobStatsDto> {
    this.logger.log(`Fetching job stats (node: ${nodeId || 'all'})`);

    const where = nodeId ? { nodeId } : {};

    const [
      detected,
      healthCheck,
      needsDecision,
      needsDecisionJobs,
      queued,
      transferring,
      encoding,
      verifying,
      completed,
      failed,
      cancelled,
      totalSaved,
    ] = await Promise.all([
      this.jobRepository.countWhere({ ...where, stage: JobStage.DETECTED }),
      this.jobRepository.countWhere({ ...where, stage: JobStage.HEALTH_CHECK }),
      this.jobRepository.countWhere({
        ...where,
        stage: JobStage.NEEDS_DECISION,
      }),
      this.jobRepository.findManyWithInclude<{
        sourceCodec: string;
        targetCodec: string;
      }>({
        where: { ...where, stage: JobStage.NEEDS_DECISION },
        select: { sourceCodec: true, targetCodec: true },
      }),
      this.jobRepository.countWhere({ ...where, stage: JobStage.QUEUED }),
      this.jobRepository.countWhere({ ...where, stage: JobStage.TRANSFERRING }),
      this.jobRepository.countWhere({ ...where, stage: JobStage.ENCODING }),
      this.jobRepository.countWhere({ ...where, stage: JobStage.VERIFYING }),
      this.jobRepository.countWhere({ ...where, stage: JobStage.COMPLETED }),
      this.jobRepository.countWhere({ ...where, stage: JobStage.FAILED }),
      this.jobRepository.countWhere({ ...where, stage: JobStage.CANCELLED }),
      this.jobRepository.aggregateSumWhere(
        { ...where, stage: JobStage.COMPLETED },
        { savedBytes: true }
      ),
    ]);

    const codecMatchCount = needsDecisionJobs.filter((job) => {
      const normalizedSource = normalizeCodec(job.sourceCodec);
      const normalizedTarget = normalizeCodec(job.targetCodec);
      return normalizedSource === normalizedTarget;
    }).length;

    return {
      detected,
      healthCheck,
      needsDecision,
      codecMatchCount,
      queued,
      transferring,
      encoding,
      verifying,
      completed,
      failed,
      cancelled,
      totalSavedBytes: ((totalSaved._sum.savedBytes as bigint | null) || BigInt(0)).toString(),
      nodeId,
    };
  }

  /**
   * Get Dead Letter Queue jobs (circuit-broken, permanently failed)
   */
  async getDlqJobs(
    skip = 0,
    take = 50
  ): Promise<{
    jobs: Array<{
      id: string;
      fileLabel: string;
      filePath: string;
      dlqEnteredAt: Date | null;
      circuitBrokenReason: string | null;
      totalAttempts: number;
      error: string | null;
    }>;
    total: number;
    skip: number;
    take: number;
  }> {
    this.logger.log(`Fetching DLQ jobs (skip: ${skip}, take: ${take})`);

    const where = { dlqEnteredAt: { not: null } };

    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        select: {
          id: true,
          fileLabel: true,
          filePath: true,
          dlqEnteredAt: true,
          circuitBrokenReason: true,
          totalAttempts: true,
          error: true,
        },
        orderBy: { dlqEnteredAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.job.count({ where }),
    ]);

    return { jobs, total, skip, take };
  }
}
