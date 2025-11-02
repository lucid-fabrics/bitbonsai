import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { JobEventType, type JobHistoryEvent } from '../../models/job-history-event.model';

@Component({
  selector: 'app-job-history-modal',
  standalone: true,
  imports: [CommonModule],
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
