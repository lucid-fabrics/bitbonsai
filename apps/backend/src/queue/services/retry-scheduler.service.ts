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
   * Compute exponential backoff delay with jitter (BullMQ/Sidekiq style).
   *
   * delay = min(base * 2^(attempt-1), maxDelay) + rand(0, jitter)
   *
   * Example delays (without jitter):
   *   attempt 1 →  30s
   *   attempt 2 →   1m
   *   attempt 3 →   2m
   *   attempt 4 →   4m
   *   attempt 5 →   8m
   *   attempt 6 →  16m
   *   attempt 7 →  32m
   *   attempt 8+ →  60m (capped)
   *
   * @param attempt - 1-based attempt number (use job.retryCount + 1 for the upcoming attempt)
   * @returns delay in milliseconds
   */
  public computeNextRetryDelay(attempt: number): number {
    const BASE_MS = 30_000;
    const MAX_MS = 3_600_000;
    const JITTER_MS = 10_000;
    const exponential = BASE_MS * 2 ** Math.max(0, attempt - 1);
    const capped = Math.min(exponential, MAX_MS);
    const jitter = Math.floor(Math.random() * JITTER_MS);
    return capped + jitter;
  }

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

      // Reset jobs back to QUEUED individually so each gets its own nextRetryAt computed
      // from the exponential backoff formula (updateMany cannot write per-row values).
      let retriedCount = 0;
      for (const job of eligibleJobs) {
        try {
          const nextAttempt = job.retryCount + 1;
          const delayMs = this.computeNextRetryDelay(nextAttempt); // nextAttempt is 1-based upcoming attempt
          const nextRetryAt = new Date(Date.now() + delayMs);

          await this.jobRepository.updateById(job.id, {
            stage: JobStage.QUEUED,
            progress: 0,
            error: null,
            completedAt: null,
            startedAt: null,
            retryCount: nextAttempt,
            nextRetryAt,
          });

          retriedCount++;
          this.logger.log(
            `Retrying job: ${job.fileLabel} (attempt ${nextAttempt}/4, next retry window in ${Math.round(delayMs / 1000)}s)`
          );
        } catch (jobError) {
          this.logger.error(`Failed to re-queue job ${job.id} (${job.fileLabel})`, jobError);
        }
      }

      this.logger.log(`Background retry scheduler: ${retriedCount} job(s) re-queued`);
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
