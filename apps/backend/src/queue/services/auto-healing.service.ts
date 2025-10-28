import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * AutoHealingService
 *
 * Automatically recovers failed jobs on container restart.
 * Runs once during application startup to re-queue eligible failed jobs.
 *
 * Recovery Criteria:
 * - Job must be in FAILED stage
 * - retryCount must be < 3 (not permanently failed)
 * - Respects nextRetryAt timestamp (exponential backoff)
 */
@Injectable()
export class AutoHealingService implements OnModuleInit {
  private readonly logger = new Logger(AutoHealingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs automatically when the module initializes (container startup)
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('Auto-healing service initializing...');
    await this.healFailedJobs();
  }

  /**
   * Recover all eligible failed jobs
   *
   * Finds failed jobs that:
   * - Have retry attempts remaining (retryCount < 3)
   * - nextRetryAt is null or in the past
   * - Not permanently failed
   *
   * @returns Number of jobs healed
   */
  async healFailedJobs(): Promise<number> {
    try {
      const now = new Date();

      // Find eligible failed jobs
      const eligibleJobs = await this.prisma.job.findMany({
        where: {
          stage: JobStage.FAILED,
          retryCount: { lt: 3 },
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        select: {
          id: true,
          fileLabel: true,
          retryCount: true,
          nextRetryAt: true,
        },
      });

      if (eligibleJobs.length === 0) {
        this.logger.log('No failed jobs eligible for auto-healing');
        return 0;
      }

      this.logger.log(`Found ${eligibleJobs.length} failed job(s) eligible for retry`);

      // Reset jobs back to QUEUED
      const result = await this.prisma.job.updateMany({
        where: {
          id: {
            in: eligibleJobs.map((j) => j.id),
          },
        },
        data: {
          stage: JobStage.QUEUED,
          progress: 0,
          error: null,
          completedAt: null,
          startedAt: null,
          retryCount: { increment: 1 },
        },
      });

      this.logger.log(`Auto-healing complete: ${result.count} job(s) re-queued for retry`);

      // Log each healed job
      for (const job of eligibleJobs) {
        this.logger.log(`Healed job: ${job.fileLabel} (retry ${job.retryCount + 1}/3)`);
      }

      return result.count;
    } catch (error) {
      this.logger.error('Failed to heal failed jobs', error);
      return 0;
    }
  }
}
