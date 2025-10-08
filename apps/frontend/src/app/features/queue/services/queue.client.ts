import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { combineLatest, map, type Observable } from 'rxjs';
import { QueueJobBo } from '../bos/queue-job.bo';
import type { QueueFilters } from '../models/queue-filters.model';
import type { QueueJobApiModel } from '../models/queue-job-api.model';
import type { QueueResponse } from '../models/queue-response.model';
import type { QueueStats } from '../models/queue-stats.model';

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

  cancelJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${jobId}/cancel`, {});
  }

  retryJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${jobId}/retry`, {});
  }
}
