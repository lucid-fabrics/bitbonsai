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
