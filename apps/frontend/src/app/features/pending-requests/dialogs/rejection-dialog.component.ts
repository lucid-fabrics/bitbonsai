import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { RegistrationRequest } from '../../nodes/models/registration-request.model';

export interface RejectionDialogData {
  request: RegistrationRequest;
}

@Component({
  selector: 'app-rejection-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['./rejection-dialog.component.scss'],
  template: `
    <div class="dialog-container">
      <div class="dialog-header">
        <h2>Reject Registration Request</h2>
        <button class="close-btn" (click)="dialogRef.close()">×</button>
      </div>

      <div class="dialog-body">
        <p class="warning-text">
          You are about to reject the registration request from:
        </p>

        <div class="node-info">
          <div class="info-row">
            <span class="label">Node Name:</span>
            <span class="value">{{ data.request.childNodeName }}</span>
          </div>
          <div class="info-row">
            <span class="label">IP Address:</span>
            <span class="value">{{ data.request.ipAddress }}</span>
          </div>
          <div class="info-row">
            <span class="label">Hostname:</span>
            <span class="value">{{ data.request.hostname }}</span>
          </div>
        </div>

        <div class="form-group">
          <label for="reason">Rejection Reason<span class="required">*</span>:</label>
          <textarea
            id="reason"
            [(ngModel)]="rejectionReason"
            placeholder="Enter reason for rejection (e.g., 'Unauthorized device', 'Security policy violation', etc.)"
            rows="4"
            class="form-control"
            [class.error]="showError && !rejectionReason.trim()"
          ></textarea>
          <small *ngIf="showError && !rejectionReason.trim()" class="error-text">
            Rejection reason is required
          </small>
        </div>

        <p class="info-text">
          The child node will be notified of the rejection and will not be added to the network.
        </p>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-secondary" (click)="dialogRef.close()">Cancel</button>
        <button class="btn btn-danger" (click)="reject()">
          Reject Request
        </button>
      </div>
    </div>
  `,
})
export class RejectionDialogComponent {
  readonly data: RejectionDialogData = inject(DIALOG_DATA);
  readonly dialogRef = inject(DialogRef);

  rejectionReason = '';
  showError = false;

  reject(): void {
    if (!this.rejectionReason.trim()) {
      this.showError = true;
      return;
    }

    this.dialogRef.close(this.rejectionReason.trim());
  }
}
