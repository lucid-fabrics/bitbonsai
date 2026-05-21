import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Job, JobEventType, JobStage } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { JobRepository } from '../../common/repositories/job.repository';
import { NodeConfigService } from '../../core/services/node-config.service';
import { FileFailureTrackingService } from './file-failure-tracking.service';
import { JobHistoryService } from './job-history.service';
import { QueueJobCrudService } from './queue-job-crud.service';

@Injectable()
export class JobFailureService {
  private readonly logger = new Logger(JobFailureService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly nodeConfig: NodeConfigService,
    private readonly httpService: HttpService,
    private readonly jobCrudService: QueueJobCrudService,
    private readonly jobHistoryService: JobHistoryService,
    private readonly fileFailureTracking: FileFailureTrackingService
  ) {}

  private proxyOptions(): { timeout: number; headers: Record<string, string> } {
    const nodeId = this.nodeConfig.getNodeId();
    return {
      timeout: 30000,
      headers: nodeId ? { 'x-node-id': nodeId } : {},
    };
  }

  async failJob(id: string, error: string, callerNodeId?: string): Promise<Job> {
    this.logger.log(`Failing job: ${id}`);

    await this.jobCrudService.validateJobOwnership(id, 'fail', callerNodeId);

    const mainApiUrl = this.nodeConfig.getMainApiUrl();
    if (mainApiUrl) {
      const url = `${mainApiUrl}/api/v1/queue/${id}/fail`;
      this.logger.debug(`🔍 MULTI-NODE: LINKED node proxying job failure to MAIN: ${url}`);
      try {
        const response = await firstValueFrom(
          this.httpService.post(url, { error }, this.proxyOptions())
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
      this.logger.error(
        'Failed to record file failure tracking',
        trackingError instanceof Error ? trackingError.stack : String(trackingError)
      );
    }

    this.logger.log(`Job failed: ${id} (${error})`);
    return job;
  }
}
