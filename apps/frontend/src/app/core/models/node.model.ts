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
  NONE = 'NONE',
  NVIDIA = 'NVIDIA',
  INTEL = 'INTEL',
  AMD = 'AMD',
  APPLE = 'APPLE',
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
}
