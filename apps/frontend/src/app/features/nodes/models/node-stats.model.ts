import type { AccelerationType, NodeRole, NodeStatus } from './node.model';

export interface LibraryStats {
  id: string;
  name: string;
  totalFiles: number;
  totalSizeBytes: number;
  mediaType: string;
}

export interface LicenseStats {
  tier: string;
  maxConcurrentJobs: number;
  maxNodes: number;
  status: string;
}

export interface NodeStats {
  id: string;
  name: string;
  role: NodeRole;
  status: NodeStatus;
  version: string;
  acceleration: AccelerationType;
  lastHeartbeat: string;
  uptimeSeconds: number;
  createdAt: string;
  license?: LicenseStats;
  libraries?: LibraryStats[];
  activeJobCount?: number;
}
