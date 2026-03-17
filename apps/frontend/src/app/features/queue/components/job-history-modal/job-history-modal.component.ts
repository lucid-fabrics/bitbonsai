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
    const errorMsg = event.errorMessage?.toLowerCase() || '';
    const errorDetails = event.errorDetails?.toLowerCase() || '';
    const combinedError = `${errorMsg} ${errorDetails}`;

    // FFmpeg specific errors
    if (
      combinedError.includes('invalid data found when processing input') ||
      combinedError.includes('moov atom not found')
    ) {
      return 'The video file appears to be corrupted or incomplete. The file may have been damaged during transfer or recording.';
    }

    if (combinedError.includes('no such file or directory') || combinedError.includes('enoent')) {
      return 'The source video file could not be found. It may have been moved, deleted, or the path is incorrect.';
    }

    if (combinedError.includes('permission denied') || combinedError.includes('eacces')) {
      return 'BitBonsai does not have permission to access the video file or output directory.';
    }

    if (
      combinedError.includes('disk') &&
      (combinedError.includes('full') || combinedError.includes('space'))
    ) {
      return 'The disk is full. Free up space on the destination drive to continue encoding.';
    }

    if (combinedError.includes('codec') && combinedError.includes('not supported')) {
      return 'The video uses an unsupported codec. The file may need to be re-encoded with different settings.';
    }

    if (combinedError.includes('timeout') || combinedError.includes('timed out')) {
      return 'The encoding process took too long and was stopped. This may indicate a problem with the video file or encoding settings.';
    }

    if (
      combinedError.includes('killed') ||
      combinedError.includes('sigkill') ||
      combinedError.includes('sigterm')
    ) {
      return 'The encoding process was terminated unexpectedly. This usually happens when the system runs out of memory or the backend was restarted.';
    }

    if (
      combinedError.includes('conversion failed') ||
      combinedError.includes('error while') ||
      combinedError.includes('failed')
    ) {
      return 'The video encoding failed. Check the technical details below for specific error information.';
    }

    // Additional specific error patterns
    if (
      combinedError.includes('av_interleaved_write_frame') ||
      combinedError.includes('broken pipe')
    ) {
      return 'The encoding process was interrupted while writing output. This may indicate a disk write error or insufficient space.';
    }

    if (combinedError.includes('invalid argument') || combinedError.includes('invalid option')) {
      return 'The encoding settings contain an invalid configuration. The encoding profile may need to be adjusted.';
    }

    if (combinedError.includes('decoder') && combinedError.includes('not found')) {
      return 'The required video decoder is missing or not available. The video format may not be supported.';
    }

    // Generic event type summaries
    switch (event.eventType) {
      case JobEventType.CANCELLED:
        return 'The encoding job was manually cancelled by a user or administrator.';
      case JobEventType.TIMEOUT:
        return 'The encoding process exceeded the maximum allowed time and was automatically stopped.';
      case JobEventType.BACKEND_RESTART:
        return 'The BitBonsai backend service was restarted while this job was processing.';
      case JobEventType.AUTO_HEALED:
        return 'The job automatically recovered from a previous failure and will retry encoding.';
      case JobEventType.RESTARTED:
        return 'The job was manually restarted to attempt encoding again.';
      default:
        // Fall back to system message or event type - no generic "error occurred" message
        return event.systemMessage || this.getEventTypeLabel(event.eventType);
    }
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
