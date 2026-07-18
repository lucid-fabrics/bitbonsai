import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FileHealthStatus, type Job, JobEventType, JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { FileFailureTrackingService } from './file-failure-tracking.service';
import { JobHistoryService } from './job-history.service';

/**
 * JobQueueManipulationService
 *
 * Handles manual queue manipulation: retry, force-start, and health recheck.
 */
@Injectable()
export class JobQueueManipulationService {
  private readonly logger = new Logger(JobQueueManipulationService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly jobHistoryService: JobHistoryService,
    private readonly fileFailureTracking: FileFailureTrackingService
  ) {}

  /**
   * Retry a failed or cancelled job
   */
  async retryJob(id: string): Promise<Job> {
    this.logger.log(`Retrying job: ${id}`);

    const existingJob = await this.jobRepository.findById(id);

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.FAILED && existingJob.stage !== JobStage.CANCELLED) {
      throw new BadRequestException('Only failed or cancelled jobs can be retried');
    }

    const historyMessage = `Manual retry: restarting encoding from 0% (was at ${(existingJob.progress || 0).toFixed(1)}%)`;
    this.logger.log(
      `Retrying job: ${existingJob.fileLabel} (retry ${existingJob.retryCount + 1}, restarting from 0%)`
    );

    const job = await this.jobRepository.updateById(id, {
      stage: JobStage.QUEUED,
      progress: 0,
      error: null,
      completedAt: null,
      startedAt: null,
      failedAt: null,
      retryCount: existingJob.retryCount + 1,
      nextRetryAt: null,
      resumeTimestamp: null,
      tempFilePath: null,
      // Reset retry caps on manual retry so the job gets fresh attempts
      corruptedRequeueCount: 0,
      stuckRecoveryCount: 0,
      // An explicit user retry is a fresh start: clear the circuit breaker
      // and DLQ state, otherwise the retried job insta-fails on its next
      // error (checkAndBreak short-circuits circuitBroken jobs).
      circuitBroken: false,
      circuitBrokenAt: null,
      circuitBrokenReason: null,
      dlqEnteredAt: null,
      totalAttempts: 0,
    });

    // Also clear the cross-job per-file blacklist: a file auto-blacklisted by
    // 5 FAILED jobs has no other UI path to clear it (unblacklist requires a
    // CANCELLED job), which permanently blocked it from re-queue.
    try {
      await this.fileFailureTracking.clearBlacklist(existingJob.filePath, existingJob.libraryId);
    } catch (blacklistError: unknown) {
      this.logger.warn(
        `Failed to clear file blacklist for ${existingJob.filePath}`,
        blacklistError
      );
    }

    await this.jobHistoryService.recordEvent({
      jobId: id,
      eventType: JobEventType.RESTARTED,
      stage: JobStage.QUEUED,
      progress: existingJob.progress || 0,
      triggeredBy: 'USER',
      systemMessage: historyMessage,
      tempFileExists: false,
      retryNumber: existingJob.retryCount + 1,
    });

    this.logger.log(`Job retried: ${id}`);
    return job;
  }

  /**
   * Force start a queued job immediately
   */
  async forceStartJob(id: string): Promise<Job> {
    this.logger.log(`Force starting job: ${id}`);

    const existingJob = await this.jobRepository.findById(id);

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.QUEUED && existingJob.stage !== JobStage.DETECTED) {
      throw new BadRequestException(
        `Only queued or detected jobs can be force-started (current stage: ${existingJob.stage})`
      );
    }

    const job = await this.jobRepository.updateById(id, {
      stage: JobStage.DETECTED,
      createdAt: new Date(0),
    });

    this.logger.log(
      `Job force-started: ${id} - moved to DETECTED stage (will be picked up immediately)`
    );
    return job;
  }

  /**
   * Force recheck health status for a job
   */
  async recheckHealth(id: string): Promise<Job> {
    this.logger.log(`Rechecking health for job: ${id}`);

    const existingJob = await this.jobRepository.findById(id);

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    const job = await this.jobRepository.updateById(id, {
      stage: JobStage.DETECTED,
      healthStatus: FileHealthStatus.UNKNOWN,
      healthScore: 0,
      healthMessage: null,
      healthCheckedAt: null,
      healthCheckStartedAt: null,
      healthCheckRetries: 0,
      decisionRequired: false,
      decisionIssues: null,
      decisionMadeAt: null,
      decisionData: null,
      error: null,
    });

    this.logger.log(
      `Job health check cleared: ${id} - reset to DETECTED stage (will be rechecked immediately)`
    );
    return job;
  }
}
