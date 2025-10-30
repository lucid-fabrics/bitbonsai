import { FileHealthStatus } from '../../libraries/models/library.model';
import { JobStatus } from './job-status.enum';

export interface QueueJob {
  id: string;
  fileName: string;
  filePath: string;
  libraryId: string;
  libraryName: string;
  policyName: string;
  status: JobStatus;
  progress: number; // 0-100
  etaSeconds?: number | null; // Estimated time remaining in seconds
  fps?: number | null; // Current encoding speed in frames per second
  originalSize: number;
  currentSize: number;
  savedSize: number;
  savedPercentage: number;
  nodeId: string;
  nodeName: string;
  createdAt: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
  sourceCodec?: string;
  targetCodec?: string;
  healthStatus?: FileHealthStatus;
  healthScore?: number; // 0-100
  healthMessage?: string;
  retryCount?: number; // Number of retry attempts (max 3)
  nextRetryAt?: string; // When to retry next (for exponential backoff)
  priority?: number; // 0=normal, 1=high, 2=top (max 3 top priority at once)
  prioritySetAt?: string; // When priority was last changed
}
