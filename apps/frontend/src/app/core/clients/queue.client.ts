import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { combineLatest, map, type Observable } from 'rxjs';
import { QueueJobBo } from '../../features/queue/bos/queue-job.bo';
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

    return combineLatest([
      this.http.get<QueueJobApiModel[]>(this.apiUrl, { params }),
      this.http.get<QueueStats>(`${this.apiUrl}/stats`),
    ]).pipe(
      map(([jobs, stats]) => ({
        jobs: jobs.map((job) => new QueueJobBo(job)),
        stats,
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
}
