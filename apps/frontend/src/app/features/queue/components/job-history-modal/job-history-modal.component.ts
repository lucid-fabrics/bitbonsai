import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslocoModule } from '@ngneat/transloco';
import { JobEventType, type JobHistoryEvent } from '../../models/job-history-event.model';

@Component({
  selector: 'app-job-history-modal',
  standalone: true,
  imports: [TranslocoModule],
  templateUrl: './job-history-modal.component.html',
  styleUrls: ['./job-history-modal.component.scss'],
})
export class JobHistoryModalComponent {
  @Input() isOpen = false;
  @Input() fileName = '';
  @Input() jobId = '';
  @Input() history: JobHistoryEvent[] = [];

  @Output() closeModal = new EventEmitter<void>();

  protected JobEventType = JobEventType;
  protected expandedEventIds = new Set<string>();

  close() {
    this.closeModal.emit();
  }

  toggleEventDetails(eventId: string) {
    if (this.expandedEventIds.has(eventId)) {
      this.expandedEventIds.delete(eventId);
    } else {
      this.expandedEventIds.add(eventId);
    }
  }

  isEventExpanded(eventId: string): boolean {
    return this.expandedEventIds.has(eventId);
  }

  getEventTypeLabel(eventType: JobEventType): string {
    switch (eventType) {
      case JobEventType.FAILED:
        return 'Failed';
      case JobEventType.CANCELLED:
        return 'Cancelled';
      case JobEventType.RESTARTED:
        return 'Restarted';
      case JobEventType.AUTO_HEALED:
        return 'Auto-Healed';
      case JobEventType.BACKEND_RESTART:
        return 'Backend Restart';
      case JobEventType.TIMEOUT:
        return 'Timeout';
      default:
        return eventType;
    }
  }

  getEventIcon(eventType: JobEventType): string {
    switch (eventType) {
      case JobEventType.FAILED:
        return 'fa-times-circle';
      case JobEventType.CANCELLED:
        return 'fa-ban';
      case JobEventType.RESTARTED:
        return 'fa-redo';
      case JobEventType.AUTO_HEALED:
        return 'fa-shield-alt';
      case JobEventType.BACKEND_RESTART:
        return 'fa-server';
      case JobEventType.TIMEOUT:
        return 'fa-hourglass-end';
      default:
        return 'fa-circle';
    }
  }

  formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  getRelativeTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays}d ago`;
    } else if (diffHours > 0) {
      return `${diffHours}h ago`;
    } else if (diffMins > 0) {
      return `${diffMins}m ago`;
    } else {
      return 'Just now';
    }
  }

  /**
   * Generate a human-readable summary from error message and details
   */
  getErrorSummary(event: JobHistoryEvent): string {
    const combinedError = `${event.errorMessage?.toLowerCase() ?? ''} ${event.errorDetails?.toLowerCase() ?? ''}`;
    return this.matchErrorPattern(combinedError) ?? this.getEventTypeSummary(event);
  }

  private matchErrorPattern(combinedError: string): string | null {
    if (
      this.errorIncludes(combinedError, [
        'invalid data found when processing input',
        'moov atom not found',
      ])
    ) {
      return 'The video file appears to be corrupted or incomplete. The file may have been damaged during transfer or recording.';
    }
    if (this.errorIncludes(combinedError, ['no such file or directory', 'enoent'])) {
      return 'The source video file could not be found. It may have been moved, deleted, or the path is incorrect.';
    }
    if (this.errorIncludes(combinedError, ['permission denied', 'eacces'])) {
      return 'BitBonsai does not have permission to access the video file or output directory.';
    }
    if (combinedError.includes('disk') && this.errorIncludes(combinedError, ['full', 'space'])) {
      return 'The disk is full. Free up space on the destination drive to continue encoding.';
    }
    if (combinedError.includes('codec') && combinedError.includes('not supported')) {
      return 'The video uses an unsupported codec. The file may need to be re-encoded with different settings.';
    }
    if (this.errorIncludes(combinedError, ['timeout', 'timed out'])) {
      return 'The encoding process took too long and was stopped. This may indicate a problem with the video file or encoding settings.';
    }
    if (this.errorIncludes(combinedError, ['killed', 'sigkill', 'sigterm'])) {
      return 'The encoding process was terminated unexpectedly. This usually happens when the system runs out of memory or the backend was restarted.';
    }
    if (this.errorIncludes(combinedError, ['av_interleaved_write_frame', 'broken pipe'])) {
      return 'The encoding process was interrupted while writing output. This may indicate a disk write error or insufficient space.';
    }
    if (this.errorIncludes(combinedError, ['invalid argument', 'invalid option'])) {
      return 'The encoding settings contain an invalid configuration. The encoding profile may need to be adjusted.';
    }
    if (combinedError.includes('decoder') && combinedError.includes('not found')) {
      return 'The required video decoder is missing or not available. The video format may not be supported.';
    }
    if (this.errorIncludes(combinedError, ['conversion failed', 'error while', 'failed'])) {
      return 'The video encoding failed. Check the technical details below for specific error information.';
    }
    return null;
  }

  private errorIncludes(text: string, terms: string[]): boolean {
    return terms.some((t) => text.includes(t));
  }

  private getEventTypeSummary(event: JobHistoryEvent): string {
    const eventSummaries: Partial<Record<JobEventType, string>> = {
      [JobEventType.CANCELLED]:
        'The encoding job was manually cancelled by a user or administrator.',
      [JobEventType.TIMEOUT]:
        'The encoding process exceeded the maximum allowed time and was automatically stopped.',
      [JobEventType.BACKEND_RESTART]:
        'The BitBonsai backend service was restarted while this job was processing.',
      [JobEventType.AUTO_HEALED]:
        'The job automatically recovered from a previous failure and will retry encoding.',
      [JobEventType.RESTARTED]: 'The job was manually restarted to attempt encoding again.',
    };
    return (
      eventSummaries[event.eventType] ??
      event.systemMessage ??
      this.getEventTypeLabel(event.eventType)
    );
  }

  copyToClipboard() {
    const historyText = `Job History: ${this.fileName}
Job ID: ${this.jobId}

${this.history
  .map(
    (event) => `
[${this.formatTimestamp(event.createdAt)}] ${event.systemMessage || this.getEventTypeLabel(event.eventType)}
Event Type: ${event.eventType}
Stage: ${event.stage}
Progress: ${event.progress.toFixed(1)}%
${event.errorMessage ? `Error: ${event.errorMessage}` : ''}
${event.errorDetails ? `Details: ${event.errorDetails}` : ''}
---`
  )
  .join('\n')}`;

    navigator.clipboard.writeText(historyText);
  }
}
