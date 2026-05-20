import { Injectable, inject } from '@angular/core';
import { CarouselImage } from '@bitbonsai/shared-ui';
import { DistributionClient, type NodeCapacity } from '../../../core/clients/distribution.client';
import { ErrorLoggerService } from '../../../core/services/error-logger.service';
import { FileHealthStatus } from '../../libraries/models/library.model';
import type { Node as NodeModel } from '../../nodes/models/node.model';
import type { HealthCheckIssue } from '../models/health-check-issue.model';
import { JobEventType } from '../models/job-history-event.model';
import { JobStatus } from '../models/job-status.enum';
import type { QueueJob } from '../models/queue-job.model';
import type { QueueResponse } from '../models/queue-response.model';

@Injectable({
  providedIn: 'root',
})
export class QueueDisplayService {
  private readonly errorLogger = inject(ErrorLoggerService);

  // ============================================================================
  // STATUS HELPERS
  // ============================================================================

  getStatusClass(status: JobStatus): string {
    return status ? `status-${status.toLowerCase()}` : 'status-unknown';
  }

  getStatusIcon(status: JobStatus): string {
    switch (status) {
      case JobStatus.NEEDS_DECISION:
        return 'fa-exclamation-triangle';
      case JobStatus.QUEUED:
        return 'fa-clock';
      case JobStatus.TRANSFERRING:
        return 'fa-exchange-alt';
      case JobStatus.ENCODING:
        return 'fa-spinner fa-spin';
      case JobStatus.PAUSED:
        return 'fa-pause-circle';
      case JobStatus.COMPLETED:
        return 'fa-check-circle';
      case JobStatus.FAILED:
        return 'fa-exclamation-circle';
      case JobStatus.CANCELLED:
        return 'fa-ban';
      default:
        return 'fa-question-circle';
    }
  }

  getStatusLabel(status: JobStatus | 'ALL'): string {
    if (status === 'ALL') return 'All Jobs';

    const labels: Record<JobStatus, string> = {
      [JobStatus.DETECTED]: 'Detected',
      [JobStatus.HEALTH_CHECK]: 'Health Check',
      [JobStatus.NEEDS_DECISION]: '⚠️ Needs Attention',
      [JobStatus.QUEUED]: 'Queued',
      [JobStatus.TRANSFERRING]: 'Transferring',
      [JobStatus.ENCODING]: 'Encoding',
      [JobStatus.PAUSED]: 'Paused',
      [JobStatus.VERIFYING]: 'Verifying',
      [JobStatus.COMPLETED]: 'Completed',
      [JobStatus.FAILED]: 'Failed',
      [JobStatus.CANCELLED]: 'Cancelled',
    };

    return labels[status] || status;
  }

  getStatusExplanation(status: JobStatus): string {
    switch (status) {
      case JobStatus.NEEDS_DECISION:
        return 'This job requires your attention before it can proceed. The issue and suggested fixes are displayed below. Common issues include incompatible audio codecs or container formats that need to be adjusted.';
      case JobStatus.QUEUED:
        return 'This job is waiting in the queue for an available encoding node. It will start automatically when a node becomes free.';
      case JobStatus.TRANSFERRING:
        return 'This file is being transferred to the encoding node. Transfer speed and progress are shown. Once complete, encoding will begin automatically.';
      case JobStatus.ENCODING:
        return 'This job is currently being encoded by a node. Progress is shown as a percentage. Encoding time depends on file size, quality settings, and node hardware.';
      case JobStatus.PAUSED:
        return 'This job has been paused and encoding has stopped. You can resume it at any time to continue from where it left off.';
      case JobStatus.COMPLETED:
        return 'This job has finished encoding successfully. The file has been optimized and space savings are shown. The original file has been replaced or backed up according to your settings.';
      case JobStatus.FAILED:
        return 'This job encountered an error during encoding. Common causes include corrupted source files, insufficient disk space, or node crashes. You can retry the job or check the error details.';
      case JobStatus.CANCELLED:
        return "This job was manually cancelled and won't be encoded. The original file remains unchanged.";
      default:
        return 'Unknown job status.';
    }
  }

  // ============================================================================
  // HEALTH STATUS HELPERS
  // ============================================================================

  getHealthStatusIcon(status: FileHealthStatus): string {
    switch (status) {
      case FileHealthStatus.HEALTHY:
        return 'fas fa-check-circle';
      case FileHealthStatus.WARNING:
        return 'fas fa-exclamation-triangle';
      case FileHealthStatus.CORRUPTED:
        return 'fas fa-times-circle';
      default:
        return 'fas fa-question-circle';
    }
  }

  getHealthStatusTitle(status: FileHealthStatus): string {
    switch (status) {
      case FileHealthStatus.HEALTHY:
        return 'File is Healthy';
      case FileHealthStatus.WARNING:
        return 'File has Warnings';
      case FileHealthStatus.CORRUPTED:
        return 'File is Corrupted';
      default:
        return 'Health Status Unknown';
    }
  }

  // ============================================================================
  // FORMAT HELPERS
  // ============================================================================

  formatBytes(bytes: number): string {
    if (!bytes || Number.isNaN(bytes) || bytes < 0) return '0 B';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`;
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString();
  }

  formatETA(etaSeconds: number | null | undefined): string {
    if (!etaSeconds || etaSeconds <= 0) return 'Calculating...';

    const hours = Math.floor(etaSeconds / 3600);
    const minutes = Math.floor((etaSeconds % 3600) / 60);
    const seconds = Math.floor(etaSeconds % 60);

    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    if (minutes > 0) return `${minutes}m ${seconds}s remaining`;
    return `${seconds}s remaining`;
  }

  formatTimestamp(timestamp: string | null | undefined): string {
    if (!timestamp) return 'N/A';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000);

    if (diffMins < 60) {
      if (diffMins < 1) return 'Just now';
      if (diffMins === 1) return '1 minute ago';
      return `${diffMins} minutes ago`;
    }

    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    };
    return date.toLocaleDateString('en-US', options);
  }

  formatRelativeTime(timestamp: string | null | undefined): string {
    if (!timestamp) return 'N/A';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return diffMins === 1 ? '1 minute ago' : `${diffMins} minutes ago`;
    if (diffHours < 24) return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
    if (diffDays < 30) return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return diffMonths === 1 ? '1 month ago' : `${diffMonths} months ago`;
    const diffYears = Math.floor(diffMonths / 12);
    return diffYears === 1 ? '1 year ago' : `${diffYears} years ago`;
  }

  formatAbsoluteDateTime(timestamp: string | null | undefined): string {
    if (!timestamp) return '';

    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    };
    return new Date(timestamp).toLocaleDateString('en-US', options);
  }

  getElapsedTime(startedAt?: string): string {
    if (!startedAt) return '-';

    const elapsedSeconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  getEncodingDuration(startedAt?: string, completedAt?: string): string {
    if (!startedAt || !completedAt) return '-';

    const durationSeconds = Math.floor(
      (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000
    );
    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.floor((durationSeconds % 3600) / 60);
    const seconds = durationSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  calculateEncodingSpeed(job: {
    startedAt?: string;
    currentSize: number;
    originalSize: number;
  }): string {
    if (!job.startedAt || job.currentSize <= 0) return '-';

    const elapsedSeconds = (Date.now() - new Date(job.startedAt).getTime()) / 1000;
    if (elapsedSeconds <= 0) return '-';

    const bytesProcessed = job.originalSize - job.currentSize;
    return `${this.formatBytes(bytesProcessed / elapsedSeconds)}/s`;
  }

  // ============================================================================
  // CODEC HELPERS
  // ============================================================================

  getCodecBadgeClass(codec: string | undefined): string {
    if (!codec) return 'codec-unknown';
    const codecLower = codec.toLowerCase();
    if (codecLower.includes('hevc') || codecLower.includes('h.265')) return 'codec-hevc';
    if (codecLower.includes('av1')) return 'codec-av1';
    if (codecLower.includes('h.264') || codecLower.includes('avc')) return 'codec-h264';
    if (codecLower.includes('vp9')) return 'codec-vp9';
    return 'codec-other';
  }

  getEventTypeLabel(eventType: JobEventType): string {
    switch (eventType) {
      case JobEventType.FAILED:
        return 'Encoding Failed';
      case JobEventType.CANCELLED:
        return 'Job Cancelled';
      case JobEventType.RESTARTED:
        return 'Job Restarted';
      case JobEventType.AUTO_HEALED:
        return 'Auto-Healed';
      case JobEventType.BACKEND_RESTART:
        return 'Backend Restart';
      case JobEventType.TIMEOUT:
        return 'Encoding Timeout';
      default:
        return 'Job Event';
    }
  }

  // ============================================================================
  // COMPRESSION / SIZE ESTIMATES
  // ============================================================================

  private getCompressionRatio(sourceCodec?: string, targetCodec?: string): number {
    if (!sourceCodec || !targetCodec) return 0.4;

    const source = sourceCodec.toLowerCase();
    const target = targetCodec.toLowerCase();

    if (source.includes('h.264') || source.includes('avc')) {
      if (target.includes('hevc') || target.includes('h.265')) return 0.45;
      if (target.includes('av1')) return 0.5;
    }
    if (source.includes('hevc') || source.includes('h.265')) {
      if (target.includes('av1')) return 0.25;
    }
    if (source.includes('vp9')) {
      if (target.includes('av1')) return 0.2;
      if (target.includes('hevc')) return 0.15;
    }
    if (source === target) return 0.05;
    return 0.4;
  }

  getEstimatedCompression(job: { sourceCodec?: string; targetCodec?: string }): number {
    return Math.round(this.getCompressionRatio(job.sourceCodec, job.targetCodec) * 100);
  }

  getEstimatedSize(job: {
    originalSize: number;
    sourceCodec?: string;
    targetCodec?: string;
  }): number {
    return Math.round(
      job.originalSize * (1 - this.getCompressionRatio(job.sourceCodec, job.targetCodec))
    );
  }

  calculateExpectedSize(job: QueueJob): string {
    const compressionPercent = this.getEstimatedCompression(job);
    return this.formatBytes(job.originalSize * (1 - compressionPercent / 100));
  }

  calculateExpectedSavings(job: QueueJob): string {
    const compressionPercent = this.getEstimatedCompression(job);
    return `~${this.formatBytes(job.originalSize * (compressionPercent / 100))} (${compressionPercent}%)`;
  }

  calculateEstimatedTime(totalSizeBytes: number): { hours: number; minutes: number } {
    const estimatedSeconds = totalSizeBytes / (50 * 1024 * 1024);
    return {
      hours: Math.floor(estimatedSeconds / 3600),
      minutes: Math.floor((estimatedSeconds % 3600) / 60),
    };
  }

  getAvgEncodingSpeed(): number {
    return 50 * 1024 * 1024;
  }

  // ============================================================================
  // STUCK / RECOVERY JOB HELPERS
  // ============================================================================

  isJobStuck(job: QueueJob): boolean {
    if (job.status !== JobStatus.ENCODING || !job.startedAt) return false;
    const elapsedMinutes = (Date.now() - new Date(job.startedAt).getTime()) / (1000 * 60);
    return elapsedMinutes >= 5 && job.progress === 0;
  }

  getStuckJobMessage(job: QueueJob, advanced = false): string {
    if (!job.startedAt) return 'Job may be stuck';
    const elapsedTime = this.getElapsedTime(job.startedAt);
    let message = `No progress for ${elapsedTime}. The system is monitoring this job and will auto-recover it if needed.`;
    if (advanced && (job.stuckRecoveryCount || 0) > 0) {
      message += ` Recovery count: ${job.stuckRecoveryCount}/5`;
    }
    return message;
  }

  hasRecoveryHistory(job: QueueJob): boolean {
    return (job.stuckRecoveryCount || 0) > 0 || (job.corruptedRequeueCount || 0) > 0;
  }

  getRecoveryTooltip(job: QueueJob): string {
    const parts: string[] = [];
    if ((job.stuckRecoveryCount || 0) > 0) {
      parts.push(
        `${job.stuckRecoveryCount} stuck ${job.stuckRecoveryCount === 1 ? 'recovery' : 'recoveries'}`
      );
    }
    if ((job.corruptedRequeueCount || 0) > 0) {
      parts.push(
        `${job.corruptedRequeueCount} corruption ${job.corruptedRequeueCount === 1 ? 'requeue' : 'requeues'}`
      );
    }
    return parts.join(', ');
  }

  isApproachingBlacklist(job: QueueJob): boolean {
    return (
      (job.retryCount || 0) + (job.corruptedRequeueCount || 0) + (job.stuckRecoveryCount || 0) >= 3
    );
  }

  wasHealedFreshStart(job: QueueJob): boolean {
    return !!job.autoHealedAt && (job.autoHealedProgress || 0) > 0 && job.progress === 0;
  }

  wasHealedWithResume(job: QueueJob): boolean {
    return (
      !!job.autoHealedAt &&
      (job.autoHealedProgress || 0) > 0 &&
      job.progress >= (job.autoHealedProgress || 0)
    );
  }

  // ============================================================================
  // ERROR CATEGORIZATION
  // ============================================================================

  private categorizeError(error: string): string {
    const errorLower = error.toLowerCase();

    const ffmpegExitMatch = error.match(/ffmpeg.*exit code (\d+)/i);
    if (ffmpegExitMatch) return `FFmpeg Error Code ${ffmpegExitMatch[1]}`;
    if (errorLower.includes('ffmpeg') && errorLower.includes('error'))
      return 'FFmpeg Error (Other)';
    if (
      errorLower.includes('timeout') ||
      errorLower.includes('timed out') ||
      errorLower.includes('stuck') ||
      errorLower.includes('no progress')
    )
      return 'Job Timeout/Stuck';
    if (
      errorLower.includes('file not found') ||
      errorLower.includes('no such file') ||
      errorLower.includes('enoent') ||
      errorLower.includes('does not exist')
    )
      return 'File Not Found';
    if (
      errorLower.includes('codec') ||
      errorLower.includes('unsupported') ||
      errorLower.includes('invalid codec')
    )
      return 'Codec Error';
    if (
      errorLower.includes('network') ||
      errorLower.includes('connection') ||
      errorLower.includes('econnrefused') ||
      errorLower.includes('econnreset')
    )
      return 'Network Error';
    if (
      errorLower.includes('no space') ||
      errorLower.includes('enospc') ||
      errorLower.includes('disk full')
    )
      return 'Disk Space Error';
    if (
      errorLower.includes('permission') ||
      errorLower.includes('eacces') ||
      errorLower.includes('eperm')
    )
      return 'Permission Error';
    if (errorLower.includes('out of memory') || errorLower.includes('enomem'))
      return 'Memory Error';

    return error;
  }

  getUniqueFailureReasons(
    data: QueueResponse
  ): Array<{ error: string; count: number; category: string }> {
    const failedJobs = this.getFailedJobs(data);
    const categoryCounts = new Map<string, { count: number; originalErrors: Set<string> }>();

    for (const job of failedJobs) {
      const originalError = job.error || 'Unknown error';
      const category = this.categorizeError(originalError);

      if (!categoryCounts.has(category)) {
        categoryCounts.set(category, { count: 0, originalErrors: new Set() });
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const entry = categoryCounts.get(category)!;
      entry.count++;
      entry.originalErrors.add(originalError);
    }

    return Array.from(categoryCounts.entries())
      .map(([category, d]) => ({ error: category, count: d.count, category }))
      .sort((a, b) => b.count - a.count);
  }

  getFilteredFailedJobs(data: QueueResponse, errorFilter: string | null): QueueResponse['jobs'] {
    const failedJobs = this.getFailedJobs(data);
    if (!errorFilter) return failedJobs;
    return failedJobs.filter(
      (job) => this.categorizeError(job.error || 'Unknown error') === errorFilter
    );
  }

  getCancelledJobs(data: QueueResponse): QueueResponse['jobs'] {
    return data.jobs.filter((job) => job.status === 'CANCELLED');
  }

  getFailedJobs(data: QueueResponse): QueueResponse['jobs'] {
    return data.jobs.filter((job) => job.status === 'FAILED');
  }

  calculateTotalSize(jobs: QueueResponse['jobs']): number {
    return jobs.reduce((sum, job) => sum + Number(job.originalSize), 0);
  }

  getShortFailureReason(error: string | null | undefined): string {
    if (!error) return 'Unknown error';

    const patterns = [
      { regex: /no space left/i, reason: 'Out of disk space' },
      { regex: /permission denied/i, reason: 'Permission denied' },
      { regex: /file not found/i, reason: 'File not found' },
      { regex: /invalid data found/i, reason: 'Invalid or corrupted file' },
      { regex: /codec.*not (found|supported)/i, reason: 'Codec not supported' },
      { regex: /invalid argument/i, reason: 'Invalid encoding parameters' },
      { regex: /timed out/i, reason: 'Encoding timed out' },
      { regex: /connection (refused|reset)/i, reason: 'Connection failed' },
      { regex: /segmentation fault/i, reason: 'FFmpeg crashed' },
      { regex: /killed/i, reason: 'Process terminated' },
      { regex: /out of memory/i, reason: 'Out of memory' },
    ];

    for (const { regex, reason } of patterns) {
      if (regex.test(error)) return reason;
    }

    const firstLine = error.split('\n')[0].trim();
    if (firstLine.length > 50) {
      const meaningfulPart =
        firstLine.split(':')[0] || firstLine.split('-')[0] || firstLine.substring(0, 50);
      return `${meaningfulPart.trim()}...`;
    }
    return firstLine || 'Unknown error';
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
