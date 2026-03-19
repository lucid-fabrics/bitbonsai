import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import {
  NodesClient,
  type OptimalConfig,
  type PairRequest,
  type PairResponse,
  type RegisterResponse,
  type UpdateNodeRequest,
} from '../../../core/clients/nodes.client';
import type {
  CurrentNode,
  Node,
  NodeCapabilities,
  NodeCapabilityTestResult,
} from '../models/node.model';
import type { NodeScore } from '../models/node-score.model';
import type {
  ApproveRequestDto,
  CreateRegistrationRequestDto,
  DiscoveredMainNode,
  RegistrationRequest,
  RejectRequestDto,
} from '../models/registration-request.model';

@Injectable({
  providedIn: 'root',
})
export class NodesService {
  private readonly nodesClient = inject(NodesClient);

  getNodes(): Observable<Node[]> {
    return this.nodesClient.getNodes();
  }

  getCurrentNode(): Observable<CurrentNode> {
    return this.nodesClient.getCurrentNode();
  }

  getNode(id: string): Observable<Node> {
    return this.nodesClient.getNode(id);
  }

  register(): Observable<RegisterResponse> {
    return this.nodesClient.register();
  }

  pair(request: PairRequest): Observable<PairResponse> {
    return this.nodesClient.pair(request);
  }

  getNodeStats(id: string): Observable<{
    nodeId: string;
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    activeJobs: number;
    completedJobs: number;
    failedJobs: number;
  }> {
    return this.nodesClient.getNodeStats(id);
  }

  getRecommendedConfig(id: string): Observable<OptimalConfig> {
    return this.nodesClient.getRecommendedConfig(id);
  }

  updateNode(id: string, data: UpdateNodeRequest): Observable<Node> {
    return this.nodesClient.updateNode(id, data);
  }

  deleteNode(id: string): Observable<void> {
    return this.nodesClient.deleteNode(id);
  }

  unregisterSelf(): Observable<{ success: boolean; message: string }> {
    return this.nodesClient.unregisterSelf();
  }

  discoverMainNodes(): Observable<DiscoveredMainNode[]> {
    return this.nodesClient.discoverMainNodes();
  }

  createRegistrationRequest(data: CreateRegistrationRequestDto): Observable<RegistrationRequest> {
    return this.nodesClient.createRegistrationRequest(data);
  }

  getPendingRequests(): Observable<RegistrationRequest[]> {
    return this.nodesClient.getPendingRequests();
  }

  getRegistrationRequest(id: string): Observable<RegistrationRequest> {
    return this.nodesClient.getRegistrationRequest(id);
  }

  approveRequest(id: string, data?: ApproveRequestDto): Observable<RegistrationRequest> {
    return this.nodesClient.approveRequest(id, data);
  }

  rejectRequest(id: string, data: RejectRequestDto): Observable<RegistrationRequest> {
    return this.nodesClient.rejectRequest(id, data);
  }

  cancelRequest(id: string): Observable<RegistrationRequest> {
    return this.nodesClient.cancelRequest(id);
  }

  cancelRequestByToken(token: string): Observable<RegistrationRequest> {
    return this.nodesClient.cancelRequestByToken(token);
  }

  testCapabilities(nodeId: string): Observable<NodeCapabilityTestResult> {
    return this.nodesClient.testCapabilities(nodeId);
  }

  getNodeCapabilities(nodeId: string): Observable<NodeCapabilities> {
    return this.nodesClient.getNodeCapabilities(nodeId);
  }

  getNodeScores(): Observable<NodeScore[]> {
    return this.nodesClient.getNodeScores();
  }

  getSshPublicKey(): Observable<{ publicKey: string }> {
    return this.nodesClient.getSshPublicKey();
  }

  addAuthorizedKey(
    publicKey: string,
    comment?: string
  ): Observable<{ success: boolean; message: string }> {
    return this.nodesClient.addAuthorizedKey(publicKey, comment);
  }
}
