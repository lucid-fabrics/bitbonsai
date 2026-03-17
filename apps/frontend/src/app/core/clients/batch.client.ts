import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export interface BatchOperationResult {
  affectedCount: number;
  message?: string;
}

export interface BatchStatsResult {
  queued: number;
  encoding: number;
  paused: number;
  completed: number;
  failed: number;
  cancelled: number;
}

@Injectable({
  providedIn: 'root',
})
export class BatchClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/queue/batch';

  pauseAll(nodeId?: string): Observable<BatchOperationResult> {
    const params: Record<string, string> = {};
    if (nodeId) params.nodeId = nodeId;
    return this.http.post<BatchOperationResult>(`${this.apiUrl}/pause`, {}, { params });
  }

  resumeAll(nodeId?: string): Observable<BatchOperationResult> {
    const params: Record<string, string> = {};
    if (nodeId) params.nodeId = nodeId;
    return this.http.post<BatchOperationResult>(`${this.apiUrl}/resume`, {}, { params });
  }

  cancelAll(nodeId?: string): Observable<BatchOperationResult> {
    const params: Record<string, string> = {};
    if (nodeId) params.nodeId = nodeId;
    return this.http.post<BatchOperationResult>(`${this.apiUrl}/cancel`, {}, { params });
  }

  retryAllFailed(nodeId?: string): Observable<BatchOperationResult> {
    const params: Record<string, string> = {};
    if (nodeId) params.nodeId = nodeId;
    return this.http.post<BatchOperationResult>(`${this.apiUrl}/retry`, {}, { params });
  }

  deleteCompleted(olderThanDays?: number, nodeId?: string): Observable<BatchOperationResult> {
    const params: Record<string, string> = {};
    if (olderThanDays) params.olderThanDays = olderThanDays.toString();
    if (nodeId) params.nodeId = nodeId;
    return this.http.delete<BatchOperationResult>(`${this.apiUrl}/completed`, { params });
  }

  deleteFailed(nodeId?: string): Observable<BatchOperationResult> {
    const params: Record<string, string> = {};
    if (nodeId) params.nodeId = nodeId;
    return this.http.delete<BatchOperationResult>(`${this.apiUrl}/failed`, { params });
  }

  clearAll(confirmationToken: string): Observable<BatchOperationResult> {
    return this.http.delete<BatchOperationResult>(`${this.apiUrl}/clear`, {
      body: { confirmationToken },
    });
  }

  getStats(nodeId?: string): Observable<BatchStatsResult> {
    const params: Record<string, string> = {};
    if (nodeId) params.nodeId = nodeId;
    return this.http.get<BatchStatsResult>(`${this.apiUrl}/stats`, { params });
  }
}
