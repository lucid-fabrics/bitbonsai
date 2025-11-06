import { NodeStatus } from '../../nodes/models/node.model';

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
