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
import { Router } from '@angular/router';
import { interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { NodesClient } from '../../core/clients/nodes.client';
import type {
  DiscoveredMainNode,
  RegistrationRequest,
} from '../nodes/models/registration-request.model';
import {
  ContainerType,
  RegistrationRequestStatus,
} from '../nodes/models/registration-request.model';

@Component({
  selector: 'app-discovery',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './discovery.page.html',
  styleUrls: ['./discovery.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryComponent implements OnInit {
  private readonly nodesClient = inject(NodesClient);
  private readonly dialog = inject(Dialog);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  // Expose enums to template
  readonly RegistrationRequestStatus = RegistrationRequestStatus;
  readonly ContainerType = ContainerType;

  // State
  discoveredMainNodes: DiscoveredMainNode[] = [];
  currentRequest: RegistrationRequest | null = null;
  isSearching = false;
  isLoadingRequest = false;
  error: string | null = null;

  ngOnInit(): void {
    this.searchForMainNodes();
    this.checkCurrentRequest();
    this.startPolling();
  }

  /**
   * Search for MAIN nodes on the network using mDNS
   */
  searchForMainNodes(): void {
    this.isSearching = true;
    this.error = null;
    this.cdr.markForCheck();

    this.nodesClient
      .discoverMainNodes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (nodes) => {
          this.discoveredMainNodes = nodes;
          this.isSearching = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to discover MAIN nodes';
          this.isSearching = false;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Check if there's a current pending registration request
   */
  private checkCurrentRequest(): void {
    this.isLoadingRequest = true;
    this.cdr.markForCheck();

    this.nodesClient
      .getPendingRequests()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (requests) => {
          // Find the first pending request for this node
          this.currentRequest =
            requests.find((r) => r.status === RegistrationRequestStatus.PENDING) || null;
          this.isLoadingRequest = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.isLoadingRequest = false;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Poll for request status updates every 5 seconds
   */
  private startPolling(): void {
    interval(5000)
      .pipe(
        switchMap(() => this.nodesClient.getPendingRequests()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (requests) => {
          const previousStatus = this.currentRequest?.status;
          this.currentRequest =
            requests.find((r) => r.status === RegistrationRequestStatus.PENDING) || null;

          // If request was approved, redirect to dashboard
          if (previousStatus === RegistrationRequestStatus.PENDING && !this.currentRequest) {
            this.router.navigate(['/overview']);
          }

          this.cdr.markForCheck();
        },
        error: () => {
          // Ignore polling errors
        },
      });
  }

  /**
   * Send registration request to a MAIN node
   */
  onRegisterWithMainNode(mainNode: DiscoveredMainNode): void {
    this.isLoadingRequest = true;
    this.error = null;
    this.cdr.markForCheck();

    this.nodesClient
      .createRegistrationRequest({ mainNodeId: mainNode.nodeId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (request) => {
          this.currentRequest = request;
          this.isLoadingRequest = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to send registration request';
          this.isLoadingRequest = false;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Cancel the current registration request
   */
  onCancelRequest(): void {
    if (!this.currentRequest) return;

    this.isLoadingRequest = true;
    this.error = null;
    this.cdr.markForCheck();

    this.nodesClient
      .cancelRequest(this.currentRequest.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.currentRequest = null;
          this.isLoadingRequest = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to cancel request';
          this.isLoadingRequest = false;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Navigate to setup to become a MAIN node instead
   */
  onBecomeMainNode(): void {
    this.router.navigate(['/setup'], {
      queryParams: { becomeMain: true },
    });
  }

  /**
   * Get time remaining until request expiration
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
}
