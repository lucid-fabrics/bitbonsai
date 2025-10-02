export type JobStatus = 'QUEUED' | 'ENCODING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface QueueJob {
  id: string;
  fileName: string;
  filePath: string;
  libraryName: string;
  policyName: string;
  status: JobStatus;
  progress: number; // 0-100
  originalSize: number;
  currentSize: number;
  savedSize: number;
  savedPercentage: number;
  nodeName: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
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
