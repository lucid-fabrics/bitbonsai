import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import type { RegistrationRequest } from '../../nodes/models/registration-request.model';
import { ContainerType } from '../../nodes/models/registration-request.model';

export interface ApprovalDialogData {
  request: RegistrationRequest;
}

// Approval dialog simply returns true when approved, null/undefined when cancelled

@Component({
  selector: 'app-approval-dialog',
  standalone: true,
  imports: [CommonModule],
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

        <!-- Note about configuration -->
        <div class="info-section note-section">
          <div class="note-box">
            <i class="fa fa-info-circle"></i>
            <div>
              <strong>Node Configuration</strong>
              <p>After approval, the child node will configure its own settings (max concurrent jobs, CPU limits) based on its available hardware resources.</p>
            </div>
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

  approve(): void {
    this.dialogRef.close(true);
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
