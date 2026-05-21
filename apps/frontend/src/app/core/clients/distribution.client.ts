import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export interface NodeCapacity {
  nodeId: string;
  nodeName: string;
  role: 'MAIN' | 'LINKED';
  maxWorkers: number;
  activeJobs: number;
  queuedJobs: number;
  availableSlots: number;
  estimatedFreeAt: string | null;
  isOverloaded: boolean;
  overloadReason?: string;
  loadAvg1m?: number;
  cpuCount?: number;
  freeMemoryGB?: number;
  totalMemoryGB?: number;
}

export interface CapacityResponse {
  nodes: NodeCapacity[];
}

export interface NodeJobCount {
  nodeId: string;
  nodeName: string;
  queued: number;
  encoding: number;
}

export interface DistributionSummary {
  totalNodes: number;
  onlineNodes: number;
  totalQueuedJobs: number;
  jobsPerNode: NodeJobCount[];
}

export interface RebalanceResult {
  success: boolean;
  migratedCount: number;
  reasons: string[];
}

@Injectable({ providedIn: 'root' })
export class DistributionClient {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/v1/distribution';

  /**
   * Get distribution summary for dashboard
   */
  getSummary(): Observable<DistributionSummary> {
    return this.http.get<DistributionSummary>(`${this.baseUrl}/summary`);
  }

  /**
   * Get capacity status for all online nodes
   */
  getCapacity(): Observable<CapacityResponse> {
    return this.http.get<CapacityResponse>(`${this.baseUrl}/capacity`);
  }

  /**
   * Rebalance queued jobs across nodes
   */
  rebalanceJobs(): Observable<RebalanceResult> {
    return this.http.post<RebalanceResult>(`${this.baseUrl}/rebalance`, {});
  }
}
