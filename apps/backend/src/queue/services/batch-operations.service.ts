import { Injectable, Logger } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';

/**
 * Batch Operation Result
 */
export interface BatchOperationResult {
  success: boolean;
  affectedCount: number;
  errors: string[];
  details?: Record<string, unknown>;
}

/**
 * BatchOperationsService
 *
 * Provides bulk operations for queue management.
 *
 * Features:
 * - Pause/Resume all jobs
 * - Bulk cancel jobs by filter
 * - Bulk retry failed jobs
 * - Bulk delete completed/failed jobs
 * - Clear entire queue (with safety checks)
 */
@Injectable()
export class BatchOperationsService {
  private readonly logger = new Logger(BatchOperationsService.name);

  constructor(private readonly jobRepository: JobRepository) {}

  /**
   * Pause all queued and encoding jobs
   *
   * CRITICAL #5 FIX: Two-phase pause to handle QUEUED→ENCODING race condition
   * Phase 1: Mark jobs with pauseRequestedAt timestamp
   * Phase 2: Workers check pauseRequestedAt before starting new encoding
   *
   * @param nodeId - Optional: Only pause jobs for specific node
   * @returns Operation result
   */
  async pauseAll(nodeId?: string): Promise<BatchOperationResult> {
    this.logger.log(`Pausing all jobs${nodeId ? ` for node ${nodeId}` : ''}...`);

    try {
      const now = new Date();
      const where: Record<string, unknown> = {
        stage: { in: [JobStage.QUEUED, JobStage.ENCODING] },
      };

      if (nodeId) {
        where.nodeId = nodeId;
      }

      // CRITICAL #3 FIX: Two-phase pause to prevent QUEUED→ENCODING race
      // Phase 1: Mark all jobs with pause request timestamp
      await this.jobRepository.atomicUpdateMany(where, { pauseRequestedAt: now });

      // Phase 2: Only transition jobs still in QUEUED stage
      // Workers check pauseRequestedAt before starting encoding
      const result = await this.jobRepository.atomicUpdateMany(
        {
          ...where,
          pauseRequestedAt: now, // Only jobs we just marked
          stage: { in: [JobStage.QUEUED] }, // Don't forcibly stop ENCODING
        },
        {
          stage: JobStage.PAUSED,
          error: 'Batch paused by user',
        }
      );

      this.logger.log(
        `✅ Paused ${result.count} job(s) (workers will stop ENCODING jobs at next checkpoint)`
      );

      return {
        success: true,
        affectedCount: result.count,
        errors: [],
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to pause jobs: ${errorMsg}`);
      return {
        success: false,
        affectedCount: 0,
        errors: [errorMsg],
      };
    }
  }

  /**
   * Resume all paused jobs
   *
   * @param nodeId - Optional: Only resume jobs for specific node
   * @returns Operation result
   */
  async resumeAll(nodeId?: string): Promise<BatchOperationResult> {
    this.logger.log(`Resuming all paused jobs${nodeId ? ` for node ${nodeId}` : ''}...`);

    try {
      const where: Record<string, unknown> = {
        stage: {
          in: [JobStage.PAUSED, 'PAUSED_LOAD'],
        },
      };

      if (nodeId) {
        where.nodeId = nodeId;
      }

      const result = await this.jobRepository.atomicUpdateMany(where, {
        stage: JobStage.QUEUED,
        error: 'Batch resumed by user',
      });

      this.logger.log(`✅ Resumed ${result.count} job(s)`);

      return {
        success: true,
        affectedCount: result.count,
        errors: [],
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to resume jobs: ${errorMsg}`);
      return {
        success: false,
        affectedCount: 0,
        errors: [errorMsg],
      };
    }
  }

  /**
   * Cancel all active jobs (queued, encoding, paused)
   *
   * CRITICAL #5 FIX: Include ENCODING jobs with cancelRequestedAt flag
   * Workers check this flag at progress checkpoints to gracefully stop
   *
   * @param nodeId - Optional: Only cancel jobs for specific node
   * @returns Operation result
   */
  async cancelAll(nodeId?: string): Promise<BatchOperationResult> {
    this.logger.log(`Cancelling all active jobs${nodeId ? ` for node ${nodeId}` : ''}...`);

    try {
      const now = new Date();
      const where: Record<string, unknown> = {
        stage: {
          in: [
            JobStage.QUEUED,
            JobStage.ENCODING, // CRITICAL #5 FIX: Include ENCODING for graceful stop
            JobStage.PAUSED,
            'PAUSED_LOAD',
            JobStage.HEALTH_CHECK,
          ],
        },
      };

      if (nodeId) {
        where.nodeId = nodeId;
      }

      const result = await this.jobRepository.atomicUpdateMany(where, {
        stage: JobStage.CANCELLED,
        cancelRequestedAt: now, // CRITICAL #5 FIX: Workers check this flag
        error: 'Batch cancelled by user',
        completedAt: now,
      });

      this.logger.log(`✅ Cancelled ${result.count} job(s)`);

      return {
        success: true,
        affectedCount: result.count,
        errors: [],
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to cancel jobs: ${errorMsg}`);
      return {
        success: false,
        affectedCount: 0,
        errors: [errorMsg],
      };
    }
  }

  /**
   * Retry all failed jobs
   *
   * @param nodeId - Optional: Only retry jobs for specific node
   * @param maxRetries - Maximum retry count threshold (only retry jobs with fewer retries)
   * @returns Operation result
   */
  async retryAllFailed(nodeId?: string, maxRetries = 3): Promise<BatchOperationResult> {
    this.logger.log(`Retrying all failed jobs${nodeId ? ` for node ${nodeId}` : ''}...`);

    try {
      const where: Record<string, unknown> = {
        stage: JobStage.FAILED,
        retryCount: {
          lt: maxRetries,
        },
      };

      if (nodeId) {
        where.nodeId = nodeId;
      }

      const result = await this.jobRepository.atomicUpdateMany(where, {
        stage: JobStage.QUEUED,
        progress: 0,
        error: 'Batch retry requested by user',
        startedAt: null,
        completedAt: null,
      });

      this.logger.log(`✅ Queued ${result.count} failed job(s) for retry`);

      return {
        success: true,
        affectedCount: result.count,
        errors: [],
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to retry jobs: ${errorMsg}`);
      return {
        success: false,
        affectedCount: 0,
        errors: [errorMsg],
      };
    }
  }

  /**
   * Delete completed jobs older than specified days
   *
   * @param olderThanDays - Delete jobs completed more than this many days ago
   * @param nodeId - Optional: Only delete jobs for specific node
   * @returns Operation result
   */
  async deleteCompletedOlderThan(
    olderThanDays: number,
    nodeId?: string
  ): Promise<BatchOperationResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    this.logger.log(
      `Deleting completed jobs older than ${olderThanDays} days${nodeId ? ` for node ${nodeId}` : ''}...`
    );

    try {
      const where: Record<string, unknown> = {
        stage: JobStage.COMPLETED,
        completedAt: {
          lt: cutoffDate,
        },
      };

      if (nodeId) {
        where.nodeId = nodeId;
      }

      const result = await this.jobRepository.deleteManyWhere(where);

      this.logger.log(`✅ Deleted ${result.count} old completed job(s)`);

      return {
        success: true,
        affectedCount: result.count,
        errors: [],
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to delete jobs: ${errorMsg}`);
      return {
        success: false,
        affectedCount: 0,
        errors: [errorMsg],
      };
    }
  }

  /**
   * Delete all failed jobs
   *
   * @param nodeId - Optional: Only delete jobs for specific node
   * @returns Operation result
   */
  async deleteAllFailed(nodeId?: string): Promise<BatchOperationResult> {
    this.logger.log(`Deleting all failed jobs${nodeId ? ` for node ${nodeId}` : ''}...`);

    try {
      const where: Record<string, unknown> = {
        stage: JobStage.FAILED,
      };

      if (nodeId) {
        where.nodeId = nodeId;
      }

      const result = await this.jobRepository.deleteManyWhere(where);

      this.logger.log(`✅ Deleted ${result.count} failed job(s)`);

      return {
        success: true,
        affectedCount: result.count,
        errors: [],
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to delete jobs: ${errorMsg}`);
      return {
        success: false,
        affectedCount: 0,
        errors: [errorMsg],
      };
    }
  }

  /**
   * Get batch operation statistics
   *
   * @param nodeId - Optional: Only count jobs for specific node
   * @returns Job counts by stage
   */
  async getStats(nodeId?: string): Promise<Record<string, number>> {
    const where: Record<string, unknown> = {};

    if (nodeId) {
      where.nodeId = nodeId;
    }

    const stages = Object.values(JobStage);
    const counts: Record<string, number> = {};

    for (const stage of stages) {
      counts[stage] = await this.jobRepository.countWhere({ ...where, stage });
    }

    // Add PAUSED_LOAD count (it's a string not enum)
    counts.PAUSED_LOAD = await this.jobRepository.countWhere({
      ...where,
      stage: 'PAUSED_LOAD' as JobStage,
    });

    counts.TOTAL = await this.jobRepository.countWhere(where);

    return counts;
  }

  /**
   * Clear entire queue (dangerous - requires confirmation token)
   *
   * @param confirmationToken - Must be "CLEAR_ALL_JOBS" to proceed
   * @returns Operation result
   */
  async clearAll(confirmationToken: string): Promise<BatchOperationResult> {
    if (confirmationToken !== 'CLEAR_ALL_JOBS') {
      return {
        success: false,
        affectedCount: 0,
        errors: ['Invalid confirmation token. Use "CLEAR_ALL_JOBS" to confirm.'],
      };
    }

    this.logger.warn('⚠️ CLEARING ALL JOBS - This action is irreversible!');

    try {
      const result = await this.jobRepository.deleteManyWhere({});

      this.logger.log(`✅ Cleared ${result.count} job(s) from queue`);

      return {
        success: true,
        affectedCount: result.count,
        errors: [],
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to clear queue: ${errorMsg}`);
      return {
        success: false,
        affectedCount: 0,
        errors: [errorMsg],
      };
    }
  }
}
