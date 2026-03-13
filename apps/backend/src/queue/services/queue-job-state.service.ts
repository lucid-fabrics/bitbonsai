import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FileHealthStatus, type Job, JobEventType, JobStage, Prisma } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { normalizeCodec } from '../../common/utils/codec.util';
import { NodeConfigService } from '../../core/services/node-config.service';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { CompleteJobDto } from '../dto/complete-job.dto';
import { FileFailureTrackingService } from './file-failure-tracking.service';
import { FileTransferService } from './file-transfer.service';
import { JobHistoryService } from './job-history.service';
import { QueueJobCrudService } from './queue-job-crud.service';

/**
 * QueueJobStateService
 *
 * Handles job state transitions: pause, resume, cancel, retry, complete, fail,
 * priority management, original file operations, and decision resolution.
 */
@Injectable()
export class QueueJobStateService {
  private readonly logger = new Logger(QueueJobStateService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => FfmpegService))
    private ffmpegService: FfmpegService,
    private jobHistoryService: JobHistoryService,
    private fileTransferService: FileTransferService,
    private nodeConfig: NodeConfigService,
    private httpService: HttpService,
    private jobCrudService: QueueJobCrudService,
    private fileFailureTracking: FileFailureTrackingService
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
      } catch (error) {
        this.logger.error(`❌ MULTI-NODE: Failed to proxy job completion to MAIN:`, error);
        throw error;
      }
    }

    let job: Job;

    try {
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

        await this.updateMetrics(completedJob, tx);

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
    } catch (txError) {
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
      } catch (err) {
        this.logger.error(`❌ MULTI-NODE: Failed to proxy job failure to MAIN:`, err);
        throw err;
      }
    }

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage === JobStage.FAILED) {
      this.logger.warn(`Job ${id} is already FAILED - skipping duplicate failure event`);
      return existingJob;
    }

    const job = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.FAILED,
        completedAt: new Date(),
        failedAt: new Date(),
        error,
      },
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
    } catch (trackingError) {
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
      } catch (error) {
        this.logger.error(`❌ MULTI-NODE: Failed to proxy job cancellation to MAIN:`, error);
        throw error;
      }
    }

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

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
      } catch (error) {
        this.logger.warn(`Failed to kill FFmpeg for job ${id}: ${error}`);
      }
    }

    if (existingJob.stage === 'TRANSFERRING') {
      this.logger.log(`Job ${id} is transferring - cancelling transfer`);
      try {
        await this.fileTransferService.cancelTransfer(id);
        this.logger.log(`Successfully cancelled transfer for job ${id}`);
      } catch (error) {
        this.logger.warn(`Failed to cancel transfer for job ${id}: ${error}`);
      }

      if (existingJob.remoteTempPath) {
        try {
          await this.fileTransferService.cleanupRemoteTempFile(id);
          this.logger.log(`Cleaned up remote temp file for job ${id}`);
        } catch (error) {
          this.logger.warn(`Failed to cleanup remote temp file for job ${id}: ${error}`);
        }
      }
    }

    const job = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.CANCELLED,
        completedAt: new Date(),
        isBlacklisted: blacklist,
      },
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

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.CANCELLED) {
      throw new BadRequestException('Only cancelled jobs can be unblacklisted');
    }

    if (!existingJob.isBlacklisted) {
      throw new BadRequestException('Job is not blacklisted');
    }

    const job = await this.prisma.job.update({
      where: { id },
      data: {
        isBlacklisted: false,
        // Reset retry caps so the job can actually be retried
        corruptedRequeueCount: 0,
        stuckRecoveryCount: 0,
      },
    });

    // Clear cross-job failure tracking so the file can be retried fresh
    try {
      await this.fileFailureTracking.clearBlacklist(existingJob.filePath, existingJob.libraryId);
    } catch (trackingError) {
      this.logger.error('Failed to clear file failure tracking', trackingError);
    }

    // Clear ProcessedFileRecord so re-encoding is possible
    try {
      if (existingJob.contentFingerprint) {
        await this.prisma.processedFileRecord.deleteMany({
          where: { contentFingerprint: existingJob.contentFingerprint },
        });
      }
    } catch (recordError) {
      this.logger.error('Failed to clear processed file record', recordError);
    }

    this.logger.log(`Job unblacklisted: ${id}`);
    return job;
  }

  /**
   * Cancel all jobs (including encoding)
   */
  async cancelAllQueued(): Promise<{ cancelledCount: number }> {
    this.logger.log('Cancelling all jobs (including encoding)');

    try {
      const encodingJobs = await this.prisma.job.findMany({
        where: { stage: JobStage.ENCODING },
        select: { id: true, fileLabel: true },
      });

      if (encodingJobs.length > 0) {
        this.logger.log(`Killing ${encodingJobs.length} FFmpeg process(es) in parallel...`);

        const killPromises = encodingJobs.map(async (job) => {
          try {
            await this.ffmpegService.killProcess(job.id);
            this.logger.log(`  ✓ Killed FFmpeg for: ${job.fileLabel}`);
          } catch (error) {
            this.logger.warn(`  ✗ Failed to kill FFmpeg for ${job.id}: ${error}`);
          }
        });

        await Promise.allSettled(killPromises);
        this.logger.log(`Finished killing ${encodingJobs.length} FFmpeg process(es)`);
      }

      const result = await this.prisma.job.updateMany({
        where: {
          stage: {
            in: [
              JobStage.DETECTED,
              JobStage.QUEUED,
              JobStage.PAUSED,
              JobStage.HEALTH_CHECK,
              JobStage.ENCODING,
            ],
          },
        },
        data: {
          stage: JobStage.CANCELLED,
          completedAt: new Date(),
        },
      });

      this.logger.log(`Cancelled ${result.count} job(s) (all stages including encoding)`);
      return { cancelledCount: result.count };
    } catch (error) {
      this.logger.error('Failed to cancel all jobs', error);
      throw error;
    }
  }

  /**
   * Pause an encoding job
   */
  async pauseJob(id: string): Promise<Job> {
    this.logger.log(`Pausing job: ${id}`);

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

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

    const job = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.PAUSED,
      },
    });

    this.logger.log(`Job paused: ${id}`);
    return job;
  }

  /**
   * Resume a paused job
   */
  async resumeJob(id: string): Promise<Job> {
    this.logger.log(`Resuming job: ${id}`);

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

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

      const job = await this.prisma.job.update({
        where: { id },
        data: {
          stage: JobStage.QUEUED,
          progress: 0,
          etaSeconds: null,
          startedAt: null,
          error: 'Restarted from paused state (process was lost)',
        },
      });

      this.logger.log(`Job reset to QUEUED: ${id}`);
      return job;
    }

    const job = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.ENCODING,
      },
    });

    this.logger.log(`Job resumed: ${id}`);
    return job;
  }

  /**
   * Retry a failed or cancelled job
   */
  async retryJob(id: string): Promise<Job> {
    this.logger.log(`Retrying job: ${id}`);

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

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

    const job = await this.prisma.job.update({
      where: { id },
      data: {
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
      },
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

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.QUEUED && existingJob.stage !== JobStage.DETECTED) {
      throw new BadRequestException(
        `Only queued or detected jobs can be force-started (current stage: ${existingJob.stage})`
      );
    }

    const job = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.DETECTED,
        createdAt: new Date(0),
      },
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

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    const job = await this.prisma.job.update({
      where: { id },
      data: {
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
      },
    });

    this.logger.log(
      `Job health check cleared: ${id} - reset to DETECTED stage (will be rechecked immediately)`
    );
    return job;
  }

  /**
   * Retry all cancelled jobs
   */
  async retryAllCancelled(): Promise<{
    retriedCount: number;
    totalSizeBytes: string;
    jobs: Array<{ id: string; fileLabel: string; beforeSizeBytes: bigint }>;
  }> {
    this.logger.log('Retrying all cancelled jobs');

    try {
      const cancelledJobs = await this.prisma.job.findMany({
        where: {
          stage: JobStage.CANCELLED,
        },
        select: {
          id: true,
          fileLabel: true,
          beforeSizeBytes: true,
        },
      });

      const totalSize = cancelledJobs.reduce(
        (sum, job) => sum + BigInt(job.beforeSizeBytes),
        BigInt(0)
      );

      const result = await this.prisma.job.updateMany({
        where: {
          stage: JobStage.CANCELLED,
        },
        data: {
          stage: JobStage.QUEUED,
          progress: 0,
          error: null,
          completedAt: null,
          startedAt: null,
        },
      });

      this.logger.log(`Retried ${result.count} cancelled job(s)`);
      return {
        retriedCount: result.count,
        totalSizeBytes: totalSize.toString(),
        jobs: cancelledJobs,
      };
    } catch (error) {
      this.logger.error('Failed to retry all cancelled jobs', error);
      throw error;
    }
  }

  /**
   * Categorize an error message into a meaningful group
   */
  categorizeError(error: string): string {
    if (!error) return 'Unknown error';

    const errorLower = error.toLowerCase();

    const ffmpegExitMatch = error.match(/ffmpeg.*exit code (\d+)/i);
    if (ffmpegExitMatch) {
      const exitCode = ffmpegExitMatch[1];
      return `FFmpeg Error Code ${exitCode}`;
    }

    if (errorLower.includes('ffmpeg') && errorLower.includes('error')) {
      return 'FFmpeg Error (Other)';
    }

    if (
      errorLower.includes('timeout') ||
      errorLower.includes('timed out') ||
      errorLower.includes('stuck') ||
      errorLower.includes('no progress')
    ) {
      return 'Job Timeout/Stuck';
    }

    if (
      errorLower.includes('file not found') ||
      errorLower.includes('no such file') ||
      errorLower.includes('enoent') ||
      errorLower.includes('does not exist')
    ) {
      return 'File Not Found';
    }

    if (
      errorLower.includes('codec') ||
      errorLower.includes('unsupported') ||
      errorLower.includes('invalid codec')
    ) {
      return 'Codec Error';
    }

    if (
      errorLower.includes('network') ||
      errorLower.includes('connection') ||
      errorLower.includes('econnrefused') ||
      errorLower.includes('econnreset')
    ) {
      return 'Network Error';
    }

    if (
      errorLower.includes('no space') ||
      errorLower.includes('enospc') ||
      errorLower.includes('disk full')
    ) {
      return 'Disk Space Error';
    }

    if (
      errorLower.includes('permission') ||
      errorLower.includes('eacces') ||
      errorLower.includes('eperm')
    ) {
      return 'Permission Error';
    }

    if (errorLower.includes('out of memory') || errorLower.includes('enomem')) {
      return 'Memory Error';
    }

    return error;
  }

  /**
   * Retry all failed jobs (optionally filtered by error category)
   */
  async retryAllFailed(errorFilter?: string): Promise<{
    retriedCount: number;
    jobs: Array<{ id: string; fileLabel: string; error: string }>;
  }> {
    this.logger.log(
      `Retrying all failed jobs${errorFilter ? ` with category: ${errorFilter}` : ''}`
    );

    try {
      const allFailedJobs = await this.prisma.job.findMany({
        where: {
          stage: JobStage.FAILED,
        },
        select: {
          id: true,
          fileLabel: true,
          error: true,
        },
      });

      let jobsToRetry = allFailedJobs;
      if (errorFilter) {
        jobsToRetry = allFailedJobs.filter((job) => {
          const category = this.categorizeError(job.error || '');
          return category === errorFilter;
        });
      }

      const jobIdsToRetry = jobsToRetry.map((job) => job.id);

      const result = await this.prisma.job.updateMany({
        where: {
          id: { in: jobIdsToRetry },
        },
        data: {
          stage: JobStage.QUEUED,
          progress: 0,
          error: null,
          completedAt: null,
          startedAt: null,
          failedAt: null,
        },
      });

      this.logger.log(
        `Retried ${result.count} failed job(s)${errorFilter ? ` with category: ${errorFilter}` : ''}`
      );

      return {
        retriedCount: result.count,
        jobs: jobsToRetry.map((job) => ({
          id: job.id,
          fileLabel: job.fileLabel,
          error: job.error || 'Unknown error',
        })),
      };
    } catch (error) {
      this.logger.error('Failed to retry failed jobs', error);
      throw error;
    }
  }

  /**
   * Skip all jobs where codec already matches target
   */
  async skipAllCodecMatch(): Promise<{
    skippedCount: number;
    jobs: Array<{ id: string; fileLabel: string; sourceCodec: string; targetCodec: string }>;
  }> {
    this.logger.log('Skipping all jobs where codec already matches target');

    try {
      const allNeedsDecisionJobs = await this.prisma.job.findMany({
        where: {
          stage: JobStage.NEEDS_DECISION,
        },
        select: {
          id: true,
          fileLabel: true,
          sourceCodec: true,
          targetCodec: true,
          beforeSizeBytes: true,
          decisionIssues: true,
        },
      });

      const jobsToSkip = allNeedsDecisionJobs.filter((job) => {
        const normalizedSource = normalizeCodec(job.sourceCodec);
        const normalizedTarget = normalizeCodec(job.targetCodec);
        return normalizedSource === normalizedTarget;
      });

      if (jobsToSkip.length === 0) {
        this.logger.log('No codec-match jobs found to skip');
        return { skippedCount: 0, jobs: [] };
      }

      const now = new Date();
      const result = await this.prisma.job.updateMany({
        where: {
          id: { in: jobsToSkip.map((j) => j.id) },
        },
        data: {
          stage: JobStage.COMPLETED,
          decisionRequired: false,
          decisionIssues: null,
          decisionMadeAt: now,
          decisionData: JSON.stringify({
            actionConfig: {
              action: 'skip',
              reason: 'codec_already_matches',
              bulkAction: true,
            },
          }),
          completedAt: now,
          progress: 100,
          healthMessage: '✅ Skipped - file already in target codec (bulk action)',
        },
      });

      await Promise.all(
        jobsToSkip.map((job) =>
          this.prisma.job.update({
            where: { id: job.id },
            data: { afterSizeBytes: job.beforeSizeBytes },
          })
        )
      );

      this.logger.log(`Skipped ${result.count} codec-match job(s)`);

      return {
        skippedCount: result.count,
        jobs: jobsToSkip.map((job) => ({
          id: job.id,
          fileLabel: job.fileLabel,
          sourceCodec: job.sourceCodec,
          targetCodec: job.targetCodec,
        })),
      };
    } catch (error) {
      this.logger.error('Failed to skip codec-match jobs', error);
      throw error;
    }
  }

  /**
   * Force encode all jobs where codec already matches target
   */
  async forceEncodeAllCodecMatch(): Promise<{
    queuedCount: number;
    jobs: Array<{ id: string; fileLabel: string; sourceCodec: string; targetCodec: string }>;
  }> {
    this.logger.log('Force encoding all jobs where codec already matches target');

    try {
      const allNeedsDecisionJobs = await this.prisma.job.findMany({
        where: {
          stage: JobStage.NEEDS_DECISION,
        },
        select: {
          id: true,
          fileLabel: true,
          sourceCodec: true,
          targetCodec: true,
          decisionIssues: true,
        },
      });

      const jobsToEncode = allNeedsDecisionJobs.filter((job) => {
        const normalizedSource = normalizeCodec(job.sourceCodec);
        const normalizedTarget = normalizeCodec(job.targetCodec);
        return normalizedSource === normalizedTarget;
      });

      if (jobsToEncode.length === 0) {
        this.logger.log('No codec-match jobs found to force encode');
        return { queuedCount: 0, jobs: [] };
      }

      const now = new Date();
      const result = await this.prisma.job.updateMany({
        where: {
          id: { in: jobsToEncode.map((j) => j.id) },
        },
        data: {
          stage: JobStage.QUEUED,
          decisionRequired: false,
          decisionIssues: null,
          decisionMadeAt: now,
          decisionData: JSON.stringify({
            actionConfig: {
              action: 'force_encode',
              reason: 'user_requested',
              bulkAction: true,
            },
          }),
          healthMessage: '⚡ Force re-encoding - user requested (bulk action)',
        },
      });

      this.logger.log(`Queued ${result.count} codec-match job(s) for force encoding`);

      return {
        queuedCount: result.count,
        jobs: jobsToEncode.map((job) => ({
          id: job.id,
          fileLabel: job.fileLabel,
          sourceCodec: job.sourceCodec,
          targetCodec: job.targetCodec,
        })),
      };
    } catch (error) {
      this.logger.error('Failed to force encode codec-match jobs', error);
      throw error;
    }
  }

  /**
   * Update job priority
   */
  async updateJobPriority(id: string, priority: number): Promise<Job> {
    this.logger.log(`Updating priority for job ${id} to ${priority}`);

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (priority < 0 || priority > 2) {
      throw new BadRequestException('Priority must be between 0 and 2');
    }

    if (priority === 2) {
      const topPriorityCount = await this.prisma.job.count({
        where: {
          priority: 2,
          stage: {
            in: [JobStage.DETECTED, JobStage.HEALTH_CHECK, JobStage.QUEUED, JobStage.ENCODING],
          },
          id: { not: id },
        },
      });

      if (topPriorityCount >= 3) {
        throw new BadRequestException(
          'Maximum 3 jobs can have top priority at once. Please lower priority of another job first.'
        );
      }
    }

    const job = await this.prisma.job.update({
      where: { id },
      data: {
        priority,
        prioritySetAt: new Date(),
      },
    });

    if (existingJob.stage === JobStage.ENCODING) {
      try {
        await this.ffmpegService.reniceProcess(id, priority);
        this.logger.log(`Reniced FFmpeg process for job ${id} to priority ${priority}`);
      } catch (error) {
        this.logger.warn(
          `Failed to renice FFmpeg process for job ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    this.logger.log(`Job ${id} priority updated to ${priority}`);
    return job;
  }

  /**
   * Request to keep original file after encoding
   */
  async requestKeepOriginal(id: string): Promise<Job> {
    this.logger.log(`Requesting keep original for job: ${id}`);

    const job = await this.jobCrudService.findOne(id);

    if (job.stage !== JobStage.ENCODING) {
      throw new BadRequestException('Can only request keep-original for ENCODING jobs');
    }

    const updatedJob = await this.prisma.job.update({
      where: { id },
      data: {
        keepOriginalRequested: true,
        originalSizeBytes: job.beforeSizeBytes,
      },
    });

    this.logger.log(`Keep original requested for job: ${id}`);
    return updatedJob;
  }

  /**
   * Delete original backup file
   */
  async deleteOriginalBackup(id: string): Promise<{ freedSpace: bigint }> {
    this.logger.log(`Deleting original backup for job: ${id}`);

    const job = await this.jobCrudService.findOne(id);

    if (!job.originalBackupPath) {
      throw new BadRequestException('No original backup exists for this job');
    }

    const size = job.originalSizeBytes || BigInt(0);

    const fs = await import('fs/promises');
    try {
      await fs.unlink(job.originalBackupPath);
    } catch (error) {
      this.logger.error(`Failed to delete original backup file: ${job.originalBackupPath}`, error);
      throw new BadRequestException(
        `Failed to delete original backup file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    await this.prisma.job.update({
      where: { id },
      data: {
        originalBackupPath: null,
        originalSizeBytes: null,
      },
    });

    this.logger.log(`Original backup deleted for job: ${id} (freed ${size} bytes)`);
    return { freedSpace: size };
  }

  /**
   * Restore original file
   */
  async restoreOriginal(id: string): Promise<Job> {
    this.logger.log(`Restoring original for job: ${id}`);

    const job = await this.jobCrudService.findOne(id);

    if (!job.originalBackupPath) {
      throw new BadRequestException('No original backup to restore');
    }

    const fs = await import('fs/promises');
    const encodedPath = `${job.filePath}.encoded`;

    try {
      await fs.rename(job.filePath, encodedPath);
      await fs.rename(job.originalBackupPath, job.filePath);
    } catch (error) {
      this.logger.error(`Failed to restore original file for job: ${id}`, error);
      throw new BadRequestException(
        `Failed to restore original file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    const updatedJob = await this.prisma.job.update({
      where: { id },
      data: {
        originalBackupPath: encodedPath,
        replacementAction: 'KEPT_BOTH',
      },
    });

    this.logger.log(`Original restored for job: ${id}`);
    return updatedJob;
  }

  /**
   * Recheck a failed job to validate if it's truly failed or completed
   */
  async recheckFailedJob(id: string): Promise<Job> {
    this.logger.log(`Rechecking failed job: ${id}`);

    const job = await this.jobCrudService.findOne(id);

    if (job.stage !== JobStage.FAILED) {
      throw new BadRequestException(`Can only recheck FAILED jobs (current stage: ${job.stage})`);
    }

    const fs = await import('fs/promises');
    let fileExists = false;
    let fileSize = BigInt(0);

    try {
      const stats = await fs.stat(job.filePath);
      fileExists = stats.isFile();
      fileSize = BigInt(stats.size);
      this.logger.log(`File exists at ${job.filePath} (${fileSize} bytes)`);
    } catch (error) {
      this.logger.warn(
        `File not found at ${job.filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    if (!fileExists) {
      const updatedJob = await this.prisma.job.update({
        where: { id },
        data: {
          error: `RECHECK FAILED: File does not exist at expected path: ${job.filePath}\n\nOriginal error:\n${job.error}`,
        },
      });

      this.logger.log(`Recheck failed: File not found for job ${id}`);
      return updatedJob;
    }

    const verifyResult = await this.ffmpegService.verifyFile(job.filePath);

    if (!verifyResult.isValid) {
      const updatedJob = await this.prisma.job.update({
        where: { id },
        data: {
          error: `RECHECK FAILED: File exists but failed health check: ${verifyResult.error}\n\nOriginal error:\n${job.error}`,
        },
      });

      this.logger.log(`Recheck failed: File is corrupted for job ${id}`);
      return updatedJob;
    }

    this.logger.log(`Recheck passed! File is valid for job ${id}`);

    const afterSizeBytes = fileSize;
    const beforeSizeBytes = BigInt(job.beforeSizeBytes);
    const savedBytes = beforeSizeBytes - afterSizeBytes;
    const savedPercent = (Number(savedBytes) / Number(beforeSizeBytes)) * 100;
    const savedPercentRounded = Math.round(savedPercent * 100) / 100;

    if (savedBytes <= BigInt(0)) {
      const updatedJob = await this.prisma.job.update({
        where: { id },
        data: {
          error: `RECHECK FAILED: Encoding did not compress the file.\n\nBefore: ${Number(beforeSizeBytes).toLocaleString()} bytes\nAfter: ${Number(afterSizeBytes).toLocaleString()} bytes\nDifference: ${savedBytes >= BigInt(0) ? 'NO COMPRESSION' : 'FILE GREW'}\n\nThis suggests encoding settings were not applied correctly. The job should be retried.\n\nOriginal error:\n${job.error}`,
        },
      });

      this.logger.log(
        `Recheck rejected: File did not compress (before: ${beforeSizeBytes}, after: ${afterSizeBytes})`
      );
      return updatedJob;
    }

    const completedJob = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.job.update({
        where: { id },
        data: {
          stage: JobStage.COMPLETED,
          progress: 100,
          afterSizeBytes,
          savedBytes,
          savedPercent: savedPercentRounded,
          completedAt: new Date(),
          failedAt: null,
          error: null,
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

      await this.updateMetrics(updated, tx);

      return updated;
    });

    this.logger.log(`Job ${id} rechecked and moved to COMPLETED (saved ${savedPercentRounded}%)`);
    return completedJob;
  }

  /**
   * Detect if a completed job actually compressed the file, and requeue if not
   */
  async detectAndRequeueIfUncompressed(id: string): Promise<Job> {
    this.logger.log(`Detecting compression for completed job: ${id}`);

    const job = await this.jobCrudService.findOne(id);

    if (job.stage !== JobStage.COMPLETED) {
      throw new BadRequestException(
        `Can only detect compression for COMPLETED jobs (current stage: ${job.stage})`
      );
    }

    const savedBytes = BigInt(job.savedBytes || 0);

    if (savedBytes > BigInt(0)) {
      throw new BadRequestException(
        `Job successfully compressed the file by ${Number(savedBytes).toLocaleString()} bytes (${job.savedPercent}%). Cannot requeue.`
      );
    }

    this.logger.log(`No compression detected (savedBytes: ${savedBytes}). Requeuing job ${id}...`);

    const requeuedJob = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.QUEUED,
        progress: 0,
        completedAt: null,
        savedBytes: BigInt(0),
        savedPercent: 0,
        afterSizeBytes: null,
        error: null,
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

    this.logger.log(
      `Job ${id} requeued (no compression detected - before: ${Number(job.beforeSizeBytes).toLocaleString()} bytes, after: ${Number(job.afterSizeBytes).toLocaleString()} bytes)`
    );

    return requeuedJob;
  }

  /**
   * Resolve a user decision for a job in NEEDS_DECISION stage
   */
  async resolveDecision(id: string, decisionData?: Record<string, any>): Promise<Job> {
    this.logger.log(`Resolving decision for job: ${id}`);

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.NEEDS_DECISION) {
      throw new BadRequestException(
        `Can only resolve decisions for jobs in NEEDS_DECISION stage (current stage: ${existingJob.stage})`
      );
    }

    if (decisionData?.actionConfig) {
      const config = decisionData.actionConfig;

      if (config.action === 'skip') {
        const job = await this.prisma.job.update({
          where: { id },
          data: {
            stage: JobStage.COMPLETED,
            decisionRequired: false,
            decisionIssues: null,
            decisionMadeAt: new Date(),
            decisionData: JSON.stringify(decisionData),
            completedAt: new Date(),
            afterSizeBytes: existingJob.beforeSizeBytes,
            progress: 100,
            healthMessage: '✅ Skipped - file already in target codec',
          },
        });
        this.logger.log(`Decision resolved for job ${id} - SKIPPED (codec already matches target)`);
        return job;
      }

      if (config.action === 'cancel') {
        const job = await this.prisma.job.update({
          where: { id },
          data: {
            stage: JobStage.CANCELLED,
            decisionRequired: false,
            decisionIssues: null,
            decisionMadeAt: new Date(),
            decisionData: JSON.stringify(decisionData),
          },
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
      const config = decisionData.actionConfig;

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

    const job = await this.prisma.job.update({
      where: { id },
      data: updateData,
    });

    this.logger.log(
      `Decision resolved for job ${id} - moved to QUEUED stage (container: ${job.targetContainer}, type: ${job.type})`
    );
    return job;
  }

  /**
   * Update metrics after job completion
   */
  async updateMetrics(
    job: Job & { node?: { licenseId: string } },
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    if (!job.node?.licenseId) {
      this.logger.warn(
        `Cannot update metrics for job ${job.id}: missing node relation or licenseId`
      );
      return;
    }

    const prisma = tx || this.prisma;

    const alreadyProcessed = await prisma.metricsProcessedJob.findUnique({
      where: { jobId: job.id },
    });

    if (alreadyProcessed) {
      this.logger.debug(
        `Metrics already processed for job ${job.id} at ${alreadyProcessed.processedAt}, skipping to prevent double-count`
      );
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      await prisma.metric.upsert({
        where: {
          date_nodeId_licenseId: {
            date: today,
            nodeId: job.nodeId,
            licenseId: job.node.licenseId,
          },
        },
        create: {
          date: today,
          nodeId: job.nodeId,
          licenseId: job.node.licenseId,
          jobsCompleted: 1,
          totalSavedBytes: job.savedBytes || BigInt(0),
          avgThroughputFilesPerHour: 0,
          codecDistribution: {},
        },
        update: {
          jobsCompleted: { increment: 1 },
          totalSavedBytes: { increment: job.savedBytes || BigInt(0) },
        },
      });

      if (job.fps && job.fps > 0) {
        const currentNode = await prisma.node.findUnique({
          where: { id: job.nodeId },
          select: { avgEncodingSpeed: true },
        });

        if (currentNode) {
          const alpha = 0.3;
          const newSpeed = currentNode.avgEncodingSpeed
            ? currentNode.avgEncodingSpeed * (1 - alpha) + job.fps * alpha
            : job.fps;

          await prisma.node.update({
            where: { id: job.nodeId },
            data: { avgEncodingSpeed: newSpeed },
          });

          this.logger.debug(
            `Updated node ${job.nodeId} avgEncodingSpeed: ${currentNode.avgEncodingSpeed?.toFixed(2)} → ${newSpeed.toFixed(2)} FPS`
          );
        }
      }

      await prisma.metricsProcessedJob.create({
        data: { jobId: job.id },
      });

      this.logger.log(`Metrics updated for job: ${job.id}`);
    } catch (error) {
      this.logger.error(`Failed to update metrics for job: ${job.id}`, error);
      if (tx) {
        throw error;
      }
    }
  }
}
