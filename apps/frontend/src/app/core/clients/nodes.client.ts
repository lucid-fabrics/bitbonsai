import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { Node } from '../../features/nodes/models/node.model';

export interface RegisterResponse {
  message: string;
  command: string;
  expiresIn: number;
}

export interface PairRequest {
  code: string;
}

export interface PairResponse {
  success: boolean;
  node: Node;
}

export interface NodeStats {
  nodeId: string;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
}

@Injectable({
  providedIn: 'root',
})
export class NodesClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/nodes';

  /**
   * Get all nodes
   */
  getNodes(): Observable<Node[]> {
    return this.http.get<Node[]>(this.apiUrl);
  }

  /**
   * Get a specific node by ID
   */
  getNode(id: string): Observable<Node> {
    return this.http.get<Node>(`${this.apiUrl}/${id}`);
  }

  /**
   * Initiate node registration and get pairing instructions
   */
  register(): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${this.apiUrl}/register`, {});
  }

  /**
   * Complete node pairing with 6-digit code
   */
  pair(request: PairRequest): Observable<PairResponse> {
    return this.http.post<PairResponse>(`${this.apiUrl}/pair`, request);
  }

  /**
   * Get node statistics
   */
  getNodeStats(id: string): Observable<NodeStats> {
    return this.http.get<NodeStats>(`${this.apiUrl}/${id}/stats`);
  }

  /**
   * Remove a node
   */
  deleteNode(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
