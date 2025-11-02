import { JobStatus } from './job-status.enum';

/**
 * API response model for queue jobs
 */
export interface QueueJobApiModel {
  id: string;
  fileLabel?: string;
  fileName?: string;
  filePath: string;
  library?: { id: string; name: string };
  libraryId?: string;
  libraryName?: string;
  policy?: { name: string };
  policyName?: string;
  stage?: JobStatus;
  status?: JobStatus;
  progress: number;
  etaSeconds?: number | null;
  fps?: number | null;
  beforeSizeBytes?: string;
  afterSizeBytes?: string;
  savedBytes?: string;
  savedPercent?: number;
  originalSize?: number;
  currentSize?: number;
  savedSize?: number;
  savedPercentage?: number;
  node?: { id: string; name: string };
  nodeId?: string;
  nodeName?: string;
  createdAt: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
  sourceCodec?: string;
  targetCodec?: string;
  retryCount?: number;
  nextRetryAt?: string;
  priority?: number;
  prioritySetAt?: string;
  autoHealedAt?: string;
  autoHealedProgress?: number;
  // Keep Original Feature
  keepOriginalRequested?: boolean;
  originalBackupPath?: string | null;
  originalSizeBytes?: string | null;
  replacementAction?: 'REPLACED' | 'KEPT_BOTH' | null;
}
