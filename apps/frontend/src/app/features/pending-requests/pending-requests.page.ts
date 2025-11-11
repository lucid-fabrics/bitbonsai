import { Dialog } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  type OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { NodesClient } from '../../core/clients/nodes.client';
import type { RegistrationRequest } from '../nodes/models/registration-request.model';
import {
  ContainerType,
  RegistrationRequestStatus,
} from '../nodes/models/registration-request.model';
import {
  ApprovalDialogComponent,
  type ApprovalDialogData,
} from './dialogs/approval-dialog.component';
import {
  RejectionDialogComponent,
  type RejectionDialogData,
} from './dialogs/rejection-dialog.component';

@Component({
  selector: 'app-pending-requests',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pending-requests.page.html',
  styleUrls: ['./pending-requests.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendingRequestsPage implements OnInit {
  private readonly nodesClient = inject(NodesClient);
  private readonly dialog = inject(Dialog);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  // Expose enums to template
  readonly ContainerType = ContainerType;
  readonly RegistrationRequestStatus = RegistrationRequestStatus;

  // State
  pendingRequests: RegistrationRequest[] = [];
  isLoading = false;
  error: string | null = null;

  ngOnInit(): void {
    this.loadPendingRequests();
    this.startPolling();
  }

  /**
   * Load pending registration requests
   */
  loadPendingRequests(): void {
    this.isLoading = true;
    this.error = null;
    this.cdr.markForCheck();

    this.nodesClient
      .getPendingRequests()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (requests) => {
          this.pendingRequests = requests;
          this.isLoading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to load pending requests';
          this.isLoading = false;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Start polling for new requests every 10 seconds
   */
  private startPolling(): void {
    interval(10000)
      .pipe(
        switchMap(() => this.nodesClient.getPendingRequests()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (requests) => {
          this.pendingRequests = requests;
          this.cdr.markForCheck();
        },
        error: () => {
          // Ignore polling errors
        },
      });
  }

  /**
   * Open approval dialog
   */
  onApprove(request: RegistrationRequest): void {
    const dialogData: ApprovalDialogData = {
      request,
    };

    const dialogRef = this.dialog.open(ApprovalDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result) {
        this.approveRequest(request.id, result);
      }
    });
  }

  /**
   * Approve a registration request
   */
  private approveRequest(
    requestId: string,
    config?: { maxWorkers?: number; cpuLimit?: number }
  ): void {
    this.nodesClient
      .approveRequest(requestId, config)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadPendingRequests();
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to approve request';
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Open rejection dialog
   */
  onReject(request: RegistrationRequest): void {
    const dialogData: RejectionDialogData = {
      request,
    };

    const dialogRef = this.dialog.open(RejectionDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((reason) => {
      if (reason && typeof reason === 'string') {
        this.rejectRequest(request.id, reason);
      }
    });
  }

  /**
   * Reject a registration request
   */
  private rejectRequest(requestId: string, reason: string): void {
    this.nodesClient
      .rejectRequest(requestId, { reason })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadPendingRequests();
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to reject request';
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Get container type label
   */
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

  /**
   * Get time remaining until expiration
   */
  getTimeRemaining(request: RegistrationRequest): string {
    const expiresAt = new Date(request.tokenExpiresAt);
    const now = new Date();
    const diff = expiresAt.getTime() - now.getTime();

    if (diff <= 0) return 'Expired';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Format timestamp
   */
  formatTimestamp(date: Date): string {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const diffMins = Math.floor(diff / 60000);

    if (diffMins < 60) {
      if (diffMins < 1) return 'Just now';
      if (diffMins === 1) return '1 minute ago';
      return `${diffMins} minutes ago`;
    }

    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    };
    return d.toLocaleDateString('en-US', options);
  }
}
