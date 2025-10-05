import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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

  constructor(private prisma: PrismaService) {}

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
      const stuckJobs = await this.prisma.job.findMany({
        where: {
          stage: JobStage.ENCODING,
          updatedAt: {
            lt: thresholdDate,
          },
        },
        select: {
          id: true,
          fileLabel: true,
          nodeId: true,
          updatedAt: true,
        },
      });

      if (stuckJobs.length === 0) {
        this.logger.log('No stuck jobs found during cleanup');
        return 0;
      }

      this.logger.warn(`Found ${stuckJobs.length} stuck ENCODING job(s) - resetting to QUEUED`);

      // Reset all stuck jobs in a single transaction
      const result = await this.prisma.job.updateMany({
        where: {
          id: {
            in: stuckJobs.map((job) => job.id),
          },
        },
        data: {
          stage: JobStage.QUEUED,
          progress: 0,
          startedAt: null,
        },
      });

      this.logger.log(`Successfully reset ${result.count} stuck job(s) to QUEUED stage`);

      // Log details for each reset job
      for (const job of stuckJobs) {
        const minutesStuck = Math.floor(
          (new Date().getTime() - job.updatedAt.getTime()) / 1000 / 60
        );
        this.logger.debug(
          `Reset job ${job.id} (${job.fileLabel}) - stuck for ${minutesStuck} minutes on node ${job.nodeId}`
        );
      }

      return result.count;
    } catch (error) {
      this.logger.error('Failed to cleanup stuck jobs', error);
      throw error;
    }
  }

  /**
   * Detect and mark jobs that have been encoding too long as FAILED
   *
   * Finds all jobs with:
   * - stage = ENCODING
   * - updatedAt older than TIMEOUT_HOURS (default: 2 hours)
   *
   * Marks them as:
   * - stage = FAILED
   * - error = "Encoding timeout - exceeded maximum duration"
   * - completedAt = current timestamp
   *
   * @returns Number of jobs marked as failed
   */
  async detectTimedOutJobs(): Promise<number> {
    const timeoutDate = new Date();
    timeoutDate.setHours(timeoutDate.getHours() - this.TIMEOUT_HOURS);

    try {
      const timedOutJobs = await this.prisma.job.findMany({
        where: {
          stage: JobStage.ENCODING,
          updatedAt: {
            lt: timeoutDate,
          },
        },
        select: {
          id: true,
          fileLabel: true,
          nodeId: true,
          updatedAt: true,
          startedAt: true,
        },
      });

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
        const hoursEncoding = Math.floor(
          (new Date().getTime() - job.updatedAt.getTime()) / 1000 / 60 / 60
        );

        try {
          await this.prisma.job.update({
            where: { id: job.id },
            data: {
              stage: JobStage.FAILED,
              completedAt: new Date(),
              error: `Encoding timeout - exceeded maximum duration of ${this.TIMEOUT_HOURS} hours (was encoding for ${hoursEncoding} hours)`,
            },
          });

          failedCount++;

          this.logger.warn(
            `Marked job ${job.id} (${job.fileLabel}) as FAILED - encoding for ${hoursEncoding} hours on node ${job.nodeId}`
          );
        } catch (error) {
          this.logger.error(`Failed to mark job ${job.id} as timed out`, error);
        }
      }

      this.logger.log(`Successfully marked ${failedCount} timed-out job(s) as FAILED`);

      return failedCount;
    } catch (error) {
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
