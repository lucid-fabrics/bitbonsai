import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { type Job, JobStage, Prisma } from '@prisma/client';
import {
  EncodingCancelledEvent,
  EncodingFailedEvent,
  EncodingPreviewUpdateEvent,
  EncodingProcessMarkedEvent,
  EncodingProgressUpdateEvent,
} from '../common/events';
import type { CompleteJobDto } from './dto/complete-job.dto';
import type { CreateJobDto } from './dto/create-job.dto';
import type { JobStatsDto } from './dto/job-stats.dto';
import type { UpdateJobDto } from './dto/update-job.dto';
import { QueueDelegationService } from './services/queue-delegation.service';
import { QueueJobCrudService } from './services/queue-job-crud.service';
import { QueueJobStateService } from './services/queue-job-state.service';
import { QueueProcessingService } from './services/queue-processing.service';

/**
 * QueueService
 *
 * Thin facade that delegates to focused sub-services:
 * - QueueJobCrudService: CRUD operations, queries, generic updates
 * - QueueJobStateService: State transitions (pause, resume, cancel, retry, complete, fail, etc.)
 * - QueueDelegationService: Multi-node delegation, rebalancing, stuck transfer cleanup
 * - QueueProcessingService: Job processing orchestration, file detection, self-healing
 *
 * Preserves the original public API so all existing consumers (controller, encoding, libraries)
 * continue to work without changes.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly jobCrudService: QueueJobCrudService,
    private readonly jobStateService: QueueJobStateService,
    private readonly delegationService: QueueDelegationService,
    private readonly processingService: QueueProcessingService
  ) {}

  // ─── CRUD Operations (QueueJobCrudService) ─────────────────────────

  async create(createJobDto: CreateJobDto): Promise<Job> {
    return this.jobCrudService.create(createJobDto);
  }

  async findAll(
    stage?: JobStage,
    nodeId?: string,
    search?: string,
    libraryId?: string,
    page?: number,
    limit?: number
  ): Promise<{ jobs: Job[]; total: number; page: number; limit: number; totalPages: number }> {
    return this.jobCrudService.findAll(stage, nodeId, search, libraryId, page, limit);
  }

  async findOne(id: string): Promise<Job> {
    return this.jobCrudService.findOne(id);
  }

  async getJobStatus(jobId: string): Promise<{
    pauseRequestedAt: Date | null;
    pauseProcessedAt: Date | null;
    cancelRequestedAt: Date | null;
    cancelProcessedAt: Date | null;
  } | null> {
    return this.jobCrudService.getJobStatus(jobId);
  }

  async updateJobRaw(jobId: string, data: Record<string, any>): Promise<void> {
    return this.jobCrudService.updateJobRaw(jobId, data);
  }

  async updateProgress(id: string, updateJobDto: UpdateJobDto): Promise<Job> {
    return this.jobCrudService.updateProgress(id, updateJobDto);
  }

  async updateJobPreview(id: string, previewPaths: string[]): Promise<Job> {
    return this.jobCrudService.updateJobPreview(id, previewPaths);
  }

  async update(id: string, data: Prisma.JobUpdateInput): Promise<Job> {
    return this.jobCrudService.update(id, data);
  }

  async remove(id: string): Promise<void> {
    return this.jobCrudService.remove(id);
  }

  async clearJobs(stages?: JobStage[]): Promise<number> {
    return this.jobCrudService.clearJobs(stages);
  }

  async getJobStats(nodeId?: string): Promise<JobStatsDto> {
    return this.jobCrudService.getJobStats(nodeId);
  }

  // ─── State Transitions (QueueJobStateService) ─────────────────────

  async completeJob(id: string, completeJobDto: CompleteJobDto): Promise<Job> {
    return this.jobStateService.completeJob(id, completeJobDto);
  }

  async failJob(id: string, error: string): Promise<Job> {
    return this.jobStateService.failJob(id, error);
  }

  async cancelJob(id: string, blacklist = false): Promise<Job> {
    return this.jobStateService.cancelJob(id, blacklist);
  }

  async unblacklistJob(id: string): Promise<Job> {
    return this.jobStateService.unblacklistJob(id);
  }

  async cancelAllQueued(): Promise<{ cancelledCount: number }> {
    return this.jobStateService.cancelAllQueued();
  }

  async pauseJob(id: string): Promise<Job> {
    return this.jobStateService.pauseJob(id);
  }

  async resumeJob(id: string): Promise<Job> {
    return this.jobStateService.resumeJob(id);
  }

  async retryJob(id: string): Promise<Job> {
    return this.jobStateService.retryJob(id);
  }

  async forceStartJob(id: string): Promise<Job> {
    return this.jobStateService.forceStartJob(id);
  }

  async recheckHealth(id: string): Promise<Job> {
    return this.jobStateService.recheckHealth(id);
  }

  async retryAllCancelled(): Promise<{
    retriedCount: number;
    totalSizeBytes: string;
    jobs: Array<{ id: string; fileLabel: string; beforeSizeBytes: bigint }>;
  }> {
    return this.jobStateService.retryAllCancelled();
  }

  async retryAllFailed(errorFilter?: string): Promise<{
    retriedCount: number;
    jobs: Array<{ id: string; fileLabel: string; error: string }>;
  }> {
    return this.jobStateService.retryAllFailed(errorFilter);
  }

  async skipAllCodecMatch(): Promise<{
    skippedCount: number;
    jobs: Array<{ id: string; fileLabel: string; sourceCodec: string; targetCodec: string }>;
  }> {
    return this.jobStateService.skipAllCodecMatch();
  }

  async forceEncodeAllCodecMatch(): Promise<{
    queuedCount: number;
    jobs: Array<{ id: string; fileLabel: string; sourceCodec: string; targetCodec: string }>;
  }> {
    return this.jobStateService.forceEncodeAllCodecMatch();
  }

  async updateJobPriority(id: string, priority: number): Promise<Job> {
    return this.jobStateService.updateJobPriority(id, priority);
  }

  async requestKeepOriginal(id: string): Promise<Job> {
    return this.jobStateService.requestKeepOriginal(id);
  }

  async deleteOriginalBackup(id: string): Promise<{ freedSpace: bigint }> {
    return this.jobStateService.deleteOriginalBackup(id);
  }

  async restoreOriginal(id: string): Promise<Job> {
    return this.jobStateService.restoreOriginal(id);
  }

  async recheckFailedJob(id: string): Promise<Job> {
    return this.jobStateService.recheckFailedJob(id);
  }

  async detectAndRequeueIfUncompressed(id: string): Promise<Job> {
    return this.jobStateService.detectAndRequeueIfUncompressed(id);
  }

  async resolveDecision(id: string, decisionData?: Record<string, any>): Promise<Job> {
    return this.jobStateService.resolveDecision(id, decisionData);
  }

  // ─── Processing (QueueProcessingService) ───────────────────────────

  async getNextJob(nodeId: string): Promise<Job | null> {
    return this.processingService.getNextJob(nodeId);
  }

  // ─── Delegation (QueueDelegationService) ───────────────────────────

  async delegateJob(jobId: string, targetNodeId: string): Promise<Job> {
    return this.delegationService.delegateJob(jobId, targetNodeId);
  }

  async rebalanceJobs(): Promise<number> {
    return this.delegationService.rebalanceJobs();
  }

  async fixStuckTransfers(): Promise<number> {
    return this.delegationService.fixStuckTransfers();
  }

  // ─── Event Listeners (from FfmpegService via EventEmitter) ──────────

  @OnEvent(EncodingProgressUpdateEvent.event)
  async handleEncodingProgressUpdate(event: EncodingProgressUpdateEvent): Promise<void> {
    try {
      await this.updateProgress(event.jobId, {
        progress: event.data.progress,
        etaSeconds: event.data.etaSeconds,
        fps: event.data.fps,
        resumeTimestamp: event.data.resumeTimestamp,
        tempFilePath: event.data.tempFilePath,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Progress update failed for job ${event.jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  @OnEvent(EncodingPreviewUpdateEvent.event)
  async handleEncodingPreviewUpdate(event: EncodingPreviewUpdateEvent): Promise<void> {
    try {
      await this.updateJobPreview(event.jobId, event.previewPaths);
    } catch (error: unknown) {
      this.logger.warn(
        `Preview update failed for job ${event.jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  @OnEvent(EncodingFailedEvent.event)
  async handleEncodingFailed(event: EncodingFailedEvent): Promise<void> {
    try {
      await this.failJob(event.jobId, event.errorMessage);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to mark job ${event.jobId} as failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  @OnEvent(EncodingCancelledEvent.event)
  async handleEncodingCancelled(event: EncodingCancelledEvent): Promise<void> {
    try {
      await this.cancelJob(event.jobId);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to cancel job ${event.jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  @OnEvent(EncodingProcessMarkedEvent.event)
  async handleEncodingProcessMarked(event: EncodingProcessMarkedEvent): Promise<void> {
    try {
      await this.updateJobRaw(event.jobId, event.updates);
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to mark process state for job ${event.jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
