export type JobStatus = 'QUEUED' | 'ENCODING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

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

export interface QueueStats {
  queued: number;
  encoding: number;
  completed: number;
  failed: number;
  totalSavedBytes: string;
}

export interface QueueResponse {
  jobs: QueueJob[];
  stats: QueueStats;
}

export interface QueueFilters {
  status?: JobStatus;
  nodeId?: string;
  search?: string;
}
