import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { TranslocoModule } from '@ngneat/transloco';
import type { OptimalConfig } from '../../../../core/clients/nodes.client';
import { NodesClient } from '../../../../core/clients/nodes.client';
import { NodeScheduleEditorComponent } from '../../../../shared/components/node-schedule-editor/node-schedule-editor.component';
import type { Node, NodeCapabilityTestResult } from '../../models/node.model';

export interface NodeConfigModalData {
  node: Node;
}

/**
 * Node Configuration Modal
 *
 * Allows editing node settings:
 * - Name
 * - Max Workers (with auto-detected recommendations)
 * - CPU Limit
 *
 * Also provides "Test Capabilities" button to re-run network and storage detection
 */
@Component({
  selector: 'app-node-config-modal',
  standalone: true,
  imports: [FontAwesomeModule, ReactiveFormsModule, NodeScheduleEditorComponent, TranslocoModule],
  templateUrl: './node-config.modal.html',
  styleUrls: ['./node-config.modal.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodeConfigModalComponent implements OnInit {
  private readonly dialogRef = inject(DialogRef<NodeConfigModalComponent>);
  private readonly fb = inject(FormBuilder);
  private readonly nodesClient = inject(NodesClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  readonly data: NodeConfigModalData = inject(DIALOG_DATA);

  readonly form: FormGroup;
  optimalConfig: OptimalConfig | null = null;
  loadingRecommendations = false;
  testingCapabilities = signal(false);

  constructor() {
    this.form = this.fb.group({
      name: [
        this.data.node.name,
        [Validators.required, Validators.minLength(1), Validators.maxLength(255)],
      ],
      maxWorkers: [
        this.data.node.maxWorkers,
        [Validators.required, Validators.min(1), Validators.max(20)],
      ],
      cpuLimit: [
        this.data.node.cpuLimit,
        [Validators.required, Validators.min(10), Validators.max(100)],
      ],
      scheduleEnabled: [this.data.node.scheduleEnabled ?? false],
      scheduleWindows: [this.data.node.scheduleWindows ?? []],
    });
  }

  ngOnInit(): void {
    this.loadRecommendations();
  }

  get nameControl() {
    return this.form.get('name');
  }

  get maxWorkersControl() {
    return this.form.get('maxWorkers');
  }

  get cpuLimitControl() {
    return this.form.get('cpuLimit');
  }

  get showCpuWarning(): boolean {
    const cpuLimit = this.cpuLimitControl?.value;
    return cpuLimit !== null && cpuLimit !== undefined && cpuLimit > 90;
  }

  get showWorkerWarning(): boolean {
    if (!this.optimalConfig) return false;
    const currentWorkers = this.maxWorkersControl?.value;
    return (
      currentWorkers !== null &&
      currentWorkers !== undefined &&
      currentWorkers > this.optimalConfig.recommendedMaxWorkers
    );
  }

  get workerWarningMessage(): string {
    if (!this.optimalConfig) return '';
    const currentWorkers = this.maxWorkersControl?.value;
    const recommended = this.optimalConfig.recommendedMaxWorkers;

    if (currentWorkers > recommended * 2) {
      return `⚠️ ${currentWorkers} workers is critically high! Jobs will fail due to resource starvation. Recommended: ${recommended}`;
    }
    if (currentWorkers > recommended) {
      return `⚠️ ${currentWorkers} workers may cause resource contention. Recommended: ${recommended}`;
    }
    return '';
  }

  private loadRecommendations(): void {
    this.loadingRecommendations = true;
    this.nodesClient.getRecommendedConfig(this.data.node.id).subscribe({
      next: (config) => {
        this.optimalConfig = config;
        this.loadingRecommendations = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingRecommendations = false;
        this.cdr.markForCheck();
      },
    });
  }

  applyRecommended(): void {
    if (this.optimalConfig) {
      this.form.patchValue({
        maxWorkers: this.optimalConfig.recommendedMaxWorkers,
      });
      this.cdr.markForCheck();
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    if (this.form.valid) {
      this.dialogRef.close(this.form.value);
    }
  }

  /**
   * Test node capabilities
   * Runs network location and shared storage detection
   */
  onTestCapabilities(): void {
    this.testingCapabilities.set(true);
    this.nodesClient
      .testCapabilities(this.data.node.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results: NodeCapabilityTestResult) => {
          this.testingCapabilities.set(false);
          this.cdr.markForCheck();

          // Show results in a dialog (we'll use the browser alert for now, can enhance later)
          const summary = this.formatCapabilityResults(results);
          alert(summary);
        },
        error: (err) => {
          this.testingCapabilities.set(false);
          this.cdr.markForCheck();
          alert(`Failed to test capabilities: ${err?.error?.message || 'Unknown error'}`);
        },
      });
  }

  /**
   * Format capability test results for display
   */
  private formatCapabilityResults(results: NodeCapabilityTestResult): string {
    const lines = [
      'Node Capability Test Results',
      '============================',
      '',
      `Network Location: ${results.networkLocation}`,
      `Latency: ${results.latencyMs}ms`,
      `Private IP: ${results.isPrivateIP ? 'Yes' : 'No'}`,
      '',
      `Shared Storage: ${results.hasSharedStorage ? 'Available' : 'Not Available'}`,
    ];

    if (results.storageBasePath) {
      lines.push(`Storage Path: ${results.storageBasePath}`);
    }

    lines.push('', results.reasoning);

    return lines.join('\n');
  }
}
