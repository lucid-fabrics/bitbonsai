import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';

/**
 * JobCleanupService
 *
 * Handles automatic cleanup and recovery of stuck or timed-out encoding jobs.
 * Implements two mechanisms:
 * 1. Startup Cleanup - Resets stuck ENCODING jobs when the app starts
 * 2. Timeout Detector - Marks jobs as FAILED if they've been encoding too long
 */
@Injectable()
export class JobCleanupService implements OnModuleInit {
  private readonly logger = new Logger(JobCleanupService.name);

  // Configuration (can be overridden via environment variables)
  private readonly STUCK_THRESHOLD_MINUTES = parseInt(
    process.env.JOB_STUCK_THRESHOLD_MINUTES || '5',
    10
  );
  private readonly TIMEOUT_HOURS = parseInt(process.env.JOB_ENCODING_TIMEOUT_HOURS || '2', 10);
  // ADAPTIVE TIMEOUT: a flat 2h ceiling kills legitimately slow 4K/AV1 encodes
  // that were always going to take longer than that. Scale the ceiling up for
  // jobs with a known estimate, but never scale it DOWN below TIMEOUT_HOURS.
  // A bad/missing estimate must never make the timeout tighter than the flat
  // floor. estimatedDuration is a same-content-class historical average, not
  // a guarantee, so the multiplier is a generous buffer, not a tight bound.
  private readonly ADAPTIVE_TIMEOUT_MULTIPLIER = parseFloat(
    process.env.JOB_ENCODING_TIMEOUT_MULTIPLIER || '2.0'
  );

  constructor(private readonly jobRepository: JobRepository) {}

  /**
   * Run cleanup on application startup
   * Implements OnModuleInit to auto-run when module is initialized
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('Job cleanup service initialized');
    await this.cleanupStuckJobs();
  }

  /**
   * Reset stuck ENCODING jobs that were abandoned (e.g., from crashes)
   *
   * Finds all jobs with:
   * - stage = ENCODING
   * - updatedAt older than STUCK_THRESHOLD_MINUTES (default: 5 minutes)
   *
   * Resets them to:
   * - stage = QUEUED
   * - clears nodeId assignment
   * - resets progress to 0
   * - clears startedAt timestamp
   *
   * @returns Number of jobs reset
   */
  async cleanupStuckJobs(): Promise<number> {
    const thresholdDate = new Date();
    thresholdDate.setMinutes(thresholdDate.getMinutes() - this.STUCK_THRESHOLD_MINUTES);

    try {
      const stuckJobs = await this.jobRepository.findManySelect<{
        id: string;
        fileLabel: string;
        nodeId: string;
        updatedAt: Date;
        progress: number;
        retryCount: number;
      }>(
        {
          stage: JobStage.ENCODING,
          updatedAt: { lt: thresholdDate },
          // Skip jobs already claimed by QueueProcessingService's fencing token.
          // A non-null token means the other service is mid-reset - don't touch them.
          fencingToken: null,
        },
        {
          id: true,
          fileLabel: true,
          nodeId: true,
          updatedAt: true,
          progress: true,
          retryCount: true,
        }
      );

      if (stuckJobs.length === 0) {
        this.logger.log('No stuck jobs found during cleanup');
        return 0;
      }

      this.logger.warn(`Found ${stuckJobs.length} stuck ENCODING job(s) - resetting to QUEUED`);

      // Reset stuck jobs individually to capture progress at healing point
      let resetCount = 0;
      for (const job of stuckJobs) {
        try {
          const minutesStuck = Math.floor((Date.now() - job.updatedAt.getTime()) / 1000 / 60);

          await this.jobRepository.updateById(job.id, {
            stage: JobStage.QUEUED,
            progress: 0,
            startedAt: null,
            retryCount: job.retryCount + 1,
            totalAttempts: { increment: 1 },
            // AUTO-HEAL TRACKING: Record when job was auto-healed and its progress at healing point
            autoHealedAt: new Date(),
            autoHealedProgress: job.progress,
          });

          resetCount++;
          this.logger.debug(
            `Reset job ${job.id} (${job.fileLabel}) - stuck for ${minutesStuck} minutes on node ${job.nodeId}, was at ${(job.progress || 0).toFixed(1)}%`
          );
        } catch (error: unknown) {
          this.logger.error(`Failed to reset stuck job ${job.id} (${job.fileLabel})`, error);
        }
      }

      this.logger.log(`Successfully reset ${resetCount} stuck job(s) to QUEUED stage`);

      return resetCount;
    } catch (error: unknown) {
      this.logger.error('Failed to cleanup stuck jobs', error);
      throw error;
    }
  }

  /**
   * Compute the adaptive timeout (ms) for a job: the flat floor, or
   * ADAPTIVE_TIMEOUT_MULTIPLIER x the job's estimated encode duration,
   * whichever is larger. A missing/zero estimate falls back to the floor.
   */
  private getAdaptiveTimeoutMs(estimatedDurationSeconds: number | null): number {
    const floorMs = this.TIMEOUT_HOURS * 60 * 60 * 1000;
    if (!estimatedDurationSeconds || estimatedDurationSeconds <= 0) {
      return floorMs;
    }
    const scaledMs =
      estimatedDurationSeconds * 1000 * this.ADAPTIVE_TIMEOUT_MULTIPLIER;
    return Math.max(floorMs, scaledMs);
  }

  /**
   * Detect and mark jobs that have been encoding too long as FAILED
   *
   * Finds all jobs with:
   * - stage = ENCODING
   * - updatedAt older than the flat TIMEOUT_HOURS floor (default: 2 hours)
   *
   * Among those, a job with a known estimatedDuration only actually times
   * out once it has run past max(TIMEOUT_HOURS, multiplier x estimate) -
   * see getAdaptiveTimeoutMs(). This stops a legitimately slow 4K/AV1 encode
   * from being killed at the same flat line as everything else, while a
   * genuinely dead job with no estimate still times out at the flat floor.
   *
   * Marks them as:
   * - stage = FAILED
   * - error = "Encoding timeout - exceeded maximum duration"
   * - completedAt = current timestamp
   *
   * @returns Number of jobs marked as failed
   */
  async detectTimedOutJobs(): Promise<number> {
    const floorDate = new Date();
    floorDate.setHours(floorDate.getHours() - this.TIMEOUT_HOURS);

    try {
      const candidates = await this.jobRepository.findManySelect<{
        id: string;
        fileLabel: string;
        nodeId: string;
        updatedAt: Date;
        startedAt: Date | null;
        estimatedDuration: number | null;
      }>(
        {
          stage: JobStage.ENCODING,
          // DB-level pre-filter uses the flat floor - the adaptive ceiling
          // (which can only be larger) is applied per-job below.
          updatedAt: { lt: floorDate },
        },
        {
          id: true,
          fileLabel: true,
          nodeId: true,
          updatedAt: true,
          startedAt: true,
          estimatedDuration: true,
        }
      );

      const now = Date.now();
      const timedOutJobs = candidates.filter(
        (job) => now - job.updatedAt.getTime() >= this.getAdaptiveTimeoutMs(job.estimatedDuration)
      );

      if (timedOutJobs.length === 0) {
        this.logger.debug('No timed-out jobs found');
        return 0;
      }

      this.logger.warn(
        `Found ${timedOutJobs.length} timed-out ENCODING job(s) - marking as FAILED`
      );

      let failedCount = 0;

      // Process each job individually to log details
      for (const job of timedOutJobs) {
        const hoursEncoding = Math.floor((Date.now() - job.updatedAt.getTime()) / 1000 / 60 / 60);
        const effectiveTimeoutHours = (
          this.getAdaptiveTimeoutMs(job.estimatedDuration) /
          (60 * 60 * 1000)
        ).toFixed(1);

        try {
          await this.jobRepository.updateById(job.id, {
            stage: JobStage.FAILED,
            completedAt: new Date(),
            error: `Encoding timeout - exceeded maximum duration of ${effectiveTimeoutHours} hours (was encoding for ${hoursEncoding} hours)`,
          });

          failedCount++;

          this.logger.warn(
            `Marked job ${job.id} (${job.fileLabel}) as FAILED - encoding for ${hoursEncoding} hours (limit ${effectiveTimeoutHours}h) on node ${job.nodeId}`
          );
        } catch (error: unknown) {
          this.logger.error(`Failed to mark job ${job.id} as timed out`, error);
        }
      }

      this.logger.log(`Successfully marked ${failedCount} timed-out job(s) as FAILED`);

      return failedCount;
    } catch (error: unknown) {
      this.logger.error('Failed to detect timed-out jobs', error);
      throw error;
    }
  }

  /**
   * Scheduled cron job to check for timed-out jobs every 10 minutes
   * Runs at: 00:00, 00:10, 00:20, ..., 23:50
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleTimedOutJobsCron(): Promise<void> {
    this.logger.debug('Running scheduled timeout check');
    await this.detectTimedOutJobs();
  }
}
