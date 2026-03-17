import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  EnvironmentInfo,
  StorageRecommendation,
} from '../../features/nodes/models/storage-recommendation.model';

@Injectable({
  providedIn: 'root',
})
export class EnvironmentDetectionService {
  private readonly baseUrl = '/api/v1/nodes';

  constructor(private http: HttpClient) {}

  /**
   * Detect the current node's environment
   * Returns container type, privileges, NFS capabilities, network subnet, and hostname
   */
  detectEnvironment(): Observable<EnvironmentInfo> {
    return this.http.get<EnvironmentInfo>(`${this.baseUrl}/environment`);
  }

  /**
   * Get storage method recommendation for two nodes
   * Analyzes both nodes and recommends NFS, RSYNC, or EITHER
   */
  getStorageRecommendation(
    sourceNodeId: string,
    targetNodeId: string
  ): Observable<StorageRecommendation> {
    return this.http.post<StorageRecommendation>(`${this.baseUrl}/storage-recommendation`, {
      sourceNodeId,
      targetNodeId,
    });
  }

  /**
   * Update a node's environment information
   * Typically called after detecting environment to persist results
   */
  updateNodeEnvironment(nodeId: string, environment: EnvironmentInfo): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/${nodeId}/environment`, {
      containerType: environment.containerType,
      isPrivileged: environment.isPrivileged,
      canMountNFS: environment.canMountNFS,
      networkLocation: environment.networkSubnet,
    });
  }
}
