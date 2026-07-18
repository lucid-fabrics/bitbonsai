import { A11yModule } from '@angular/cdk/a11y';
import { Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoModule } from '@ngneat/transloco';
import { Store } from '@ngrx/store';
import { SettingsSelectors } from '../../../settings/+state/settings.selectors';

@Component({
  selector: 'app-error-details-modal',
  standalone: true,
  imports: [A11yModule, TranslocoModule],
  templateUrl: './error-details-modal.component.html',
  styleUrls: ['./error-details-modal.component.scss'],
})
export class ErrorDetailsModalComponent {
  private readonly store = inject(Store);
  readonly advancedMode = toSignal(this.store.select(SettingsSelectors.selectAdvancedMode), {
    initialValue: false,
  });

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
      return 'This video could not be converted. Your original file is untouched.';
    } else if (
      errorLower.includes('segmentation fault') ||
      errorLower.includes('exit code 134') ||
      errorLower.includes('exit code 139')
    ) {
      return 'The conversion stopped unexpectedly. Your original file is untouched.';
    } else if (errorLower.includes('file not found') || errorLower.includes('does not exist')) {
      return 'The source video could not be found. It may have been moved or deleted.';
    } else if (errorLower.includes('permission')) {
      return 'BitBonsai could not access this video file. Your original file is untouched.';
    } else if (errorLower.includes('job stuck') || errorLower.includes('no progress')) {
      return 'The conversion stopped responding and was safely stopped.';
    } else if (errorLower.includes('verification failed') || errorLower.includes('not playable')) {
      return 'The converted file did not pass the quality check, so it was not kept. Your original file is untouched.';
    }

    return 'This video could not be converted. Your original file is untouched.';
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
      return 'If the file is back in your library, BitBonsai will find it on the next scan.';
    } else if (errorLower.includes('permission')) {
      return 'BitBonsai retries automatically. You can also retry anytime.';
    } else if (errorLower.includes('job stuck') || errorLower.includes('no progress')) {
      return 'BitBonsai retries automatically. You can also retry anytime.';
    } else if (
      errorLower.includes('segmentation fault') ||
      errorLower.includes('exit code 134') ||
      errorLower.includes('exit code 139')
    ) {
      return 'This can happen with damaged files. BitBonsai retries automatically. You can also retry anytime.';
    } else if (errorLower.includes('verification failed')) {
      return 'BitBonsai keeps your original whenever a conversion does not pass its checks.';
    } else if (errorLower.includes('exit code 1')) {
      return 'BitBonsai retries automatically. You can also retry anytime.';
    }

    return 'BitBonsai retries automatically. You can also retry anytime.';
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
        text: 'Re-scan the library to pick up file changes',
      });
    } else if (
      errorLower.includes('segmentation fault') ||
      errorLower.includes('exit code 13') ||
      errorLower.includes('exit code 139')
    ) {
      steps.push({
        icon: 'fa-redo',
        text: 'BitBonsai retries automatically. You can also retry anytime',
      });
    } else if (errorLower.includes('stuck') || errorLower.includes('no progress')) {
      steps.push({
        icon: 'fa-cog',
        text: 'Try a different encoding policy for this video',
      });
    } else if (errorLower.includes('verification failed') || errorLower.includes('not playable')) {
      steps.push({
        icon: 'fa-sliders-h',
        text: 'Try again with different quality settings',
      });
    } else if (errorLower.includes('permission') || errorLower.includes('eacces')) {
      steps.push({
        icon: 'fa-redo',
        text: 'BitBonsai retries automatically. You can also retry anytime',
      });
    } else if (errorLower.includes('corrupt')) {
      steps.push({
        icon: 'fa-shield-alt',
        text: 'This file may be damaged. Your original is untouched',
      });
    } else {
      steps.push({
        icon: 'fa-redo',
        text: 'BitBonsai retries automatically. You can also retry anytime',
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
