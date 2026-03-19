import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FileHealthStatus, type Job, JobEventType, JobStage } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { JobRepository } from '../../common/repositories/job.repository';
import { NodeConfigService } from '../../core/services/node-config.service';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { CompleteJobDto } from '../dto/complete-job.dto';
import { FileFailureTrackingService } from './file-failure-tracking.service';
import { FileTransferService } from './file-transfer.service';
import { JobBulkOperationsService } from './job-bulk-operations.service';
import { JobFileOperationsService } from './job-file-operations.service';
import { JobHistoryService } from './job-history.service';
import { JobMetricsService } from './job-metrics.service';
import { QueueJobCrudService } from './queue-job-crud.service';

/**
 * QueueJobStateService
 *
 * Handles single-job state transitions: pause, resume, cancel, retry, complete, fail,
 * priority management, and decision resolution.
 * Delegates bulk operations to JobBulkOperationsService,
 * file operations to JobFileOperationsService,
 * and metrics to JobMetricsService.
 */
@Injectable()
export class QueueJobStateService {
  private readonly logger = new Logger(QueueJobStateService.name);

  constructor(
    private prisma: PrismaService,
    private jobRepository: JobRepository,
    @Inject(forwardRef(() => FfmpegService))
    private ffmpegService: FfmpegService,
    private jobHistoryService: JobHistoryService,
    private fileTransferService: FileTransferService,
    private nodeConfig: NodeConfigService,
    private httpService: HttpService,
    private jobCrudService: QueueJobCrudService,
    private fileFailureTracking: FileFailureTrackingService,
    private readonly jobMetricsService: JobMetricsService,
    private readonly jobBulkOperationsService: JobBulkOperationsService,
    private readonly jobFileOperationsService: JobFileOperationsService
  ) {}

  /**
   * Complete a job successfully
   */
  async completeJob(id: string, completeJobDto: CompleteJobDto): Promise<Job> {
    this.logger.log(`Completing job: ${id}`);

    await this.jobCrudService.validateJobOwnership(id, 'complete');

    const mainApiUrl = this.nodeConfig.getMainApiUrl();
    if (mainApiUrl) {
      const url = `${mainApiUrl}/api/v1/queue/${id}/complete`;
      this.logger.debug(`🔍 MULTI-NODE: LINKED node proxying job completion to MAIN: ${url}`);

      try {
        const response = await firstValueFrom(
          this.httpService.post(url, completeJobDto, { timeout: 30000 })
        );
        this.logger.debug(`✅ MULTI-NODE: Job completion successful for ${id}`);
        return response.data;
      } catch (error: unknown) {
        this.logger.error(`❌ MULTI-NODE: Failed to proxy job completion to MAIN:`, error);
        throw error;
      }
    }

    let job: Job;

    try {
      // PrismaService retained for atomic $transaction — not replaceable with repository
      job = await this.prisma.$transaction(async (tx) => {
        const existingJob = await tx.job.findUnique({
          where: { id },
          select: { stage: true },
        });

        if (!existingJob) {
          throw new NotFoundException(`Job with ID "${id}" not found`);
        }

        if (existingJob.stage === JobStage.COMPLETED) {
          this.logger.warn(`Job ${id} already completed - skipping to prevent double metrics`);
          return tx.job.findUnique({
            where: { id },
            include: { node: { include: { license: true } } },
          }) as Promise<Job & { node: { licenseId: string } }>;
        }

        const completedJob = await tx.job.update({
          where: { id },
          data: {
            stage: JobStage.COMPLETED,
            progress: 100,
            afterSizeBytes: BigInt(completeJobDto.afterSizeBytes),
            savedBytes: BigInt(completeJobDto.savedBytes),
            savedPercent: completeJobDto.savedPercent,
            completedAt: new Date(),
            priority: 0,
            prioritySetAt: null,
          },
          include: {
            node: {
              include: {
                license: true,
              },
            },
          },
        });

        await this.jobMetricsService.updateMetrics(completedJob, tx);

        // Record processed file fingerprint for rename detection
        if (completedJob.contentFingerprint) {
          await tx.processedFileRecord.upsert({
            where: { contentFingerprint: completedJob.contentFingerprint },
            create: {
              contentFingerprint: completedJob.contentFingerprint,
              filePath: completedJob.filePath,
              libraryId: completedJob.libraryId,
              completedAt: new Date(),
              resultCodec: completedJob.targetCodec,
              savedPercent: completeJobDto.savedPercent,
            },
            update: {
              filePath: completedJob.filePath,
              completedAt: new Date(),
              resultCodec: completedJob.targetCodec,
              savedPercent: completeJobDto.savedPercent,
            },
          });
        }

        return completedJob;
      });
    } catch (txError: unknown) {
      this.logger.error(`Transaction failed for job ${id}:`, txError);
      const errorMessage = txError instanceof Error ? txError.message : String(txError);
      throw new Error(`Failed to mark job as completed: ${errorMessage}`);
    }

    this.logger.log(`Job completed: ${id} (saved ${completeJobDto.savedPercent}%)`);
    return job;
  }

  /**
   * Mark a job as failed
   */
  async failJob(id: string, error: string): Promise<Job> {
    this.logger.log(`Failing job: ${id}`);

    await this.jobCrudService.validateJobOwnership(id, 'fail');

    const mainApiUrl = this.nodeConfig.getMainApiUrl();
    if (mainApiUrl) {
      const url = `${mainApiUrl}/api/v1/queue/${id}/fail`;
      this.logger.debug(`🔍 MULTI-NODE: LINKED node proxying job failure to MAIN: ${url}`);

      try {
        const response = await firstValueFrom(
          this.httpService.post(url, { error }, { timeout: 30000 })
        );
        this.logger.debug(`✅ MULTI-NODE: Job failure recorded for ${id}`);
        return response.data;
      } catch (err: unknown) {
        this.logger.error(`❌ MULTI-NODE: Failed to proxy job failure to MAIN:`, err);
        throw err;
      }
    }

    const existingJob = await this.jobRepository.findById(id);

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage === JobStage.FAILED) {
      this.logger.warn(`Job ${id} is already FAILED - skipping duplicate failure event`);
      return existingJob;
    }

    const job = await this.jobRepository.updateById(id, {
      stage: JobStage.FAILED,
      completedAt: new Date(),
      failedAt: new Date(),
      error,
    });

    await this.jobHistoryService.recordEvent({
      jobId: id,
      eventType: JobEventType.FAILED,
      stage: existingJob.stage,
      progress: existingJob.progress,
      errorMessage: error,
      fps: existingJob.fps ?? undefined,
      etaSeconds: existingJob.etaSeconds ?? undefined,
      retryNumber: existingJob.retryCount,
      triggeredBy: 'SYSTEM',
    });

    // Cross-job failure tracking: record failure for auto-blacklist detection
    try {
      const wasBlacklisted = await this.fileFailureTracking.recordFailure(
        existingJob.filePath,
        existingJob.libraryId,
        error,
        existingJob.contentFingerprint ?? undefined
      );

      if (wasBlacklisted) {
        this.logger.warn(`File auto-blacklisted after repeated failures: ${existingJob.fileLabel}`);
      }
    } catch (trackingError: unknown) {
      // Non-critical: don't let tracking failure break the main flow
      this.logger.error(
        'Failed to record file failure tracking',
        trackingError instanceof Error ? trackingError.stack : String(trackingError)
      );
    }

    this.logger.log(`Job failed: ${id} (${error})`);
    return job;
  }

  /**
   * Cancel a job
   */
  async cancelJob(id: string, blacklist = false): Promise<Job> {
    this.logger.log(`Cancelling job: ${id} (blacklist: ${blacklist})`);

    const mainApiUrl = this.nodeConfig.getMainApiUrl();
    if (mainApiUrl) {
      const url = `${mainApiUrl}/api/v1/queue/${id}/cancel`;
      this.logger.debug(`🔍 MULTI-NODE: LINKED node proxying job cancellation to MAIN: ${url}`);

      try {
        const response = await firstValueFrom(
          this.httpService.post(url, { blacklist }, { timeout: 30000 })
        );
        this.logger.debug(`✅ MULTI-NODE: Job cancellation successful for ${id}`);
        return response.data;
      } catch (error: unknown) {
        this.logger.error(`❌ MULTI-NODE: Failed to proxy job cancellation to MAIN:`, error);
        throw error;
      }
    }

    const existingJob = await this.jobRepository.findById(id);

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage === JobStage.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed job');
    }

    if (existingJob.stage === JobStage.ENCODING) {
      this.logger.log(`Job ${id} is encoding - killing FFmpeg process`);
      try {
        const killed = await this.ffmpegService.killProcess(id);
        if (killed) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          this.logger.log(`Successfully killed FFmpeg process for job ${id}`);
        } else {
          this.logger.warn(`FFmpeg process not found for job ${id}`);
        }
      } catch (error: unknown) {
        this.logger.warn(`Failed to kill FFmpeg for job ${id}: ${error}`);
      }
    }

    if (existingJob.stage === 'TRANSFERRING') {
      this.logger.log(`Job ${id} is transferring - cancelling transfer`);
      try {
        await this.fileTransferService.cancelTransfer(id);
        this.logger.log(`Successfully cancelled transfer for job ${id}`);
      } catch (error: unknown) {
        this.logger.warn(`Failed to cancel transfer for job ${id}: ${error}`);
      }

      if (existingJob.remoteTempPath) {
        try {
          await this.fileTransferService.cleanupRemoteTempFile(id);
          this.logger.log(`Cleaned up remote temp file for job ${id}`);
        } catch (error: unknown) {
          this.logger.warn(`Failed to cleanup remote temp file for job ${id}: ${error}`);
        }
      }
    }

    const job = await this.jobRepository.updateById(id, {
      stage: JobStage.CANCELLED,
      completedAt: new Date(),
      isBlacklisted: blacklist,
    });

    await this.jobHistoryService.recordEvent({
      jobId: id,
      eventType: JobEventType.CANCELLED,
      stage: existingJob.stage,
      progress: existingJob.progress,
      fps: existingJob.fps ?? undefined,
      etaSeconds: existingJob.etaSeconds ?? undefined,
      triggeredBy: 'USER',
    });

    this.logger.log(`Job cancelled: ${id} (blacklisted: ${blacklist})`);
    return job;
  }

  /**
   * Unblacklist a job to allow retry
   */
  async unblacklistJob(id: string): Promise<Job> {
    this.logger.log(`Unblacklisting job: ${id}`);

    const existingJob = await this.jobRepository.findById(id);

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.CANCELLED) {
      throw new BadRequestException('Only cancelled jobs can be unblacklisted');
    }

    if (!existingJob.isBlacklisted) {
      throw new BadRequestException('Job is not blacklisted');
    }

    const job = await this.jobRepository.updateById(id, {
      isBlacklisted: false,
      // Reset retry caps so the job can actually be retried
      corruptedRequeueCount: 0,
      stuckRecoveryCount: 0,
    });

    // Clear cross-job failure tracking so the file can be retried fresh
    try {
      await this.fileFailureTracking.clearBlacklist(existingJob.filePath, existingJob.libraryId);
    } catch (trackingError: unknown) {
      this.logger.error('Failed to clear file failure tracking', trackingError);
    }

    // Clear ProcessedFileRecord so re-encoding is possible
    // PrismaService retained for atomic $transaction — not replaceable with repository
    try {
      if (existingJob.contentFingerprint) {
        await this.prisma.processedFileRecord.deleteMany({
          where: { contentFingerprint: existingJob.contentFingerprint },
        });
      }
    } catch (recordError: unknown) {
      this.logger.error('Failed to clear processed file record', recordError);
    }

    this.logger.log(`Job unblacklisted: ${id}`);
    return job;
  }

  /**
   * Pause an encoding job
   */
  async pauseJob(id: string): Promise<Job> {
    this.logger.log(`Pausing job: ${id}`);

    const existingJob = await this.jobRepository.findById(id);

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.ENCODING) {
      throw new BadRequestException('Only encoding jobs can be paused');
    }

    const paused = await this.ffmpegService.pauseEncoding(id);
    if (!paused) {
      throw new BadRequestException('Failed to pause encoding process');
    }

    const job = await this.jobRepository.updateById(id, {
      stage: JobStage.PAUSED,
    });

    this.logger.log(`Job paused: ${id}`);
    return job;
  }

  /**
   * Resume a paused job
   */
  async resumeJob(id: string): Promise<Job> {
    this.logger.log(`Resuming job: ${id}`);

    const existingJob = await this.jobRepository.findById(id);

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.PAUSED) {
      throw new BadRequestException('Only paused jobs can be resumed');
    }

    const resumed = await this.ffmpegService.resumeEncoding(id);

    if (!resumed) {
      this.logger.warn(
        `FFmpeg process not found for job ${id} - resetting to QUEUED to restart encoding`
      );

      const job = await this.jobRepository.updateById(id, {
        stage: JobStage.QUEUED,
        progress: 0,
        etaSeconds: null,
        startedAt: null,
        error: 'Restarted from paused state (process was lost)',
      });

      this.logger.log(`Job reset to QUEUED: ${id}`);
      return job;
    }

    const job = await this.jobRepository.updateById(id, {
      stage: JobStage.ENCODING,
    });

    this.logger.log(`Job resumed: ${id}`);
    return job;
  }

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

    const { existsSync } = await import('fs');
    const hasTempFile = existingJob.tempFilePath && existsSync(existingJob.tempFilePath);
    const canResume = hasTempFile && existingJob.resumeTimestamp;

    let historyMessage: string;

    if (canResume) {
      const retryMessage = `will resume from ${(existingJob.progress || 0).toFixed(1)}%`;
      historyMessage = `Manual retry: Will resume encoding from ${(existingJob.progress || 0).toFixed(1)}% (temp file preserved)`;
      this.logger.log(
        `✅ Retrying job: ${existingJob.fileLabel} (retry ${existingJob.retryCount + 1}, ${retryMessage})`
      );
    } else {
      const reason = existingJob.tempFilePath ? 'temp file deleted' : 'no temp file';
      const retryMessage = `starting fresh (${reason})`;
      historyMessage = `Manual retry: Temp file not available, starting encoding from scratch (was at ${(existingJob.progress || 0).toFixed(1)}%)`;
      this.logger.log(
        `⚠️  Retrying job: ${existingJob.fileLabel} (retry ${existingJob.retryCount + 1}, ${retryMessage})`
      );
    }

    const job = await this.jobRepository.updateById(id, {
      stage: JobStage.QUEUED,
      progress: canResume ? existingJob.progress : 0,
      error: null,
      completedAt: null,
      startedAt: null,
      retryCount: existingJob.retryCount + 1,
      resumeTimestamp: canResume ? existingJob.resumeTimestamp : null,
      tempFilePath: canResume ? existingJob.tempFilePath : null,
      // Reset retry caps on manual retry so the job gets fresh attempts
      corruptedRequeueCount: 0,
      stuckRecoveryCount: 0,
    });

    await this.jobHistoryService.recordEvent({
      jobId: id,
      eventType: JobEventType.RESTARTED,
      stage: JobStage.QUEUED,
      progress: existingJob.progress || 0,
      triggeredBy: 'USER',
      systemMessage: historyMessage,
      tempFileExists: !!hasTempFile,
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

  /**
   * Update job priority
   */
  async updateJobPriority(id: string, priority: number): Promise<Job> {
    this.logger.log(`Updating priority for job ${id} to ${priority}`);

    const existingJob = await this.jobRepository.findById(id);

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (priority < 0 || priority > 2) {
      throw new BadRequestException('Priority must be between 0 and 2');
    }

    if (priority === 2) {
      const topPriorityCount = await this.jobRepository.countWhere({
        priority: 2,
        stage: {
          in: [JobStage.DETECTED, JobStage.HEALTH_CHECK, JobStage.QUEUED, JobStage.ENCODING],
        },
        id: { not: id },
      });

      if (topPriorityCount >= 3) {
        throw new BadRequestException(
          'Maximum 3 jobs can have top priority at once. Please lower priority of another job first.'
        );
      }
    }

    const job = await this.jobRepository.updateById(id, {
      priority,
      prioritySetAt: new Date(),
    });

    if (existingJob.stage === JobStage.ENCODING) {
      try {
        await this.ffmpegService.reniceProcess(id, priority);
        this.logger.log(`Reniced FFmpeg process for job ${id} to priority ${priority}`);
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to renice FFmpeg process for job ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    this.logger.log(`Job ${id} priority updated to ${priority}`);
    return job;
  }

  /**
   * Resolve a user decision for a job in NEEDS_DECISION stage
   */
  async resolveDecision(id: string, decisionData?: Record<string, unknown>): Promise<Job> {
    this.logger.log(`Resolving decision for job: ${id}`);

    const existingJob = await this.jobRepository.findById(id);

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.NEEDS_DECISION) {
      throw new BadRequestException(
        `Can only resolve decisions for jobs in NEEDS_DECISION stage (current stage: ${existingJob.stage})`
      );
    }

    if (decisionData?.actionConfig) {
      const config = decisionData.actionConfig as Record<string, unknown>;

      if (config.action === 'skip') {
        const job = await this.jobRepository.updateById(id, {
          stage: JobStage.COMPLETED,
          decisionRequired: false,
          decisionIssues: null,
          decisionMadeAt: new Date(),
          decisionData: JSON.stringify(decisionData),
          completedAt: new Date(),
          afterSizeBytes: existingJob.beforeSizeBytes,
          progress: 100,
          healthMessage: '✅ Skipped - file already in target codec',
        });
        this.logger.log(`Decision resolved for job ${id} - SKIPPED (codec already matches target)`);
        return job;
      }

      if (config.action === 'cancel') {
        const job = await this.jobRepository.updateById(id, {
          stage: JobStage.CANCELLED,
          decisionRequired: false,
          decisionIssues: null,
          decisionMadeAt: new Date(),
          decisionData: JSON.stringify(decisionData),
        });
        this.logger.log(
          `Decision resolved for job ${id} - CANCELLED by user (reason: ${config.reason || 'user_requested'})`
        );
        return job;
      }
    }

    const updateData: Record<string, unknown> = {
      stage: JobStage.QUEUED,
      decisionRequired: false,
      decisionIssues: null,
      decisionMadeAt: new Date(),
      decisionData: decisionData ? JSON.stringify(decisionData) : null,
    };

    if (decisionData?.actionConfig) {
      const config = decisionData.actionConfig as Record<string, unknown>;

      if (config.targetContainer) {
        updateData.targetContainer = config.targetContainer;
        this.logger.log(`Applying target container: ${config.targetContainer}`);
      }

      if (config.audioAction === 'copy') {
        updateData.type = 'REMUX';
        this.logger.log(`Setting job type to REMUX (audio copy)`);
      } else if (config.audioAction === 'transcode_aac') {
        updateData.type = 'ENCODE';
        this.logger.log(`Setting job type to ENCODE (audio transcode)`);
      }

      if (config.action === 'force_encode') {
        updateData.type = 'ENCODE';
        this.logger.log(`Setting job type to ENCODE (force re-encode same codec)`);
      }
    }

    const job = await this.jobRepository.updateRaw(id, updateData);

    this.logger.log(
      `Decision resolved for job ${id} - moved to QUEUED stage (container: ${job.targetContainer}, type: ${job.type})`
    );
    return job;
  }

  // ─── Delegated: Bulk Operations ──────────────────────────────────────────────

  cancelAllQueued(): Promise<{ cancelledCount: number }> {
    return this.jobBulkOperationsService.cancelAllQueued();
  }

  retryAllCancelled(): Promise<{
    retriedCount: number;
    totalSizeBytes: string;
    jobs: Array<{ id: string; fileLabel: string; beforeSizeBytes: bigint }>;
  }> {
    return this.jobBulkOperationsService.retryAllCancelled();
  }

  categorizeError(error: string): string {
    return this.jobBulkOperationsService.categorizeError(error);
  }

  retryAllFailed(errorFilter?: string): Promise<{
    retriedCount: number;
    jobs: Array<{ id: string; fileLabel: string; error: string }>;
  }> {
    return this.jobBulkOperationsService.retryAllFailed(errorFilter);
  }

  skipAllCodecMatch(): Promise<{
    skippedCount: number;
    jobs: Array<{ id: string; fileLabel: string; sourceCodec: string; targetCodec: string }>;
  }> {
    return this.jobBulkOperationsService.skipAllCodecMatch();
  }

  forceEncodeAllCodecMatch(): Promise<{
    queuedCount: number;
    jobs: Array<{ id: string; fileLabel: string; sourceCodec: string; targetCodec: string }>;
  }> {
    return this.jobBulkOperationsService.forceEncodeAllCodecMatch();
  }

  // ─── Delegated: File Operations ──────────────────────────────────────────────

  requestKeepOriginal(id: string): Promise<Job> {
    return this.jobFileOperationsService.requestKeepOriginal(id);
  }

  deleteOriginalBackup(id: string): Promise<{ freedSpace: bigint }> {
    return this.jobFileOperationsService.deleteOriginalBackup(id);
  }

  restoreOriginal(id: string): Promise<Job> {
    return this.jobFileOperationsService.restoreOriginal(id);
  }

  recheckFailedJob(id: string): Promise<Job> {
    return this.jobFileOperationsService.recheckFailedJob(id);
  }

  detectAndRequeueIfUncompressed(id: string): Promise<Job> {
    return this.jobFileOperationsService.detectAndRequeueIfUncompressed(id);
  }
}
