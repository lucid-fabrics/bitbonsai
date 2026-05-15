import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import type { JobWithPolicy } from './encoding-file.service';

/**
 * JobRetryStrategyService
 *
 * Encapsulates retry decision logic and exponential backoff for encoding jobs.
 *
 * Responsibilities:
 * - Classify errors as non-retriable (corrupted source) vs transient (network)
 * - Apply exponential backoff: 1min → 2min → 4min
 * - Update job state via QueueService on retry or permanent failure
 */
@Injectable()
export class JobRetryStrategyService {
  private readonly logger = new Logger(JobRetryStrategyService.name);

  private readonly MAX_RETRIES = 3;

  constructor(private readonly queueService: QueueService) {}

  /**
   * Handle job failure with retry logic and exponential backoff.
   *
   * Backoff delays:
   * - Attempt 1 (retry after 1st failure): 1 min delay
   * - Attempt 2 (retry after 2nd failure): 2 min delay
   * - Attempt 3 (retry after 3rd failure): 4 min delay
   * - After 3 attempts (4th failure): Job marked as FAILED
   */
  async handleJobFailure(job: JobWithPolicy, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error(`Job ${job.id} failed: ${errorMessage}`);

    try {
      const isNonRetriable = this.isNonRetriableError(errorMessage);
      const shouldRetry = !isNonRetriable && this.isTransientError(errorMessage);

      const currentAttempt = job.retryCount || 0;
      const nextAttempt = currentAttempt + 1;
      const totalAttempts = currentAttempt + 1;

      if (shouldRetry && nextAttempt <= this.MAX_RETRIES) {
        // Exponential backoff: base 60s × 2^currentAttempt
        const baseDelaySeconds = 60;
        const delaySeconds = baseDelaySeconds * 2 ** currentAttempt;
        const nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
        const delayMinutes = Math.floor(delaySeconds / 60);

        this.logger.log(
          `Retrying job ${job.id}: Attempt ${totalAttempts} of ${this.MAX_RETRIES} failed. ` +
            `Next retry (attempt ${nextAttempt}) in ${delayMinutes} minute(s) at ${nextRetryAt.toISOString()}`
        );

        // MULTI-NODE: Use QueueService proxy to support LINKED nodes
        await this.queueService.update(job.id, {
          stage: 'QUEUED',
          progress: 0,
          retryCount: nextAttempt,
          nextRetryAt,
          error: `Attempt ${totalAttempts}/${this.MAX_RETRIES} failed: ${errorMessage}. Retrying in ${delayMinutes}min...`,
        });
      } else {
        let failureReason: string;
        if (isNonRetriable) {
          failureReason = `Non-retriable error (corrupted source file): ${errorMessage}`;
          this.logger.error(`Job ${job.id} permanently failed - corrupted source file detected`);
        } else if (shouldRetry) {
          failureReason = `All ${this.MAX_RETRIES} retry attempts exhausted (${totalAttempts} total failures). Last error: ${errorMessage}`;
        } else {
          failureReason = `Non-retriable error after ${totalAttempts} attempt(s): ${errorMessage}`;
        }

        this.logger.error(`Job ${job.id} permanently failed: ${failureReason}`);
        await this.queueService.failJob(job.id, failureReason);
      }
    } catch (updateError: unknown) {
      this.logger.error(`Error updating failed job ${job.id}:`, updateError);
    }
  }

  /**
   * Check if error is non-retriable (corrupted source file).
   * Returns true if the job should NOT be retried.
   */
  isNonRetriableError(errorMessage: string): boolean {
    const nonRetriablePatterns = [
      'non-retriable error', // Flag from FFmpeg service
      'source file appears corrupted', // Decoder errors
      'could not find ref with poc', // HEVC reference frame error
      'error submitting packet to decoder', // Decoder error
      'invalid data found when processing input', // Corrupted container
      'corrupt decoded frame', // Corrupted frame
      'missing reference picture', // Missing reference frame
      'moov atom not found', // Corrupted MP4
    ];

    const errorLower = errorMessage.toLowerCase();
    return nonRetriablePatterns.some((pattern) => errorLower.includes(pattern.toLowerCase()));
  }

  /**
   * Check if error is transient and should be retried.
   */
  isTransientError(errorMessage: string): boolean {
    const transientErrors = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'temporarily unavailable',
      'network',
    ];

    return transientErrors.some((err) => errorMessage.toLowerCase().includes(err.toLowerCase()));
  }
}
