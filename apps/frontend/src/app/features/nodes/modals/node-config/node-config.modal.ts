import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
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
export class NodeConfigModalComponent {
  private readonly dialogRef = inject(DialogRef<NodeConfigModalComponent>);
  private readonly fb = inject(FormBuilder);
  readonly data: NodeConfigModalData = inject(DIALOG_DATA);

  readonly form: FormGroup;

  constructor() {
    this.form = this.fb.group({
      name: [
        this.data.node.name,
        [Validators.required, Validators.minLength(1), Validators.maxLength(255)],
      ],
      maxWorkers: [
        this.data.node.maxWorkers,
        [Validators.required, Validators.min(1), Validators.max(10)],
      ],
      cpuLimit: [
        this.data.node.cpuLimit,
        [Validators.required, Validators.min(10), Validators.max(100)],
      ],
    });
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

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    if (this.form.valid) {
      this.dialogRef.close(this.form.value);
    }
  }
}
