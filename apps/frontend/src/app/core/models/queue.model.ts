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
  totalJobs: number;
  queuedJobs: number;
  encodingJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalSavings: number;
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
