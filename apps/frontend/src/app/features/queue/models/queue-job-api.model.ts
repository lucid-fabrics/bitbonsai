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
  originalNodeId?: string | null;
  manualAssignment?: boolean;
  createdAt: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
  sourceCodec?: string;
  targetCodec?: string;
  type?: 'ENCODE' | 'REMUX';
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
  // Encoding Preview Feature
  previewImagePaths?: string | null; // JSON array of preview image paths
  // Health Check Feature
  healthScore?: number;
  healthMessage?: string;
  healthStatus?: string;
  healthCheckedAt?: string;
  // File Missing Badge Feature
  fileExists?: boolean;
  // Transfer Feature (Phase 4)
  transferRequired?: boolean;
  transferProgress?: number;
  transferSpeedMBps?: number;
  transferStartedAt?: string;
  transferCompletedAt?: string;
  transferError?: string;
  remoteTempPath?: string;
  transferRetryCount?: number;
  // Resilience Feature
  corruptedRequeueCount?: number;
  stuckRecoveryCount?: number;
  isBlacklisted?: boolean;
  // Decision Feature (Phase 3)
  decisionRequired?: boolean;
  decisionIssues?: string | null; // JSON string of HealthCheckIssue[]
  // Quality Metrics Feature (VMAF/PSNR/SSIM)
  qualityMetrics?: { vmaf?: number; psnr?: number; ssim?: number } | null;
  qualityMetricsAt?: string;
}
