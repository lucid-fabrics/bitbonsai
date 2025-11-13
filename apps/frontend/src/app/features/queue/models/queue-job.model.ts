import { FileHealthStatus } from '../../libraries/models/library.model';
import { JobStatus } from './job-status.enum';

export type JobType = 'ENCODE' | 'REMUX';

export interface QueueJob {
  id: string;
  fileName: string;
  filePath: string;
  libraryId: string;
  libraryName: string;
  policyName: string;
  status: JobStatus;
  type: JobType; // ENCODE = full transcode, REMUX = container change only
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
  autoHealedAt?: string; // ISO timestamp when job was auto-healed by system restart
  autoHealedProgress?: number; // Progress % when healing occurred (for green dot indicator, 0-100)
  // Keep Original Feature
  keepOriginalRequested?: boolean;
  originalBackupPath?: string | null;
  originalSizeBytes?: number | null;
  replacementAction?: 'REPLACED' | 'KEPT_BOTH' | null;
  // Encoding Preview Feature
  previewImagePaths?: string | null; // JSON array of preview image paths
  // Health Check Decision Feature
  decisionRequired?: boolean; // Does this job require user decision before proceeding?
  decisionIssues?: string | null; // JSON array of HealthCheckIssue objects requiring decisions
  decisionMadeAt?: string | null; // When user resolved the decision
  decisionData?: string | null; // JSON object with user's decision choices
  // File Missing Badge Feature
  stage?: string; // Job stage from backend (FAILED, QUEUED, etc.)
  fileExists?: boolean; // Does the source file still exist on disk? (for FAILED jobs)
}
