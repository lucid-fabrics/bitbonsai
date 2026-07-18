import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslocoModule } from '@ngneat/transloco';

@Component({
  selector: 'app-error-details-modal',
  standalone: true,
  imports: [TranslocoModule],
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

  private static readonly ACTIONS_MARKER = '**Recommended Actions:**';
  private static readonly DETAILS_MARKER = '**Technical Details:**';

  close() {
    this.closeModal.emit();
  }

  toggleTechnicalDetails() {
    this.showTechnicalDetails = !this.showTechnicalDetails;
  }

  /**
   * True when the error text is a pre-formatted backend analysis
   * (produced by ffmpeg-error-analyzer.util.ts on the backend).
   */
  private isBackendAnalysis(): boolean {
    const error = this.error || '';
    return (
      error.includes(ErrorDetailsModalComponent.ACTIONS_MARKER) ||
      error.startsWith('[FATAL]') ||
      error.startsWith('[RETRIABLE]')
    );
  }

  /**
   * Parse the backend analysis format:
   * optional '[FATAL] ' / '[RETRIABLE] ' prefix, title line with emoji,
   * description paragraph, optional '**Technical Details:**' section,
   * and a '**Recommended Actions:**' section with indented lines.
   */
  private parseBackendAnalysis(): {
    title: string;
    description: string;
    steps: { icon: string; text: string }[];
  } {
    const text = (this.error || '').replace(/^\[(FATAL|RETRIABLE)\]\s*/, '');
    const [head, actions = ''] = text.split(ErrorDetailsModalComponent.ACTIONS_MARKER);
    const headLines = head
      .split(ErrorDetailsModalComponent.DETAILS_MARKER)[0]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return {
      title: headLines[0] || 'Encoding failed',
      description: headLines.slice(1).join(' '),
      steps: actions
        .split('\n')
        .map((line) => line.trim().replace(/\*\*/g, ''))
        .filter((line) => line.length > 0)
        .map((line) => ({ icon: 'fa-angle-right', text: line })),
    };
  }

  getErrorSummary(): string {
    if (this.isBackendAnalysis()) {
      return this.parseBackendAnalysis().title;
    }

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
    if (this.isBackendAnalysis()) {
      return this.parseBackendAnalysis().description.length > 0;
    }

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
    if (this.isBackendAnalysis()) {
      return this.parseBackendAnalysis().description;
    }

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

  getActionableSteps(): { icon: string; text: string }[] {
    if (this.isBackendAnalysis()) {
      const backendSteps = this.parseBackendAnalysis().steps;
      if (backendSteps.length > 0) {
        return backendSteps;
      }
    }

    const errorLower = (this.error || '').toLowerCase();
    const steps: { icon: string; text: string }[] = [];

    if (errorLower.includes('not found') || errorLower.includes('enoent')) {
      steps.push({
        icon: 'fa-search',
        text: 'Re-scan the library to detect file changes',
      });
    } else if (
      errorLower.includes('segmentation fault') ||
      errorLower.includes('exit code 13') ||
      errorLower.includes('exit code 139')
    ) {
      steps.push({
        icon: 'fa-share',
        text: 'Try retrying on a different node',
      });
    } else if (errorLower.includes('stuck') || errorLower.includes('no progress')) {
      steps.push({
        icon: 'fa-cog',
        text: 'File may be problematic - try a different encoding policy',
      });
    } else if (errorLower.includes('verification failed') || errorLower.includes('not playable')) {
      steps.push({
        icon: 'fa-sliders-h',
        text: 'Try with different quality settings',
      });
    } else if (errorLower.includes('permission') || errorLower.includes('eacces')) {
      steps.push({
        icon: 'fa-lock',
        text: 'Check file permissions on the storage volume',
      });
    } else if (errorLower.includes('corrupt')) {
      steps.push({
        icon: 'fa-play-circle',
        text: 'File may be damaged - try playing it in VLC to verify',
      });
    } else {
      steps.push({
        icon: 'fa-redo',
        text: 'Try retrying. If it keeps failing, the file may need inspection',
      });
    }

    return steps;
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
