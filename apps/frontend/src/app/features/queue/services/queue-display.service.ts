import { Injectable, inject } from '@angular/core';
import { CarouselImage } from '@bitbonsai/shared-ui';
import type { NodeCapacity } from '../../../core/clients/distribution.client';
import { ErrorLoggerService } from '../../../core/services/error-logger.service';
import { FileHealthStatus } from '../../libraries/models/library.model';
import type { Node as NodeModel } from '../../nodes/models/node.model';
import type { HealthCheckIssue } from '../models/health-check-issue.model';
import { JobEventType } from '../models/job-history-event.model';
import { JobStatus } from '../models/job-status.enum';
import type { QueueJob } from '../models/queue-job.model';
import type { QueueResponse } from '../models/queue-response.model';
import { QueueCompressionService } from './queue-compression.service';
import { QueueFormattingService } from './queue-formatting.service';
import { QueueStatusDisplayService } from './queue-status-display.service';
import { QueueStuckJobService } from './queue-stuck-job.service';

/**
 * QueueDisplayService
 *
 * Thin facade delegating to focused display services.
 * Preserves the original public API for backward compatibility.
 */
@Injectable({
  providedIn: 'root',
})
export class QueueDisplayService {
  private readonly errorLogger = inject(ErrorLoggerService);
  private readonly statusDisplay = inject(QueueStatusDisplayService);
  private readonly formatting = inject(QueueFormattingService);
  private readonly compression = inject(QueueCompressionService);
  private readonly stuckJob = inject(QueueStuckJobService);

  // ============================================================================
  // STATUS HELPERS - delegated to QueueStatusDisplayService
  // ============================================================================

  getStatusClass(status: JobStatus): string {
    return this.statusDisplay.getStatusClass(status);
  }

  getStatusIcon(status: JobStatus): string {
    return this.statusDisplay.getStatusIcon(status);
  }

  getStatusLabel(status: JobStatus | 'ALL'): string {
    return this.statusDisplay.getStatusLabel(status);
  }

  getStatusExplanation(status: JobStatus): string {
    return this.statusDisplay.getStatusExplanation(status);
  }

  // ============================================================================
  // HEALTH STATUS HELPERS - delegated to QueueStatusDisplayService
  // ============================================================================

  getHealthStatusIcon(status: FileHealthStatus): string {
    return this.statusDisplay.getHealthStatusIcon(status);
  }

  getHealthStatusTitle(status: FileHealthStatus): string {
    return this.statusDisplay.getHealthStatusTitle(status);
  }

  // ============================================================================
  // FORMAT HELPERS - delegated to QueueFormattingService
  // ============================================================================

  formatBytes(bytes: number): string {
    return this.formatting.formatBytes(bytes);
  }

  formatDate(dateString: string): string {
    return this.formatting.formatDate(dateString);
  }

  formatETA(etaSeconds: number | null | undefined): string {
    return this.formatting.formatETA(etaSeconds);
  }

  formatTimestamp(timestamp: string | null | undefined): string {
    return this.formatting.formatTimestamp(timestamp);
  }

  formatRelativeTime(timestamp: string | null | undefined): string {
    return this.formatting.formatRelativeTime(timestamp);
  }

  formatAbsoluteDateTime(timestamp: string | null | undefined): string {
    return this.formatting.formatAbsoluteDateTime(timestamp);
  }

  getElapsedTime(startedAt?: string): string {
    return this.formatting.getElapsedTime(startedAt);
  }

  getEncodingDuration(startedAt?: string, completedAt?: string): string {
    return this.formatting.getEncodingDuration(startedAt, completedAt);
  }

  calculateEncodingSpeed(job: {
    startedAt?: string;
    currentSize: number;
    originalSize: number;
  }): string {
    return this.formatting.calculateEncodingSpeed(job);
  }

  // ============================================================================
  // CODEC HELPERS - delegated to QueueStatusDisplayService
  // ============================================================================

  getCodecBadgeClass(codec: string | undefined): string {
    return this.statusDisplay.getCodecBadgeClass(codec);
  }

  getEventTypeLabel(eventType: JobEventType): string {
    return this.statusDisplay.getEventTypeLabel(eventType);
  }

  // ============================================================================
  // COMPRESSION / SIZE ESTIMATES - delegated to QueueCompressionService
  // ============================================================================

  getEstimatedCompression(job: { sourceCodec?: string; targetCodec?: string }): number {
    return this.compression.getEstimatedCompression(job);
  }

  getEstimatedSize(job: {
    originalSize: number;
    sourceCodec?: string;
    targetCodec?: string;
  }): number {
    return this.compression.getEstimatedSize(job);
  }

  calculateExpectedSize(job: QueueJob): string {
    return this.compression.calculateExpectedSize(job);
  }

  calculateExpectedSavings(job: QueueJob): string {
    return this.compression.calculateExpectedSavings(job);
  }

  calculateEstimatedTime(totalSizeBytes: number): { hours: number; minutes: number } {
    return this.compression.calculateEstimatedTime(totalSizeBytes);
  }

  getAvgEncodingSpeed(): number {
    return this.compression.getAvgEncodingSpeed();
  }

  // ============================================================================
  // STUCK / RECOVERY JOB HELPERS - delegated to QueueStuckJobService
  // ============================================================================

  isJobStuck(job: QueueJob): boolean {
    return this.stuckJob.isJobStuck(job);
  }

  getStuckJobMessage(job: QueueJob, advanced = false): string {
    return this.stuckJob.getStuckJobMessage(job, advanced);
  }

  hasRecoveryHistory(job: QueueJob): boolean {
    return this.stuckJob.hasRecoveryHistory(job);
  }

  getRecoveryTooltip(job: QueueJob): string {
    return this.stuckJob.getRecoveryTooltip(job);
  }

  isApproachingBlacklist(job: QueueJob): boolean {
    return this.stuckJob.isApproachingBlacklist(job);
  }

  wasHealedFreshStart(job: QueueJob): boolean {
    return this.stuckJob.wasHealedFreshStart(job);
  }

  wasHealedWithResume(job: QueueJob): boolean {
    return this.stuckJob.wasHealedWithResume(job);
  }

  // ============================================================================
  // ERROR CATEGORIZATION - delegated to QueueStuckJobService
  // ============================================================================

  getUniqueFailureReasons(
    data: QueueResponse
  ): Array<{ error: string; count: number; category: string }> {
    return this.stuckJob.getUniqueFailureReasons(data);
  }

  getFilteredFailedJobs(data: QueueResponse, errorFilter: string | null): QueueResponse['jobs'] {
    return this.stuckJob.getFilteredFailedJobs(data, errorFilter);
  }

  getCancelledJobs(data: QueueResponse): QueueResponse['jobs'] {
    return this.stuckJob.getCancelledJobs(data);
  }

  getFailedJobs(data: QueueResponse): QueueResponse['jobs'] {
    return this.stuckJob.getFailedJobs(data);
  }

  calculateTotalSize(jobs: QueueResponse['jobs']): number {
    return this.stuckJob.calculateTotalSize(jobs);
  }

  getShortFailureReason(error: string | null | undefined): string {
    return this.stuckJob.getShortFailureReason(error);
  }

  // ============================================================================
  // DECISION ISSUES
  // ============================================================================

  parseDecisionIssues(decisionIssuesJson: string | null | undefined): HealthCheckIssue[] {
    if (!decisionIssuesJson) return [];

    try {
      const issues = JSON.parse(decisionIssuesJson);
      if (!Array.isArray(issues)) return [];

      return issues.filter(
        (issue): issue is HealthCheckIssue =>
          issue !== null &&
          typeof issue === 'object' &&
          typeof issue.category === 'string' &&
          typeof issue.message === 'string'
      );
    } catch (error: unknown) {
      this.errorLogger.error('Failed to parse decision issues', error);
      return [];
    }
  }

  // ============================================================================
  // PREVIEW / CAROUSEL HELPERS
  // ============================================================================

  parsePreviewPaths(paths: string | null | undefined, jobId: string): string[] {
    if (!paths) return [];
    try {
      const filePaths = JSON.parse(paths) as string[];
      return filePaths.map((_, index) => `/api/v1/queue/${jobId}/preview/${index + 1}`);
    } catch {
      return [];
    }
  }

  getPreviewUrl(jobId: string, index: number): string {
    return `/api/v1/queue/${jobId}/preview/${index}`;
  }

  getPreviewLabel(index: number): string {
    return `Manual #${index + 1}`;
  }

  parsePreviewImages(paths: string | null | undefined, jobId: string): CarouselImage[] {
    if (!paths) return [];
    try {
      const filePaths = JSON.parse(paths) as string[];
      return filePaths.map((_, index) => ({
        src: `/api/v1/queue/${jobId}/preview/${index + 1}`,
        alt: `Preview ${index + 1}`,
        label: this.getPreviewLabel(index),
      }));
    } catch {
      return [];
    }
  }

  // ============================================================================
  // NODE STATUS BAR
  // ============================================================================

  getNodeStatusClass(node: NodeCapacity): string {
    if (node.isOverloaded) return 'node-status overloaded';
    if (node.activeJobs >= node.maxWorkers) return 'node-status at-capacity';
    if (node.activeJobs > 0) return 'node-status working';
    return 'node-status idle';
  }

  getNodeStatusIcon(node: NodeCapacity): string {
    if (node.isOverloaded) return 'fas fa-exclamation-triangle';
    if (node.activeJobs >= node.maxWorkers) return 'fas fa-fire';
    if (node.activeJobs > 0) return 'fas fa-cog fa-spin';
    return 'fas fa-check-circle';
  }

  getNodeStatusLabel(node: NodeCapacity): string {
    if (node.isOverloaded) return 'Overloaded';
    if (node.activeJobs >= node.maxWorkers) return 'At Capacity';
    if (node.activeJobs > node.maxWorkers * 0.5) return 'Busy';
    if (node.activeJobs > 0) return 'Working';
    return 'Ready';
  }

  getNodeTooltipContent(node: NodeCapacity): string {
    const lines: string[] = [];

    lines.push(`Workers: ${node.activeJobs} active / ${node.maxWorkers} max`);
    lines.push(`Available slots: ${node.availableSlots}`);

    if (node.loadAvg1m !== undefined && node.cpuCount !== undefined) {
      const loadPercent = ((node.loadAvg1m / node.cpuCount) * 100).toFixed(0);
      lines.push(
        `CPU Load: ${node.loadAvg1m.toFixed(1)} / ${node.cpuCount} cores (${loadPercent}%)`
      );
    }

    if (node.freeMemoryGB !== undefined && node.totalMemoryGB !== undefined) {
      const usedMemory = node.totalMemoryGB - node.freeMemoryGB;
      const memPercent = ((usedMemory / node.totalMemoryGB) * 100).toFixed(0);
      lines.push(
        `Memory: ${usedMemory.toFixed(1)}GB / ${node.totalMemoryGB.toFixed(1)}GB (${memPercent}% used)`
      );
    } else if (node.freeMemoryGB !== undefined) {
      lines.push(`Free Memory: ${node.freeMemoryGB.toFixed(1)}GB`);
    }

    if (node.isOverloaded && node.overloadReason) {
      lines.push(`⚠️ ${node.overloadReason}`);
    }

    if (node.estimatedFreeAt) {
      const diffMins = Math.ceil((new Date(node.estimatedFreeAt).getTime() - Date.now()) / 60000);
      if (diffMins > 0 && diffMins < 240) {
        if (diffMins >= 60) {
          lines.push(`Next slot available: ~${Math.floor(diffMins / 60)}h ${diffMins % 60}m`);
        } else {
          lines.push(`Next slot available: ~${diffMins} min`);
        }
      }
    }

    return lines.join('\n');
  }

  // ============================================================================
  // STORAGE ACCESS TYPE
  // ============================================================================

  getStorageAccessType(
    job: { transferRequired?: boolean; nodeId?: string },
    nodes: NodeModel[]
  ): 'local' | 'nfs' | 'copied' {
    if (job.transferRequired) return 'copied';
    const node = nodes.find((n) => n.id === job.nodeId);
    if (node?.role === 'MAIN') return 'local';
    return 'nfs';
  }
}
