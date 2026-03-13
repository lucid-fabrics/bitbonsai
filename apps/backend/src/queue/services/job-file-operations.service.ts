import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from '@prisma/client';
import { JobStage } from '@prisma/client';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JobMetricsService } from './job-metrics.service';
import { QueueJobCrudService } from './queue-job-crud.service';

/**
 * JobFileOperationsService
 *
 * Handles file-level job operations: keep-original requests, backup deletion,
 * original restoration, failed-job rechecking, and compression detection.
 * Extracted from QueueJobStateService to separate file-operation concerns.
 */
@Injectable()
export class JobFileOperationsService {
  private readonly logger = new Logger(JobFileOperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobCrudService: QueueJobCrudService,
    @Inject(forwardRef(() => FfmpegService))
    private readonly ffmpegService: FfmpegService,
    private readonly jobMetricsService: JobMetricsService
  ) {}

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

      await this.jobMetricsService.updateMetrics(updated, tx);

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
}
