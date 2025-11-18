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
        switchMap(() => {
          // If we have a current request, poll its specific status
          if (this.currentRequest) {
            return this.nodesClient.getRegistrationRequest(this.currentRequest.id);
          }
          // Otherwise, check for any pending requests
          return this.nodesClient
            .getPendingRequests()
            .pipe(
              switchMap((requests) =>
                requests.length > 0
                  ? this.nodesClient.getRegistrationRequest(requests[0].id)
                  : Promise.resolve(null)
              )
            );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (request) => {
          if (!request) {
            this.currentRequest = null;
            this.cdr.markForCheck();
            return;
          }

          const previousStatus = this.currentRequest?.status;
          this.currentRequest = request;

          // If request was just approved, setup SSH keys
          if (
            previousStatus === RegistrationRequestStatus.PENDING &&
            request.status === RegistrationRequestStatus.APPROVED &&
            request.mainNodePublicKey
          ) {
            this.handleApproval(request);
          }

          this.cdr.markForCheck();
        },
        error: () => {
          // Ignore polling errors
        },
      });
  }

  /**
   * Handle request approval - add main node's SSH key to authorized_keys
   */
  private handleApproval(request: RegistrationRequest): void {
    if (!request.mainNodePublicKey) return;

    // Add main node's SSH public key to this node's authorized_keys
    this.nodesClient
      .addAuthorizedKey(request.mainNodePublicKey, 'bitbonsai-main-node')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // SSH key setup complete, redirect to dashboard
          setTimeout(() => {
            this.router.navigate(['/overview'], {
              queryParams: { registrationComplete: true },
            });
          }, 2000);
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to setup SSH keys';
          this.cdr.markForCheck();
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

    // First, get this node's SSH public key
    this.nodesClient
      .getSshPublicKey()
      .pipe(
        switchMap((keyResponse) => {
          // Then create registration request with SSH public key
          return this.nodesClient.createRegistrationRequest({
            mainNodeId: mainNode.nodeId,
            sshPublicKey: keyResponse.publicKey,
          });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
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
