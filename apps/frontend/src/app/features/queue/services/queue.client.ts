import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { combineLatest, map, type Observable } from 'rxjs';
import type { QueueFilters, QueueJob, QueueResponse, QueueStats } from '../models/queue.model';

@Injectable({
  providedIn: 'root',
})
export class QueueClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/queue';

  getQueue(filters?: QueueFilters): Observable<QueueResponse> {
    const params: Record<string, string> = {};
    if (filters?.status) params.status = filters.status;
    if (filters?.nodeId) params.nodeId = filters.nodeId;
    if (filters?.search) params.search = filters.search;

    // Combine jobs and stats into QueueResponse
    return combineLatest([
      this.http.get<QueueJob[]>(this.apiUrl, { params }),
      this.http.get<QueueStats>(`${this.apiUrl}/stats`),
    ]).pipe(map(([jobs, stats]) => ({ jobs, stats })));
  }

  cancelJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${jobId}/cancel`, {});
  }

  retryJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${jobId}/retry`, {});
  }
}
