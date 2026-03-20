export enum DiscoveryStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum AccelerationType {
  NVIDIA = 'NVIDIA',
  INTEL = 'INTEL',
  AMD = 'AMD',
  APPLE = 'APPLE',
  CPU = 'CPU',
}

export enum GPUVendor {
  NVIDIA = 'NVIDIA',
  INTEL = 'INTEL',
  AMD = 'AMD',
  APPLE = 'APPLE',
}

export interface GPUInfo {
  vendor: GPUVendor;
  model: string;
  memory: number;
  driverVersion: string;
}

export interface CPUInfo {
  model: string;
  cores: number;
  speed: number;
}

export interface MemoryInfo {
  total: number;
  free: number;
  used: number;
}

export interface HardwareCapabilities {
  gpus: GPUInfo[];
  cpu: CPUInfo;
  memory: MemoryInfo;
  platform: string;
  accelerationType: AccelerationType;
}

export interface DiscoveredNode {
  id: string;
  name: string;
  ipAddress: string;
  port: number;
  version: string;
  platform: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryGB: number;
  acceleration: string;
  discoveredAt: string;
  status: DiscoveryStatus;
  lastSeenAt: string;
  hardware?: HardwareCapabilities;
}

export enum NodeStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  ERROR = 'ERROR',
}

export enum SyncStatus {
  PENDING = 'PENDING',
  SYNCING = 'SYNCING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface ManagedNode {
  id: string;
  name: string;
  ipAddress: string;
  status: NodeStatus;
  currentJobId?: string;
  currentJobName?: string;
  cpuUsage?: number;
  memoryUsage?: number;
  activeJobs: number;
  completedJobs: number;
  approvedAt: string;

  // Policy Sync Fields
  lastSyncedAt?: string;
  syncStatus: SyncStatus;
  syncRetryCount?: number;
  syncError?: string;
}
