import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { RegistrationRequest } from '../../nodes/models/registration-request.model';
import { ContainerType } from '../../nodes/models/registration-request.model';

export interface ApprovalDialogData {
  request: RegistrationRequest;
}

export interface ApprovalDialogResult {
  maxWorkers?: number;
  cpuLimit?: number;
}

@Component({
  selector: 'app-approval-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['./approval-dialog.component.scss'],
  template: `
    <div class="dialog-container">
      <div class="dialog-header">
        <h2>Approve Registration Request</h2>
        <button class="close-btn" (click)="dialogRef.close()">×</button>
      </div>

      <div class="dialog-body">
        <!-- Node Information -->
        <div class="info-section">
          <h3>Node Information</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="label">Name:</span>
              <span class="value">{{ data.request.childNodeName }}</span>
            </div>
            <div class="info-item">
              <span class="label">IP Address:</span>
              <span class="value">{{ data.request.ipAddress }}</span>
            </div>
            <div class="info-item">
              <span class="label">Hostname:</span>
              <span class="value">{{ data.request.hostname }}</span>
            </div>
            <div class="info-item">
              <span class="label">Container Type:</span>
              <span class="value">{{ getContainerTypeLabel(data.request.containerType) }}</span>
            </div>
            <div class="info-item">
              <span class="label">Version:</span>
              <span class="value">{{ data.request.childVersion }}</span>
            </div>
            <div class="info-item">
              <span class="label">Acceleration:</span>
              <span class="value">{{ data.request.acceleration }}</span>
            </div>
          </div>
        </div>

        <!-- Hardware Specifications -->
        <div class="info-section">
          <h3>Hardware Specifications</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="label">CPU:</span>
              <span class="value">{{ data.request.hardwareSpecs.cpuCores }} cores - {{ data.request.hardwareSpecs.cpuModel }}</span>
            </div>
            <div class="info-item">
              <span class="label">RAM:</span>
              <span class="value">{{ data.request.hardwareSpecs.ramGb }} GB</span>
            </div>
            <div class="info-item">
              <span class="label">Disk:</span>
              <span class="value">{{ data.request.hardwareSpecs.diskGb }} GB</span>
            </div>
            <div class="info-item" *ngIf="data.request.hardwareSpecs.gpuModel">
              <span class="label">GPU:</span>
              <span class="value">{{ data.request.hardwareSpecs.gpuModel }}</span>
            </div>
          </div>
        </div>

        <!-- Message from child node -->
        <div class="info-section" *ngIf="data.request.message">
          <h3>Message</h3>
          <p class="message">{{ data.request.message }}</p>
        </div>

        <!-- Configuration -->
        <div class="config-section">
          <h3>Node Configuration</h3>
          <div class="form-group">
            <label for="maxWorkers">Max Concurrent Jobs (1-12):</label>
            <input
              type="number"
              id="maxWorkers"
              [(ngModel)]="maxWorkers"
              min="1"
              max="12"
              class="form-control"
            />
            <small>Number of encoding jobs this node can handle simultaneously</small>
          </div>

          <div class="form-group">
            <label for="cpuLimit">CPU Limit (10-100%):</label>
            <input
              type="number"
              id="cpuLimit"
              [(ngModel)]="cpuLimit"
              min="10"
              max="100"
              class="form-control"
            />
            <small>Maximum CPU usage allowed for this node</small>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-secondary" (click)="dialogRef.close()">Cancel</button>
        <button class="btn btn-primary" (click)="approve()">
          Approve & Add Node
        </button>
      </div>
    </div>
  `,
})
export class ApprovalDialogComponent {
  readonly data: ApprovalDialogData = inject(DIALOG_DATA);
  readonly dialogRef = inject(DialogRef);

  // Expose enum to template
  readonly ContainerType = ContainerType;

  // Default configuration
  maxWorkers = 2;
  cpuLimit = 80;

  approve(): void {
    const result: ApprovalDialogResult = {
      maxWorkers: this.maxWorkers,
      cpuLimit: this.cpuLimit,
    };
    this.dialogRef.close(result);
  }

  getContainerTypeLabel(type: ContainerType): string {
    const labels: Record<ContainerType, string> = {
      [ContainerType.BARE_METAL]: 'Bare Metal',
      [ContainerType.DOCKER]: 'Docker',
      [ContainerType.LXC]: 'LXC Container',
      [ContainerType.VM]: 'Virtual Machine',
      [ContainerType.UNKNOWN]: 'Unknown',
    };
    return labels[type];
  }
}
