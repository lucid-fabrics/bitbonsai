import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { DiscoveredNode, ManagedNode } from '../models/discovery.model';

export interface ApproveNodeRequest {
  discoveredNodeId: string;
}

export interface ApproveNodeResponse {
  success: boolean;
  nodeId: string;
  message: string;
}

export interface RejectNodeRequest {
  discoveredNodeId: string;
}

export interface RejectNodeResponse {
  success: boolean;
  message: string;
}

@Injectable({
  providedIn: 'root',
})
export class DiscoveryClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/discovery';

  /**
   * Get all discovered nodes (pending approval)
   */
  getDiscoveredNodes(): Observable<DiscoveredNode[]> {
    return this.http.get<DiscoveredNode[]>(`${this.apiUrl}/discovered-nodes`);
  }

  /**
   * Get all managed (approved) nodes
   */
  getManagedNodes(): Observable<ManagedNode[]> {
    return this.http.get<ManagedNode[]>(`${this.apiUrl}/managed-nodes`);
  }

  /**
   * Approve a discovered node and add it to the network
   */
  approveNode(request: ApproveNodeRequest): Observable<ApproveNodeResponse> {
    return this.http.post<ApproveNodeResponse>(`${this.apiUrl}/approve`, request);
  }

  /**
   * Reject a discovered node (ignore/remove from discovery list)
   */
  rejectNode(request: RejectNodeRequest): Observable<RejectNodeResponse> {
    return this.http.post<RejectNodeResponse>(`${this.apiUrl}/reject`, request);
  }
}
