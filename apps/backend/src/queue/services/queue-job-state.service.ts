import { Injectable } from '@nestjs/common';
import { type Job } from '@prisma/client';
import type { CompleteJobDto } from '../dto/complete-job.dto';
import { JobBulkOperationsService } from './job-bulk-operations.service';
import { JobCancellationService } from './job-cancellation.service';
import { JobCompletionService } from './job-completion.service';
import { JobDecisionService } from './job-decision.service';
import { JobEncodingControlService } from './job-encoding-control.service';
import { JobFailureService } from './job-failure.service';
import { JobFileOperationsService } from './job-file-operations.service';
import { JobQueueManipulationService } from './job-queue-manipulation.service';

/**
 * QueueJobStateService
 *
 * Thin facade over 5 focused services + 2 pre-existing delegates.
 * All single-job state transitions are handled by the specialized services below.
 */
@Injectable()
export class QueueJobStateService {
  constructor(
    private readonly jobCompletion: JobCompletionService,
    private readonly jobFailure: JobFailureService,
    private readonly jobCancellation: JobCancellationService,
    private readonly jobEncodingControl: JobEncodingControlService,
    private readonly jobDecision: JobDecisionService,
    private readonly jobQueueManipulation: JobQueueManipulationService,
    private readonly jobBulkOperationsService: JobBulkOperationsService,
    private readonly jobFileOperationsService: JobFileOperationsService
  ) {}

  // ─── Delegated: State Transitions ────────────────────────────────────────────

  completeJob(id: string, dto: CompleteJobDto, callerNodeId?: string): Promise<Job> {
    return this.jobCompletion.completeJob(id, dto, callerNodeId);
  }

  failJob(id: string, error: string, callerNodeId?: string): Promise<Job> {
    return this.jobFailure.failJob(id, error, callerNodeId);
  }

  // ─── Delegated: Cancellation ─────────────────────────────────────────────────

  cancelJob(id: string, blacklist = false): Promise<Job> {
    return this.jobCancellation.cancelJob(id, blacklist);
  }

  unblacklistJob(id: string): Promise<Job> {
    return this.jobCancellation.unblacklistJob(id);
  }

  // ─── Delegated: Encoding Control ─────────────────────────────────────────────

  pauseJob(id: string): Promise<Job> {
    return this.jobEncodingControl.pauseJob(id);
  }

  resumeJob(id: string): Promise<Job> {
    return this.jobEncodingControl.resumeJob(id);
  }

  updateJobPriority(id: string, priority: number): Promise<Job> {
    return this.jobEncodingControl.updateJobPriority(id, priority);
  }

  // ─── Delegated: Decision ─────────────────────────────────────────────────────

  resolveDecision(id: string, decisionData?: Record<string, unknown>): Promise<Job> {
    return this.jobDecision.resolveDecision(id, decisionData);
  }

  // ─── Delegated: Queue Manipulation ───────────────────────────────────────────

  retryJob(id: string): Promise<Job> {
    return this.jobQueueManipulation.retryJob(id);
  }

  forceStartJob(id: string): Promise<Job> {
    return this.jobQueueManipulation.forceStartJob(id);
  }

  recheckHealth(id: string): Promise<Job> {
    return this.jobQueueManipulation.recheckHealth(id);
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
    jobs: Array<{
      id: string;
      fileLabel: string;
      sourceCodec: string;
      targetCodec: string;
    }>;
  }> {
    return this.jobBulkOperationsService.skipAllCodecMatch();
  }

  forceEncodeAllCodecMatch(): Promise<{
    queuedCount: number;
    jobs: Array<{
      id: string;
      fileLabel: string;
      sourceCodec: string;
      targetCodec: string;
    }>;
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
