import type { JobStatus } from './queue.model';

/**
 * API response model for queue jobs
 */
export interface QueueJobApiModel {
  id: string;
  fileLabel?: string;
  fileName?: string;
  filePath: string;
  library?: { name: string };
  libraryName?: string;
  policy?: { name: string };
  policyName?: string;
  stage?: JobStatus;
  status?: JobStatus;
  progress: number;
  etaSeconds?: number | null;
  beforeSizeBytes?: string;
  afterSizeBytes?: string;
  savedBytes?: string;
  savedPercent?: number;
  originalSize?: number;
  currentSize?: number;
  savedSize?: number;
  savedPercentage?: number;
  node?: { name: string };
  nodeName?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  sourceCodec?: string;
  targetCodec?: string;
}
