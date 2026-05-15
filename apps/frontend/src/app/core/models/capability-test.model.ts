/**
 * Network Location Types
 */
export enum NetworkLocation {
  LOCAL = 'LOCAL',
  REMOTE = 'REMOTE',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Test Result Status
 */
export type TestStatus = 'pending' | 'running' | 'success' | 'warning' | 'error';

/**
 * Individual Test Result
 */
export interface TestResult {
  status: TestStatus;
  message: string;
  details?: Record<string, unknown>;
  durationMs?: number;
}

/**
 * Complete Capability Test Result
 */
export interface CapabilityTestResult {
  networkLocation: NetworkLocation;
  hasSharedStorage: boolean;
  storageBasePath: string | null;
  latencyMs: number | null;
  bandwidthMbps: number | null;
  isPrivateIP: boolean;
  reasoning: string;
  tests: {
    networkConnection: TestResult;
    sharedStorage: TestResult;
    hardwareDetection: TestResult;
    networkType: TestResult;
  };
}

/**
 * Capability Test Progress
 */
export interface CapabilityTestProgress {
  currentPhase: number; // 1-4
  totalPhases: number; // 4
  progress: number; // 0-100
  currentTest: string;
  results: CapabilityTestResult | null;
  isComplete: boolean;
  error: string | null;
}

/**
 * Node Capabilities Summary
 */
export interface NodeCapabilities {
  nodeId: string;
  nodeName: string;
  networkLocation: NetworkLocation;
  hasSharedStorage: boolean;
  storageBasePath: string | null;
  latencyMs: number | null;
  bandwidthMbps: number | null;
  cpuCores: number | null;
  ramGB: number | null;
  maxTransferSizeMB: number;
  lastSpeedTest: string | null;
  reasoning: string;
}
