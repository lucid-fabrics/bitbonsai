import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  OnInit,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import type { OptimalConfig } from '../../../../core/clients/nodes.client';
import { NodesClient } from '../../../../core/clients/nodes.client';
import type { Node } from '../../models/node.model';

export interface NodeConfigModalData {
  node: Node;
}

@Component({
  selector: 'app-node-config-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './node-config.modal.html',
  styleUrls: ['./node-config.modal.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodeConfigModalComponent implements OnInit {
  private readonly dialogRef = inject(DialogRef<NodeConfigModalComponent>);
  private readonly fb = inject(FormBuilder);
  private readonly nodesClient = inject(NodesClient);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly data: NodeConfigModalData = inject(DIALOG_DATA);

  readonly form: FormGroup;
  optimalConfig: OptimalConfig | null = null;
  loadingRecommendations = false;

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
}
