import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { normalizeCodec } from '../../common/utils/codec.util';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * JobBulkOperationsService
 *
 * Handles bulk job operations: cancel-all, retry-all-failed, retry-all-cancelled,
 * skip/force-encode codec-match jobs, and error categorization.
 * Extracted from QueueJobStateService to separate bulk-operation concerns.
 */
@Injectable()
export class JobBulkOperationsService {
  private readonly logger = new Logger(JobBulkOperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => FfmpegService))
    private readonly ffmpegService: FfmpegService
  ) {}

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
          } catch (error: unknown) {
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
    } catch (error: unknown) {
      this.logger.error('Failed to cancel all jobs', error);
      throw error;
    }
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
    } catch (error: unknown) {
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
    } catch (error: unknown) {
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
    } catch (error: unknown) {
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
    } catch (error: unknown) {
      this.logger.error('Failed to force encode codec-match jobs', error);
      throw error;
    }
  }
}
