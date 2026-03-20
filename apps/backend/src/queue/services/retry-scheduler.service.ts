import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';

/**
 * RetrySchedulerService
 *
 * Background scheduler that automatically retries failed jobs.
 * Runs every 5 minutes to check for jobs that are ready to retry.
 *
 * Retry Logic:
 * - Runs every 5 minutes
 * - Finds jobs with stage = FAILED
 * - retryCount < 3 (max retries)
 * - nextRetryAt <= now (exponential backoff has passed)
 * - Automatically moves them back to QUEUED
 * - Increments retryCount
 *
 * Exponential Backoff:
 * - Jobs respect nextRetryAt field set by previous failure
 * - Will not retry until backoff period has elapsed
 */
@Injectable()
export class RetrySchedulerService {
  private readonly logger = new Logger(RetrySchedulerService.name);

  constructor(private readonly jobRepository: JobRepository) {}

  /**
   * Background job that runs every 5 minutes
   * Automatically retries eligible failed jobs
   * PERF: Uses composite index (stage, retryCount, nextRetryAt) for optimal query performance
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryFailedJobs(): Promise<void> {
    try {
      const now = new Date();

      // PERF: Optimized query uses composite index (stage, retryCount, nextRetryAt)
      // Find eligible failed jobs
      const eligibleJobs = await this.jobRepository.findManySelect<{
        id: string;
        fileLabel: string;
        retryCount: number;
        nextRetryAt: Date | null;
        error: string | null;
      }>(
        {
          stage: JobStage.FAILED,
          retryCount: { lt: 3 },
          nextRetryAt: { lte: now },
        },
        { id: true, fileLabel: true, retryCount: true, nextRetryAt: true, error: true }
      );

      if (eligibleJobs.length === 0) {
        this.logger.debug('No failed jobs ready for retry');
        return;
      }

      this.logger.log(`Found ${eligibleJobs.length} failed job(s) ready for retry`);

      // Reset jobs back to QUEUED
      const result = await this.jobRepository.updateManyByIds(
        eligibleJobs.map((j) => j.id),
        {
          stage: JobStage.QUEUED,
          progress: 0,
          error: null,
          completedAt: null,
          startedAt: null,
          retryCount: { increment: 1 },
        }
      );

      this.logger.log(`Background retry scheduler: ${result.count} job(s) re-queued`);

      // Log each retried job
      for (const job of eligibleJobs) {
        this.logger.log(`Retrying job: ${job.fileLabel} (attempt ${job.retryCount + 2}/4)`);
      }
    } catch (error: unknown) {
      this.logger.error('Failed to retry jobs in background scheduler', error);
    }
  }

  /**
   * Manual trigger for testing (can be called via controller if needed)
   */
  async triggerManualRetry(): Promise<number> {
    this.logger.log('Manual retry trigger initiated');
    await this.retryFailedJobs();

    // Return count of retried jobs
    const now = new Date();
    const eligibleJobs = await this.jobRepository.countWhere({
      stage: JobStage.QUEUED,
      retryCount: { gt: 0 },
      updatedAt: { gte: new Date(now.getTime() - 60000) }, // Last minute
    });

    return eligibleJobs;
  }
}
