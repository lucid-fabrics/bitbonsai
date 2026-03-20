import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';
import { QueueClient } from '../../../core/clients/queue.client';
import { QueueJobBo } from '../bos/queue-job.bo';
import type { JobHistoryEvent } from '../models/job-history-event.model';
import type { QueueFilters } from '../models/queue-filters.model';
import type { QueueJobApiModel } from '../models/queue-job-api.model';
import type { QueueResponse } from '../models/queue-response.model';

@Injectable({
  providedIn: 'root',
})
export class QueueService {
  private readonly queueClient = inject(QueueClient);

  getQueue(filters?: QueueFilters): Observable<QueueResponse> {
    return this.queueClient.getQueue(filters).pipe(
      map((raw) => ({
        ...raw,
        jobs: raw.jobs.map((job) => new QueueJobBo(job)),
      }))
    );
  }

  cancelJob(jobId: string, blacklist = false): Observable<void> {
    return this.queueClient.cancelJob(jobId, blacklist);
  }

  cancelAllQueued(): Observable<{ cancelledCount: number }> {
    return this.queueClient.cancelAllQueued();
  }

  retryJob(jobId: string): Observable<void> {
    return this.queueClient.retryJob(jobId);
  }

  recheckJob(jobId: string): Observable<QueueJobBo> {
    return this.queueClient.recheckJob(jobId).pipe(map((job) => new QueueJobBo(job)));
  }

  detectAndRequeue(jobId: string): Observable<QueueJobBo> {
    return this.queueClient.detectAndRequeue(jobId).pipe(map((job) => new QueueJobBo(job)));
  }

  retryAllCancelled(): Observable<{
    retriedCount: number;
    totalSizeBytes: string;
    jobs: Array<{ id: string; fileLabel: string; beforeSizeBytes: string }>;
  }> {
    return this.queueClient.retryAllCancelled();
  }

  retryAllFailed(errorFilter?: string): Observable<{
    retriedCount: number;
    jobs: Array<{ id: string; fileLabel: string; error: string }>;
  }> {
    return this.queueClient.retryAllFailed(errorFilter);
  }

  unblacklistJob(jobId: string): Observable<void> {
    return this.queueClient.unblacklistJob(jobId);
  }

  pauseJob(jobId: string): Observable<void> {
    return this.queueClient.pauseJob(jobId);
  }

  resumeJob(jobId: string): Observable<void> {
    return this.queueClient.resumeJob(jobId);
  }

  forceStartJob(jobId: string): Observable<void> {
    return this.queueClient.forceStartJob(jobId);
  }

  clearJobs(stages?: string[]): Observable<{ deleted: number }> {
    return this.queueClient.clearJobs(stages);
  }

  rebalanceJobs(): Observable<{ jobsRebalanced: number; message: string }> {
    return this.queueClient.rebalanceJobs();
  }

  updateJobPriority(jobId: string, priority: number): Observable<QueueJobBo> {
    return this.queueClient
      .updateJobPriority(jobId, priority)
      .pipe(map((job) => new QueueJobBo(job)));
  }

  keepOriginal(jobId: string): Observable<QueueJobBo> {
    return this.queueClient.keepOriginal(jobId).pipe(map((job) => new QueueJobBo(job)));
  }

  deleteOriginal(jobId: string): Observable<{ freedSpace: string }> {
    return this.queueClient.deleteOriginal(jobId);
  }

  restoreOriginal(jobId: string): Observable<QueueJobBo> {
    return this.queueClient.restoreOriginal(jobId).pipe(map((job) => new QueueJobBo(job)));
  }

  deleteJob(jobId: string): Observable<void> {
    return this.queueClient.deleteJob(jobId);
  }

  resolveDecision(jobId: string, actionConfig: Record<string, unknown>): Observable<QueueJobBo> {
    return this.queueClient
      .resolveDecision(jobId, actionConfig)
      .pipe(map((job) => new QueueJobBo(job)));
  }

  skipAllCodecMatch(): Observable<{
    skippedCount: number;
    jobs: Array<{ id: string; fileLabel: string; sourceCodec: string; targetCodec: string }>;
  }> {
    return this.queueClient.skipAllCodecMatch();
  }

  forceEncodeAllCodecMatch(): Observable<{
    queuedCount: number;
    jobs: Array<{ id: string; fileLabel: string; sourceCodec: string; targetCodec: string }>;
  }> {
    return this.queueClient.forceEncodeAllCodecMatch();
  }

  delegateJob(jobId: string, targetNodeId: string): Observable<QueueJobBo> {
    return this.queueClient
      .delegateJob(jobId, targetNodeId)
      .pipe(map((job) => new QueueJobBo(job)));
  }

  getJobHistory(jobId: string): Observable<JobHistoryEvent[]> {
    return this.queueClient.getJobHistory(jobId);
  }

  capturePreview(jobId: string): Observable<QueueJobBo> {
    return this.queueClient.capturePreview(jobId).pipe(map((job) => new QueueJobBo(job)));
  }

  getActiveTransfers(): Observable<QueueJobApiModel[]> {
    return this.queueClient.getActiveTransfers();
  }

  getTransferProgress(jobId: string): Observable<{
    progress: number;
    speedMBps: number;
    etaSeconds: number;
  }> {
    return this.queueClient.getTransferProgress(jobId);
  }

  cancelTransfer(jobId: string): Observable<void> {
    return this.queueClient.cancelTransfer(jobId);
  }
}
