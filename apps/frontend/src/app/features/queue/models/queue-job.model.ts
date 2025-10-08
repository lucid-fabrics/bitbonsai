import type { JobStatus } from './job-status.type';

export interface QueueJob {
  id: string;
  fileName: string;
  filePath: string;
  libraryName: string;
  policyName: string;
  status: JobStatus;
  progress: number; // 0-100
  etaSeconds?: number | null; // Estimated time remaining in seconds
  originalSize: number;
  currentSize: number;
  savedSize: number;
  savedPercentage: number;
  nodeId: string;
  nodeName: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  sourceCodec?: string;
  targetCodec?: string;
}
