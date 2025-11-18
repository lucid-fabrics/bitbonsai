import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export enum StorageProtocol {
  NFS = 'NFS',
  SMB = 'SMB',
}

export enum StorageShareStatus {
  AVAILABLE = 'AVAILABLE',
  MOUNTED = 'MOUNTED',
  UNMOUNTED = 'UNMOUNTED',
  ERROR = 'ERROR',
  TESTING = 'TESTING',
}

export interface StorageShare {
  id: string;
  name: string;
  protocol: StorageProtocol;
  status: StorageShareStatus;
  serverAddress: string;
  sharePath: string;
  exportPath?: string;
  mountPoint: string;
  mountOptions?: string;
  readOnly: boolean;

  // SMB-specific fields
  smbUsername?: string;
  smbPassword?: string;
  smbDomain?: string;
  smbVersion?: string;

  // Auto-mount configuration
  autoMount: boolean;
  addToFstab: boolean;
  mountOnDetection: boolean;
  autoManaged: boolean; // System-managed share (from Docker volumes)

  // Health & Status
  isMounted: boolean;
  lastMountAt?: Date;
  lastUnmountAt?: Date;
  lastHealthCheckAt?: Date;
  lastError?: string;
  errorCount: number;

  // Capability Detection
  isReachable: boolean;
  supportsNFS: boolean;
  supportsSMB: boolean;
  detectedAt?: Date;

  // Storage Usage
  totalSizeBytes?: bigint;
  availableSizeBytes?: bigint;
  usedPercent?: number;

  // Relations
  nodeId: string;
  ownerNodeId?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateStorageShareRequest {
  nodeId: string;
  name: string;
  protocol: StorageProtocol;
  serverAddress: string;
  sharePath: string;
  mountPoint: string;
  readOnly?: boolean;
  mountOptions?: string;

  // SMB-specific fields
  smbUsername?: string;
  smbPassword?: string;
  smbDomain?: string;
  smbVersion?: string;

  // Auto-mount configuration
  autoMount?: boolean;
  addToFstab?: boolean;
  mountOnDetection?: boolean;

  // Owner node (if sharing from this node)
  ownerNodeId?: string;
}

export interface UpdateStorageShareRequest {
  name?: string;
  mountOptions?: string;
  readOnly?: boolean;
  autoMount?: boolean;
  addToFstab?: boolean;
  mountOnDetection?: boolean;

  // SMB credentials
  smbUsername?: string;
  smbPassword?: string;
  smbDomain?: string;
  smbVersion?: string;
}

export interface MountResult {
  success: boolean;
  message: string;
  error?: string;
}

export interface ShareConnectivityTest {
  isReachable: boolean;
  supportsNFS: boolean;
  supportsSMB: boolean;
  latencyMs?: number;
  error?: string;
}

export interface StorageShareStats {
  totalShares: number;
  mountedShares: number;
  availableShares: number;
  errorShares: number;
  totalCapacityBytes: bigint;
  usedCapacityBytes: bigint;
}

export interface DiskUsage {
  totalBytes: bigint;
  availableBytes: bigint;
  usedPercent: number;
}

@Injectable({
  providedIn: 'root',
})
export class StorageSharesClient {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/storage-shares';

  /**
   * Create a new storage share
   */
  createShare(request: CreateStorageShareRequest): Observable<StorageShare> {
    return this.http.post<StorageShare>(this.apiUrl, request);
  }

  /**
   * Get all storage shares for a node
   */
  getSharesByNode(nodeId: string): Observable<StorageShare[]> {
    return this.http.get<StorageShare[]>(`${this.apiUrl}/node/${nodeId}`);
  }

  /**
   * Get mounted shares for a node
   */
  getMountedSharesByNode(nodeId: string): Observable<StorageShare[]> {
    return this.http.get<StorageShare[]>(`${this.apiUrl}/node/${nodeId}/mounted`);
  }

  /**
   * Get a specific storage share by ID
   */
  getShare(id: string): Observable<StorageShare> {
    return this.http.get<StorageShare>(`${this.apiUrl}/${id}`);
  }

  /**
   * Update storage share configuration
   */
  updateShare(id: string, request: UpdateStorageShareRequest): Observable<StorageShare> {
    return this.http.patch<StorageShare>(`${this.apiUrl}/${id}`, request);
  }

  /**
   * Delete storage share
   */
  deleteShare(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  /**
   * Mount a storage share
   */
  mountShare(id: string): Observable<MountResult> {
    return this.http.post<MountResult>(`${this.apiUrl}/${id}/mount`, {});
  }

  /**
   * Unmount a storage share
   */
  unmountShare(id: string, force: boolean = false): Observable<MountResult> {
    return this.http.post<MountResult>(`${this.apiUrl}/${id}/unmount`, { force });
  }

  /**
   * Remount a storage share
   */
  remountShare(id: string): Observable<MountResult> {
    return this.http.post<MountResult>(`${this.apiUrl}/${id}/remount`, {});
  }

  /**
   * Test connectivity to a storage server
   */
  testConnectivity(
    serverAddress: string,
    protocol?: StorageProtocol
  ): Observable<ShareConnectivityTest> {
    return this.http.post<ShareConnectivityTest>(`${this.apiUrl}/test-connectivity`, {
      serverAddress,
      protocol,
    });
  }

  /**
   * Get storage statistics for a node
   */
  getNodeStats(nodeId: string): Observable<StorageShareStats> {
    return this.http.get<StorageShareStats>(`${this.apiUrl}/node/${nodeId}/stats`);
  }

  /**
   * Auto-detect available storage shares
   */
  autoDetectShares(nodeId: string): Observable<StorageShare[]> {
    return this.http.post<StorageShare[]>(`${this.apiUrl}/node/${nodeId}/auto-detect`, {});
  }

  /**
   * Get disk usage for a share
   */
  getDiskUsage(id: string): Observable<DiskUsage> {
    return this.http.get<DiskUsage>(`${this.apiUrl}/${id}/disk-usage`);
  }

  /**
   * Auto-export Docker volumes (MAIN node only)
   */
  autoExportDockerVolumes(): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/auto-export-docker-volumes`,
      {}
    );
  }
}
