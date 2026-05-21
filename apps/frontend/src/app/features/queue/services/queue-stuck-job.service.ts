import { Injectable, inject } from '@angular/core';
import { JobStatus } from '../models/job-status.enum';
import type { QueueJob } from '../models/queue-job.model';
import type { QueueResponse } from '../models/queue-response.model';
import { QueueFormattingService } from './queue-formatting.service';

@Injectable({
  providedIn: 'root',
})
export class QueueStuckJobService {
  private readonly formatting = inject(QueueFormattingService);

  // ============================================================================
  // STUCK JOB DETECTION
  // ============================================================================

  isJobStuck(job: QueueJob): boolean {
    if (job.status !== JobStatus.ENCODING || !job.startedAt) return false;
    const elapsedMinutes = (Date.now() - new Date(job.startedAt).getTime()) / (1000 * 60);
    return elapsedMinutes >= 5 && job.progress === 0;
  }

  getStuckJobMessage(job: QueueJob, advanced = false): string {
    if (!job.startedAt) return 'Job may be stuck';
    const elapsedTime = this.formatting.getElapsedTime(job.startedAt);
    let message = `No progress for ${elapsedTime}. The system is monitoring this job and will auto-recover it if needed.`;
    if (advanced && (job.stuckRecoveryCount || 0) > 0) {
      message += ` Recovery count: ${job.stuckRecoveryCount}/5`;
    }
    return message;
  }

  // ============================================================================
  // RECOVERY TOOLTIP LOGIC
  // ============================================================================

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

  categorizeError(error: string): string {
    const ffmpegExitMatch = error.match(/ffmpeg.*exit code (\d+)/i);
    if (ffmpegExitMatch) return `FFmpeg Error Code ${ffmpegExitMatch[1]}`;

    const errorLower = error.toLowerCase();

    const categories: { keywords: string[]; label: string }[] = [
      { keywords: ['ffmpeg', 'error'], label: 'FFmpeg Error (Other)' },
      { keywords: ['timeout'], label: 'Job Timeout/Stuck' },
      { keywords: ['timed out'], label: 'Job Timeout/Stuck' },
      { keywords: ['stuck'], label: 'Job Timeout/Stuck' },
      { keywords: ['no progress'], label: 'Job Timeout/Stuck' },
      { keywords: ['file not found'], label: 'File Not Found' },
      { keywords: ['no such file'], label: 'File Not Found' },
      { keywords: ['enoent'], label: 'File Not Found' },
      { keywords: ['does not exist'], label: 'File Not Found' },
      { keywords: ['codec'], label: 'Codec Error' },
      { keywords: ['unsupported'], label: 'Codec Error' },
      { keywords: ['invalid codec'], label: 'Codec Error' },
      { keywords: ['network'], label: 'Network Error' },
      { keywords: ['connection'], label: 'Network Error' },
      { keywords: ['econnrefused'], label: 'Network Error' },
      { keywords: ['econnreset'], label: 'Network Error' },
      { keywords: ['no space'], label: 'Disk Space Error' },
      { keywords: ['enospc'], label: 'Disk Space Error' },
      { keywords: ['disk full'], label: 'Disk Space Error' },
      { keywords: ['permission'], label: 'Permission Error' },
      { keywords: ['eacces'], label: 'Permission Error' },
      { keywords: ['eperm'], label: 'Permission Error' },
      { keywords: ['out of memory'], label: 'Memory Error' },
      { keywords: ['enomem'], label: 'Memory Error' },
    ];

    for (const { keywords, label } of categories) {
      if (keywords.every((kw) => errorLower.includes(kw))) return label;
    }

    return error;
  }

  // ============================================================================
  // FAILURE REASON FILTERING
  // ============================================================================

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
}
