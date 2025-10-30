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
  retryCount?: number;
  nextRetryAt?: string;
  priority?: number;
  prioritySetAt?: string;

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
    this.retryCount = model.retryCount;
    this.nextRetryAt = model.nextRetryAt;
    this.priority = model.priority;
    this.prioritySetAt = model.prioritySetAt;
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
}
