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

  // Container & Environment Detection (for storage configuration)
  containerType?: string | null;
  isPrivileged?: boolean;
  canMountNFS?: boolean;
  environmentDetectedAt?: string | null;

  // Hardware Capabilities
  cpuCores?: number | null;
  ramGB?: number | null;
  bandwidthMbps?: number | null;
  latencyMs?: number | null;
  lastSpeedTest?: string | null;
  hasGpu?: boolean;
  avgEncodingSpeed?: number | null;

  // Scheduling Fields
  scheduleEnabled?: boolean;
  scheduleWindows?: TimeWindow[] | null;
}

/**
 * Time window for node scheduling
 */
export interface TimeWindow {
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  startHour: number; // 0-23
  endHour: number; // 0-23
  startMinute?: number; // 0-59
  endMinute?: number; // 0-59
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
  mainNodeUrl?: string | null;
}

/**
 * Node Capabilities Response
 *
 * Returned by GET /nodes/:id/capabilities endpoint
 */
export interface NodeCapabilities {
  nodeId: string;
  nodeName: string;
  networkLocation: NetworkLocation | null;
  hasSharedStorage: boolean;
  storageBasePath: string | null;
  latencyMs: number | null;
  bandwidthMbps: number | null;
  cpuCores: number | null;
  ramGB: number | null;
  maxTransferSizeMB: number | null;
  lastSpeedTest: string | null;
  reasoning: string;
}

/**
 * Test status for capability tests
 */
export type CapabilityTestStatus = 'pending' | 'running' | 'success' | 'warning' | 'error';

/**
 * Individual capability test result
 */
export interface CapabilityTest {
  status: CapabilityTestStatus;
  message: string;
  details?: Record<string, unknown>;
  durationMs?: number;
}

/**
 * Node Capability Test Response
 *
 * Returned by POST /nodes/:id/test-capabilities endpoint
 */
export interface NodeCapabilityTestResult {
  nodeId: string;
  nodeName: string;
  networkLocation: NetworkLocation;
  hasSharedStorage: boolean;
  storageBasePath: string | null;
  latencyMs: number;
  isPrivateIP: boolean;
  reasoning: string;
  tests: {
    networkConnection: CapabilityTest;
    sharedStorage: CapabilityTest;
    hardwareDetection: CapabilityTest;
    networkType: CapabilityTest;
  };
}
