import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Job, JobEventType, JobStage } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { JobRepository } from '../../common/repositories/job.repository';
import { NodeConfigService } from '../../core/services/node-config.service';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FileFailureTrackingService } from './file-failure-tracking.service';
import { FileTransferService } from './file-transfer.service';
import { JobHistoryService } from './job-history.service';

/**
 * JobCancellationService
 *
 * Handles job cancellation and blacklist management.
 * Proxies to MAIN node in multi-node setups.
 */
@Injectable()
export class JobCancellationService {
  private readonly logger = new Logger(JobCancellationService.name);

  /** Build HTTP options including caller node identity so MAIN can validate ownership. */
  private proxyOptions(): { timeout: number; headers: Record<string, string> } {
    const nodeId = this.nodeConfig.getNodeId();
    return {
      timeout: 30000,
      headers: nodeId ? { 'x-node-id': nodeId } : {},
    };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobRepository: JobRepository,
    private readonly ffmpegService: FfmpegService,
    private readonly fileTransferService: FileTransferService,
    private readonly nodeConfig: NodeConfigService,
    private readonly httpService: HttpService,
    private readonly jobHistoryService: JobHistoryService,
    private readonly fileFailureTracking: FileFailureTrackingService
  ) {}

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
          this.httpService.post(url, { blacklist }, this.proxyOptions())
        );
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
}
