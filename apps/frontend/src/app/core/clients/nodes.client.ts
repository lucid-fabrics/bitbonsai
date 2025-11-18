import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { CurrentNode, Node } from '../../features/nodes/models/node.model';
import type { NodeScore } from '../../features/nodes/models/node-score.model';
import type {
  ApproveRequestDto,
  CreateRegistrationRequestDto,
  DiscoveredMainNode,
  RegistrationRequest,
  RejectRequestDto,
} from '../../features/nodes/models/registration-request.model';

export interface RegisterResponse {
  message: string;
  command: string;
  pairingToken: string;
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

export interface UpdateNodeRequest {
  name?: string;
  maxWorkers?: number;
  cpuLimit?: number;
}

export interface OptimalConfig {
  recommendedMaxWorkers: number;
  currentMaxWorkers: number;
  cpuCoresPerJob: number;
  estimatedLoadAverage: number;
  reasoning: string;
  summary: string;
  totalCpuCores: number;
  acceleration: string;
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
   * Get the current node information
   */
  getCurrentNode(): Observable<CurrentNode> {
    return this.http.get<CurrentNode>(`${this.apiUrl}/current`);
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
   * Get recommended optimal configuration for a node
   */
  getRecommendedConfig(id: string): Observable<OptimalConfig> {
    return this.http.get<OptimalConfig>(`${this.apiUrl}/${id}/recommended-config`);
  }

  /**
   * Update node configuration
   */
  updateNode(id: string, data: UpdateNodeRequest): Observable<Node> {
    return this.http.patch<Node>(`${this.apiUrl}/${id}`, data);
  }

  /**
   * Remove a node
   */
  deleteNode(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  /**
   * Unregister current node from its main node
   * Resets node to unconfigured state
   */
  unregisterSelf(): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/unregister-self`,
      {}
    );
  }

  // ============================================================================
  // DISCOVERY & REGISTRATION REQUEST METHODS
  // ============================================================================

  /**
   * Discover MAIN nodes on the network via mDNS
   */
  discoverMainNodes(): Observable<DiscoveredMainNode[]> {
    return this.http.get<DiscoveredMainNode[]>(`${this.apiUrl}/discovery/main-nodes`);
  }

  /**
   * Create a registration request from CHILD to MAIN node
   */
  createRegistrationRequest(data: CreateRegistrationRequestDto): Observable<RegistrationRequest> {
    return this.http.post<RegistrationRequest>(`${this.apiUrl}/registration-requests`, data);
  }

  /**
   * Get all pending registration requests (for MAIN node)
   */
  getPendingRequests(): Observable<RegistrationRequest[]> {
    return this.http.get<RegistrationRequest[]>(`${this.apiUrl}/registration-requests/pending`);
  }

  /**
   * Get a specific registration request
   */
  getRegistrationRequest(id: string): Observable<RegistrationRequest> {
    return this.http.get<RegistrationRequest>(`${this.apiUrl}/registration-requests/${id}`);
  }

  /**
   * Approve a registration request
   */
  approveRequest(id: string, data?: ApproveRequestDto): Observable<RegistrationRequest> {
    return this.http.post<RegistrationRequest>(
      `${this.apiUrl}/registration-requests/${id}/approve`,
      data || {}
    );
  }

  /**
   * Reject a registration request
   */
  rejectRequest(id: string, data: RejectRequestDto): Observable<RegistrationRequest> {
    return this.http.post<RegistrationRequest>(
      `${this.apiUrl}/registration-requests/${id}/reject`,
      data
    );
  }

  /**
   * Cancel a registration request (by ID)
   */
  cancelRequest(id: string): Observable<RegistrationRequest> {
    return this.http.delete<RegistrationRequest>(
      `${this.apiUrl}/registration-requests/${id}/cancel`
    );
  }

  /**
   * Cancel a registration request (by token)
   */
  cancelRequestByToken(token: string): Observable<RegistrationRequest> {
    return this.http.delete<RegistrationRequest>(
      `${this.apiUrl}/registration-requests/token/${token}/cancel`
    );
  }

  // ============================================================================
  // CAPABILITY TESTING METHODS
  // ============================================================================

  /**
   * Test node capabilities (run capability detection)
   */
  testCapabilities(nodeId: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${nodeId}/test-capabilities`, {});
  }

  /**
   * Get node capabilities summary
   */
  getNodeCapabilities(nodeId: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${nodeId}/capabilities`);
  }

  // ============================================================================
  // JOB ATTRIBUTION & SCHEDULING METHODS
  // ============================================================================

  /**
   * Get node scores for job attribution algorithm
   */
  getNodeScores(): Observable<NodeScore[]> {
    return this.http.get<NodeScore[]>(`${this.apiUrl}/scores`);
  }

  // ============================================================================
  // SSH KEY MANAGEMENT METHODS
  // ============================================================================

  /**
   * Get this node's SSH public key
   */
  getSshPublicKey(): Observable<{ publicKey: string }> {
    return this.http.get<{ publicKey: string }>(`${this.apiUrl}/ssh/public-key`);
  }

  /**
   * Add an authorized SSH key
   */
  addAuthorizedKey(
    publicKey: string,
    comment?: string
  ): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/ssh/authorized-keys`,
      { publicKey, comment }
    );
  }
}
