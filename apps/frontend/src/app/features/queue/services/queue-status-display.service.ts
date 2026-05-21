import { Injectable } from '@angular/core';
import { FileHealthStatus } from '../../libraries/models/library.model';
import { JobEventType } from '../models/job-history-event.model';
import { JobStatus } from '../models/job-status.enum';

@Injectable({
  providedIn: 'root',
})
export class QueueStatusDisplayService {
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
}
