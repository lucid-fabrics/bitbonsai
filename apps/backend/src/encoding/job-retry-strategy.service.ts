import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import type { JobWithPolicy } from './encoding-file.service';
import { CodecFallbackService } from './services/codec-fallback.service';
import { GpuHealthService } from './services/gpu-health.service';

/**
 * JobRetryStrategyService
 *
 * Encapsulates retry decision logic and exponential backoff for encoding jobs.
 *
 * Responsibilities:
 * - Fall back GPU-accelerated encodes to a software codec instead of retrying
 *   the same broken hardware path
 * - Classify errors as non-retriable (corrupted source / fatal) vs everything else
 * - Apply exponential backoff: 1min → 2min → 4min
 * - Update job state via QueueService on retry or permanent failure
 */
@Injectable()
export class JobRetryStrategyService {
  private readonly logger = new Logger(JobRetryStrategyService.name);

  private readonly MAX_RETRIES = 3;

  constructor(
    private readonly queueService: QueueService,
    private readonly codecFallbackService: CodecFallbackService,
    private readonly gpuHealth: GpuHealthService
  ) {}

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
      // GPU→CPU FALLBACK: a broken hardware encoder path won't fix itself on
      // retry, so drop straight to the software equivalent instead of burning
      // retries on the same doomed codec.
      if (this.codecFallbackService.shouldFallback(job, errorMessage)) {
        // Arm the 60s GPU cooldown so hardware detection skips GPU branches
        // for other jobs while the GPU recovers.
        this.gpuHealth.recordGpuFailure(errorMessage);
        await this.codecFallbackService.applyFallback(job.id, job.targetCodec);
        await this.queueService.update(job.id, {
          stage: 'QUEUED',
          progress: 0,
          error: `GPU encoding failed, falling back to software encoding: ${errorMessage}`,
        });
        return;
      }

      // Default to retrying unless the error is explicitly fatal (corrupted
      // source, or flagged [FATAL] by the ffmpeg error analyzer). Narrowly
      // matching a transient-keyword allowlist here left disk-full/OOM/generic
      // ffmpeg failures with zero retries even though they're often recoverable.
      const isNonRetriable = this.isNonRetriableError(errorMessage);
      const shouldRetry = !isNonRetriable;

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
        // shouldRetry is only false when isNonRetriable is true (retry is now
        // the default), so this is always the corrupted-source case unless
        // retries were exhausted below.
        const failureReason = isNonRetriable
          ? `Non-retriable error (corrupted source file): ${errorMessage}`
          : `All ${this.MAX_RETRIES} retry attempts exhausted (${totalAttempts} total failures). Last error: ${errorMessage}`;

        this.logger.error(`Job ${job.id} permanently failed: ${failureReason}`);
        await this.queueService.failJob(job.id, failureReason);
      }
    } catch (updateError: unknown) {
      this.logger.error(`Error updating failed job ${job.id}:`, updateError);
    }
  }

  /**
   * Check if error is non-retriable (corrupted source, or explicitly
   * flagged [FATAL] by the ffmpeg error analyzer upstream).
   * Returns true if the job should NOT be retried.
   */
  isNonRetriableError(errorMessage: string): boolean {
    if (errorMessage.startsWith('[FATAL]')) {
      return true;
    }

    const nonRetriablePatterns = [
      'non-retriable error', // Flag from FFmpeg service
      'source file appears corrupted', // Decoder errors
      'could not find ref with poc', // HEVC reference frame error
      'error submitting packet to decoder', // Decoder error
      'invalid data found when processing input', // Corrupted container
      'corrupt decoded frame', // Corrupted frame
      'missing reference picture', // Missing reference frame
      'moov atom not found', // Corrupted MP4
      'source file not found', // File moved/deleted after job was queued
      'no such file', // File moved/deleted after job was queued
      'file not found', // File moved/deleted after job was queued
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
