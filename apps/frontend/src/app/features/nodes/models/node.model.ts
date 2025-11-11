export enum NodeRole {
  MAIN = 'MAIN',
  LINKED = 'LINKED',
}

export enum NodeStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  ERROR = 'ERROR',
}

export enum AccelerationType {
  CPU = 'CPU',
  INTEL_QSV = 'INTEL_QSV',
  NVIDIA = 'NVIDIA',
  AMD = 'AMD',
  APPLE_M = 'APPLE_M',
}

export enum NetworkLocation {
  LOCAL = 'LOCAL',
  REMOTE = 'REMOTE',
  UNKNOWN = 'UNKNOWN',
}

export interface Node {
  id: string;
  name: string;
  role: NodeRole;
  status: NodeStatus;
  version: string;
  acceleration: AccelerationType;
  lastHeartbeat: string;
  uptimeSeconds: number;
  createdAt: string;
  activeJobCount?: number;
  maxWorkers: number;
  cpuLimit: number;

  // Hybrid Architecture Fields
  networkLocation?: NetworkLocation;
  hasSharedStorage?: boolean;
  storageBasePath?: string | null;
  publicUrl?: string | null;
  vpnIpAddress?: string | null;
  maxTransferSizeMB?: number;

  // Hardware Capabilities
  cpuCores?: number | null;
  ramGB?: number | null;
  bandwidthMbps?: number | null;
  latencyMs?: number | null;
  lastSpeedTest?: string | null;
}

/**
 * Current Node Information
 *
 * Represents the currently running node instance.
 * Used to determine UI restrictions based on node role.
 */
export interface CurrentNode {
  id: string;
  name: string;
  role: NodeRole;
  status: NodeStatus;
  version: string;
  acceleration: AccelerationType;
}
