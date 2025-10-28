import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-error-details-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './error-details-modal.component.html',
  styleUrls: ['./error-details-modal.component.scss'],
})
export class ErrorDetailsModalComponent {
  @Input() isOpen = false;
  @Input() fileName = '';
  @Input() error = '';
  @Input() status = '';
  @Input() jobId = '';

  @Output() closeModal = new EventEmitter<void>();

  protected showTechnicalDetails = false;

  close() {
    this.closeModal.emit();
  }

  toggleTechnicalDetails() {
    this.showTechnicalDetails = !this.showTechnicalDetails;
  }

  getErrorSummary(): string {
    const errorLower = (this.error || '').toLowerCase();

    if (errorLower.includes('exit code 1')) {
      return 'Encoding failed due to an FFmpeg error. The file may be corrupted or use unsupported codecs.';
    } else if (
      errorLower.includes('segmentation fault') ||
      errorLower.includes('exit code 134') ||
      errorLower.includes('exit code 139')
    ) {
      return 'FFmpeg crashed while processing this file. The file may be corrupted.';
    } else if (errorLower.includes('file not found') || errorLower.includes('does not exist')) {
      return 'The source file could not be found. It may have been moved or deleted.';
    } else if (errorLower.includes('permission')) {
      return 'Permission denied. Check file and directory permissions.';
    } else if (errorLower.includes('job stuck') || errorLower.includes('no progress')) {
      return 'The encoding process stopped responding and was terminated.';
    } else if (errorLower.includes('verification failed') || errorLower.includes('not playable')) {
      return 'The encoded file failed verification. The output file is not valid.';
    }

    return 'An error occurred during encoding. Check technical details for more information.';
  }

  hasContextualHelp(): boolean {
    const errorLower = (this.error || '').toLowerCase();
    return (
      errorLower.includes('exit code') ||
      errorLower.includes('segmentation') ||
      errorLower.includes('file not found') ||
      errorLower.includes('permission') ||
      errorLower.includes('verification failed') ||
      errorLower.includes('job stuck') ||
      errorLower.includes('no progress')
    );
  }

  getContextualHelp(): string {
    const errorLower = (this.error || '').toLowerCase();

    if (errorLower.includes('file not found') || errorLower.includes('does not exist')) {
      return 'Verify the file still exists in the library. Check if the storage is mounted correctly.';
    } else if (errorLower.includes('permission')) {
      return 'Ensure the BitBonsai service has read/write access to the library and output directories.';
    } else if (errorLower.includes('job stuck') || errorLower.includes('no progress')) {
      return 'FFmpeg stopped producing output, likely due to a crash or corrupted file. Check the technical details for specific errors, or try re-queueing the job.';
    } else if (
      errorLower.includes('segmentation fault') ||
      errorLower.includes('exit code 134') ||
      errorLower.includes('exit code 139')
    ) {
      return 'Try re-downloading the source file. If the issue persists, the file may need repair or re-encoding from the original source.';
    } else if (errorLower.includes('verification failed')) {
      return 'The encoding completed but the output is invalid. Try encoding with different settings or check the source file integrity.';
    } else if (errorLower.includes('exit code 1')) {
      return 'Check the technical details for specific FFmpeg errors. The file may use codecs that require special handling.';
    }

    return 'Review the technical details below to diagnose the issue. You can retry the job if this was a temporary problem.';
  }

  copyToClipboard() {
    const errorText = `Job ID: ${this.jobId}
File: ${this.fileName}
Status: ${this.status}

Error Details:
${this.error}`;

    navigator.clipboard.writeText(errorText);
  }
}
