import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { combineLatest, map, type Observable } from 'rxjs';
import { QueueJobBo } from '../../features/queue/bos/queue-job.bo';
import type { JobHistoryEvent } from '../../features/queue/models/job-history-event.model';
import type { QueueFilters } from '../../features/queue/models/queue-filters.model';
import type { QueueJobApiModel } from '../../features/queue/models/queue-job-api.model';
import type { QueueResponse } from '../../features/queue/models/queue-response.model';
import type { QueueStats } from '../../features/queue/models/queue-stats.model';

@Injectable({
  providedIn: 'root',
})
export class QueueClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/queue';

  getQueue(filters?: QueueFilters): Observable<QueueResponse> {
    const params: Record<string, string> = {};
    if (filters?.status) params.stage = filters.status; // Backend expects 'stage' not 'status'
    if (filters?.nodeId) params.nodeId = filters.nodeId;
    if (filters?.libraryId) params.libraryId = filters.libraryId;
    if (filters?.search) params.search = filters.search;
    if (filters?.page) params.page = filters.page.toString();
    if (filters?.limit) params.limit = filters.limit.toString();

    return combineLatest([
      this.http.get<{
        jobs: QueueJobApiModel[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      }>(this.apiUrl, { params }),
      this.http.get<QueueStats>(`${this.apiUrl}/stats`),
    ]).pipe(
      map(([response, stats]) => ({
        jobs: response.jobs.map((job) => new QueueJobBo(job)),
        stats,
        total: response.total,
        page: response.page,
        limit: response.limit,
        totalPages: response.totalPages,
      }))
    );
  }

  cancelJob(jobId: string, blacklist = false): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${jobId}/cancel`, { blacklist });
  }

  cancelAllQueued(): Observable<{ cancelledCount: number }> {
    return this.http.post<{ cancelledCount: number }>(`${this.apiUrl}/cancel-all`, {});
  }

  retryJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${jobId}/retry`, {});
  }

  recheckJob(jobId: string): Observable<QueueJobApiModel> {
    return this.http.post<QueueJobApiModel>(`${this.apiUrl}/${jobId}/recheck`, {});
  }

  detectAndRequeue(jobId: string): Observable<QueueJobApiModel> {
    return this.http.post<QueueJobApiModel>(`${this.apiUrl}/${jobId}/detect-and-requeue`, {});
  }

  retryAllCancelled(): Observable<{
    retriedCount: number;
    totalSizeBytes: string;
    jobs: Array<{ id: string; fileLabel: string; beforeSizeBytes: string }>;
  }> {
    return this.http.post<{
      retriedCount: number;
      totalSizeBytes: string;
      jobs: Array<{ id: string; fileLabel: string; beforeSizeBytes: string }>;
    }>(`${this.apiUrl}/retry-all-cancelled`, {});
  }

  retryAllFailed(errorFilter?: string): Observable<{
    retriedCount: number;
    jobs: Array<{ id: string; fileLabel: string; error: string }>;
  }> {
    const params: Record<string, string> = {};
    if (errorFilter) {
      params.errorFilter = errorFilter;
    }
    return this.http.post<{
      retriedCount: number;
      jobs: Array<{ id: string; fileLabel: string; error: string }>;
    }>(`${this.apiUrl}/retry-all-failed`, {}, { params });
  }

  unblacklistJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${jobId}/unblacklist`, {});
  }

  pauseJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${jobId}/pause`, {});
  }

  resumeJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${jobId}/resume`, {});
  }

  forceStartJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${jobId}/force-start`, {});
  }

  clearJobs(stages?: string[]): Observable<{ deleted: number }> {
    const options = stages && stages.length > 0 ? { params: { stages: stages.join(',') } } : {};
    return this.http.post<{ deleted: number }>(`${this.apiUrl}/clear`, {}, options);
  }

  updateJobPriority(jobId: string, priority: number): Observable<QueueJobApiModel> {
    return this.http.patch<QueueJobApiModel>(`${this.apiUrl}/${jobId}/priority`, { priority });
  }

  keepOriginal(jobId: string): Observable<QueueJobApiModel> {
    return this.http.post<QueueJobApiModel>(`${this.apiUrl}/${jobId}/keep-original`, {});
  }

  deleteOriginal(jobId: string): Observable<{ freedSpace: string }> {
    return this.http.delete<{ freedSpace: string }>(`${this.apiUrl}/${jobId}/original`);
  }

  restoreOriginal(jobId: string): Observable<QueueJobApiModel> {
    return this.http.post<QueueJobApiModel>(`${this.apiUrl}/${jobId}/restore-original`, {});
  }

  deleteJob(jobId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${jobId}`);
  }

  /**
   * Get job failure/event history timeline
   *
   * Fetches the complete history of all failure, cancellation, restart, and auto-heal events for a job.
   * Returns events in reverse chronological order (newest first).
   *
   * @param jobId - ID of the job to get history for
   * @returns Observable of job history events array
   */
  getJobHistory(jobId: string): Observable<JobHistoryEvent[]> {
    return this.http.get<JobHistoryEvent[]>(`${this.apiUrl}/${jobId}/history`);
  }

  /**
   * Manually capture a preview screenshot at current encoding progress
   *
   * Triggers a manual preview capture from the temp file at the current progress.
   * User-initiated via "Capture Now" button.
   *
   * @param jobId - ID of the job to capture preview for
   * @returns Observable of updated job with new preview path
   */
  capturePreview(jobId: string): Observable<QueueJobApiModel> {
    return this.http.post<QueueJobApiModel>(`${this.apiUrl}/${jobId}/preview/capture`, {});
  }
}
