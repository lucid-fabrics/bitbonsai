import { FileHealthStatus } from '../../libraries/models/library.model';
import { JobStatus } from '../models/job-status.enum';
import type { QueueJobApiModel } from '../models/queue-job-api.model';

/**
 * Business Object for queue jobs
 * Transforms API response into frontend-friendly model
 */
export class QueueJobBo {
  id: string;
  fileName: string;
  filePath: string;
  libraryId: string;
  libraryName: string;
  policyName: string;
  status: JobStatus;
  progress: number;
  etaSeconds?: number | null;
  fps?: number | null;
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
  type: 'ENCODE' | 'REMUX';
  retryCount?: number;
  nextRetryAt?: string;
  priority?: number;
  prioritySetAt?: string;
  autoHealedAt?: string;
  autoHealedProgress?: number;
  // Keep Original Feature
  keepOriginalRequested?: boolean;
  originalBackupPath?: string | null;
  originalSizeBytes?: number | null;
  replacementAction?: 'REPLACED' | 'KEPT_BOTH' | null;
  // Encoding Preview
  previewImagePaths?: string | null;
  // Health Check Feature
  healthScore?: number;
  healthMessage?: string;
  healthStatus?: FileHealthStatus;
  healthCheckedAt?: string;
  // File Missing Badge Feature
  stage?: string;
  fileExists?: boolean;
  // Job Delegation & Scheduling
  originalNodeId?: string | null;
  manualAssignment?: boolean;
  // Transfer Feature (Phase 4)
  transferRequired?: boolean;
  transferProgress?: number;
  transferSpeedMBps?: number;
  transferStartedAt?: string;
  transferCompletedAt?: string;
  transferError?: string;
  remoteTempPath?: string;
  transferRetryCount?: number;

  constructor(model: QueueJobApiModel) {
    this.id = model.id;
    this.fileName = this.extractFileName(model);
    this.filePath = model.filePath;
    this.libraryId = this.extractLibraryId(model);
    this.libraryName = this.extractLibraryName(model);
    this.policyName = this.extractPolicyName(model);
    this.status = this.extractStatus(model);
    this.progress = model.progress;
    this.etaSeconds = model.etaSeconds;
    this.fps = model.fps;
    this.originalSize = this.parseSize(model.beforeSizeBytes || model.originalSize);
    this.currentSize = this.parseSize(model.afterSizeBytes || model.currentSize);
    this.savedSize = this.parseSize(model.savedBytes || model.savedSize);
    this.savedPercentage = model.savedPercent ?? model.savedPercentage ?? 0;
    this.nodeId = this.extractNodeId(model);
    this.nodeName = this.extractNodeName(model);
    this.createdAt = model.createdAt;
    this.updatedAt = model.updatedAt;
    this.startedAt = model.startedAt;
    this.completedAt = model.completedAt;
    this.failedAt = model.failedAt;
    this.error = model.error;
    this.sourceCodec = model.sourceCodec;
    this.targetCodec = model.targetCodec;
    this.type = model.type || 'ENCODE';
    this.retryCount = model.retryCount;
    this.nextRetryAt = model.nextRetryAt;
    this.priority = model.priority;
    this.prioritySetAt = model.prioritySetAt;
    this.autoHealedAt = model.autoHealedAt;
    this.autoHealedProgress = model.autoHealedProgress;
    // Keep Original Feature
    this.keepOriginalRequested = model.keepOriginalRequested ?? false;
    this.originalBackupPath = model.originalBackupPath ?? null;
    this.originalSizeBytes = model.originalSizeBytes
      ? this.parseSize(model.originalSizeBytes)
      : null;
    this.replacementAction = model.replacementAction ?? null;
    // Encoding Preview
    this.previewImagePaths = model.previewImagePaths ?? null;
    // Health Check Feature
    this.healthScore = model.healthScore;
    this.healthMessage = model.healthMessage;
    this.healthStatus = model.healthStatus as FileHealthStatus | undefined;
    this.healthCheckedAt = model.healthCheckedAt;
    // File Missing Badge Feature
    this.stage = model.stage;
    this.fileExists = model.fileExists;
    // Job Delegation & Scheduling
    this.originalNodeId = model.originalNodeId ?? null;
    this.manualAssignment = model.manualAssignment ?? false;
    // Transfer Feature (Phase 4)
    this.transferRequired = model.transferRequired;
    this.transferProgress = model.transferProgress;
    this.transferSpeedMBps = model.transferSpeedMBps;
    this.transferStartedAt = model.transferStartedAt;
    this.transferCompletedAt = model.transferCompletedAt;
    this.transferError = model.transferError;
    this.remoteTempPath = model.remoteTempPath;
    this.transferRetryCount = model.transferRetryCount;
  }

  private extractFileName(model: QueueJobApiModel): string {
    return model.fileLabel || model.fileName || '';
  }

  private extractLibraryId(model: QueueJobApiModel): string {
    return model.library?.id || model.libraryId || '';
  }

  private extractLibraryName(model: QueueJobApiModel): string {
    return model.library?.name || model.libraryName || '';
  }

  private extractPolicyName(model: QueueJobApiModel): string {
    return model.policy?.name || model.policyName || '';
  }

  private extractStatus(model: QueueJobApiModel): JobStatus {
    return model.stage || model.status || JobStatus.QUEUED;
  }

  private extractNodeId(model: QueueJobApiModel): string {
    return (model as QueueJobApiModel & { nodeId?: string }).nodeId || '';
  }

  private extractNodeName(model: QueueJobApiModel): string {
    return model.node?.name || model.nodeName || '';
  }

  private parseSize(value: string | number | undefined): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number.parseInt(value, 10) || 0;
    return 0;
  }

  /**
   * Check if this job was auto-healed but had to start fresh (temp file was missing)
   * @returns true if job was healed but started from 0% due to missing temp file
   */
  get wasHealedFreshStart(): boolean {
    // Fresh start occurs when:
    // 1. Job was auto-healed (autoHealedAt exists)
    // 2. Job had made progress before (autoHealedProgress > 0)
    // 3. But current progress is 0 (had to start fresh)
    return !!this.autoHealedAt && (this.autoHealedProgress || 0) > 0 && this.progress === 0;
  }

  /**
   * Check if this job was auto-healed and successfully resumed from checkpoint
   * @returns true if job was healed and resumed from previous progress
   */
  get wasHealedWithResume(): boolean {
    // Resume occurs when:
    // 1. Job was auto-healed (autoHealedAt exists)
    // 2. Job had made progress before (autoHealedProgress > 0)
    // 3. Current progress matches or exceeds the healed progress (resumed successfully)
    return (
      !!this.autoHealedAt &&
      (this.autoHealedProgress || 0) > 0 &&
      this.progress >= (this.autoHealedProgress || 0)
    );
  }
}
