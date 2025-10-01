import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { QueueFilters, QueueResponse } from '../models/queue.model';

@Injectable({
  providedIn: 'root',
})
export class QueueApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/queue';

  getQueue(filters?: QueueFilters): Observable<QueueResponse> {
    const params: Record<string, string> = {};
    if (filters?.status) params.status = filters.status;
    if (filters?.nodeId) params.nodeId = filters.nodeId;
    if (filters?.search) params.search = filters.search;

    return this.http.get<QueueResponse>(this.apiUrl, { params });
  }

  cancelJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${jobId}/cancel`, {});
  }

  retryJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${jobId}/retry`, {});
  }
}
