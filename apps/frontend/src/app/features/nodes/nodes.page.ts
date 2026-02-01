import { Dialog } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { NodesClient } from '../../core/clients/nodes.client';
import { EnvironmentDetectionService } from '../../core/services/environment-detection.service';
import {
  ConfirmationDialogComponent,
  type ConfirmationDialogData,
} from '../../shared/components/confirmation-dialog/confirmation-dialog.component';
import { StorageRecommendationBannerComponent } from '../../shared/components/storage-recommendation-banner/storage-recommendation-banner.component';
import {
  type StorageSetupWizardData,
  StorageSetupWizardModal,
} from '../../shared/components/storage-setup-wizard/storage-setup-wizard.modal';
import { RichTooltipDirective } from '../../shared/directives/rich-tooltip.directive';
import {
  ApprovalDialogComponent,
  type ApprovalDialogData,
  type ApprovalDialogResult,
} from '../pending-requests/dialogs/approval-dialog.component';
import {
  RejectionDialogComponent,
  type RejectionDialogData,
} from '../pending-requests/dialogs/rejection-dialog.component';
import { NodeBo } from './bos/node.bo';
import { TimerBo } from './bos/timer.bo';
import { TokenEntryDialogComponent } from './dialogs/token-entry-dialog.component';
import { NodeConfigModalComponent } from './modals/node-config/node-config.modal';
import { NodeStatsModalComponent } from './modals/node-stats/node-stats.modal';
import { StorageSharesModal } from './modals/storage-shares/storage-shares.modal';
import type { Node } from './models/node.model';
import { AccelerationType, NodeRole, NodeStatus } from './models/node.model';
import type { NodeScore } from './models/node-score.model';
import type { RegistrationRequest } from './models/registration-request.model';
import { ContainerType, RegistrationRequestStatus } from './models/registration-request.model';
import type { EnvironmentInfo, StorageRecommendation } from './models/storage-recommendation.model';

@Component({
  selector: 'app-nodes',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FontAwesomeModule,
    RichTooltipDirective,
    StorageRecommendationBannerComponent,
  ],
  templateUrl: './nodes.page.html',
  styleUrls: ['./nodes.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodesComponent implements OnInit {
  private readonly nodesApi = inject(NodesClient);
  private readonly environmentService = inject(EnvironmentDetectionService);
  private readonly dialog = inject(Dialog);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);

  // Expose enums and BOs to template
  readonly NodeStatus = NodeStatus;
  readonly NodeRole = NodeRole;
  readonly AccelerationType = AccelerationType;
  readonly ContainerType = ContainerType;
  readonly RegistrationRequestStatus = RegistrationRequestStatus;
  readonly NodeBo = NodeBo;
  readonly TimerBo = TimerBo;

  // State
  nodes: Node[] = [];
  pendingRequests: RegistrationRequest[] = [];
  nodeScores: NodeScore[] = [];
  isLoading = false;
  deletingNodeId: string | null = null;
  error: string | null = null;

  // Storage configuration state
  storageRecommendation: StorageRecommendation | null = null;
  storageSourceNode: Node | null = null;
  storageTargetNode: Node | null = null;
  showStorageRecommendation = false;
  dismissedStorageRecommendations = new Set<string>(); // Track dismissed recommendations by node pair

  // Highlighted request ID (for pulsing effect after notification click)
  readonly highlightedRequestId = signal<string | null>(null);

  // Track initial uptime from server to calculate current uptime
  private nodeStartTimes = new Map<string, number>(); // nodeId -> timestamp when we first saw it

  get totalNodes(): number {
    return this.nodes.length;
  }

  get onlineNodes(): number {
    return this.nodes.filter((n) => n.status === NodeStatus.ONLINE).length;
  }

  get offlineNodes(): number {
    return this.nodes.filter((n) => n.status === NodeStatus.OFFLINE).length;
  }

  get hasNodes(): boolean {
    return this.nodes.length > 0;
  }

  /**
   * Get node score for a specific node
   */
  getNodeScore(nodeId: string): NodeScore | undefined {
    return this.nodeScores.find((score) => score.nodeId === nodeId);
  }

  ngOnInit(): void {
    this.loadNodes();
    this.loadPendingRequests();
    this.loadNodeScores();
    this.startPolling();
    this.startUptimeCounter();
    this.checkStorageConfiguration();

    // Listen for highlightRequest query parameter
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const requestId = params.highlightRequest;
      if (requestId) {
        this.highlightedRequestId.set(requestId);
        // Auto-scroll to the highlighted request after a short delay
        setTimeout(() => {
          const element = document.getElementById(`request-${requestId}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 500);
      }
    });
  }

  /**
   * Load all nodes from API
   */
  loadNodes(): void {
    this.isLoading = true;
    this.error = null;
    this.cdr.markForCheck();

    this.nodesApi
      .getNodes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (nodes) => {
          this.updateNodesWithUptimeTracking(nodes);
          this.isLoading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to load nodes';
          this.isLoading = false;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Load pending registration requests
   */
  loadPendingRequests(): void {
    this.nodesApi
      .getPendingRequests()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (requests) => {
          this.pendingRequests = requests;
          this.cdr.markForCheck();
        },
        error: () => {
          // Silently handle errors for pending requests
        },
      });
  }

  /**
   * Load node scores for job attribution
   */
  loadNodeScores(): void {
    this.nodesApi
      .getNodeScores()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (scores) => {
          this.nodeScores = scores;
          this.cdr.markForCheck();
        },
        error: () => {
          // Silently handle errors for node scores
        },
      });
  }

  /**
   * Update nodes from API while preserving client-side uptime tracking
   */
  private updateNodesWithUptimeTracking(nodes: Node[]): void {
    const now = Date.now();

    // Process incoming nodes and calculate their current uptime
    const updatedNodes = nodes.map((node) => {
      if (!this.nodeStartTimes.has(node.id)) {
        // First time seeing this node - record when we saw it and its server uptime
        this.nodeStartTimes.set(node.id, now - node.uptimeSeconds * 1000);
      }

      // Calculate current uptime based on start time (don't use server's uptimeSeconds)
      const startTime = this.nodeStartTimes.get(node.id);
      if (!startTime) {
        throw new Error(`Node start time not found for node ${node.id}`);
      }
      const currentUptimeSeconds = Math.floor((now - startTime) / 1000);

      return {
        ...node,
        uptimeSeconds: currentUptimeSeconds,
      };
    });

    this.nodes = updatedNodes;
  }

  /**
   * Start polling for node status updates and pending requests every 10 seconds
   */
  private startPolling(): void {
    // Poll for nodes
    interval(10000)
      .pipe(
        switchMap(() => this.nodesApi.getNodes()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (nodes) => {
          this.updateNodesWithUptimeTracking(nodes);
          this.cdr.markForCheck();
        },
        error: () => {
          // Polling error
        },
      });

    // Poll for pending requests every 30 seconds
    interval(30000)
      .pipe(
        switchMap(() => this.nodesApi.getPendingRequests()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (requests) => {
          this.pendingRequests = requests;
          this.cdr.markForCheck();
        },
        error: () => {
          // Silently handle polling errors
        },
      });

    // Poll for node scores every 30 seconds
    interval(30000)
      .pipe(
        switchMap(() => this.nodesApi.getNodeScores()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (scores) => {
          this.nodeScores = scores;
          this.cdr.markForCheck();
        },
        error: () => {
          // Silently handle polling errors
        },
      });
  }

  /**
   * Open token entry dialog for manual node pairing
   */
  onRegisterNode(): void {
    const dialogRef = this.dialog.open(TokenEntryDialogComponent, {
      disableClose: false,
    });

    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((token) => {
      if (token && typeof token === 'string') {
        this.pairWithToken(token);
      }
    });
  }

  /**
   * Pair node using 6-digit token from child node
   */
  private pairWithToken(token: string): void {
    this.isLoading = true;
    this.error = null;
    this.cdr.markForCheck();

    // Get all pending requests and find the one with matching token
    this.nodesApi
      .getPendingRequests()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (requests) => {
          const request = requests.find((r) => r.pairingToken === token);

          if (!request) {
            this.error = 'Invalid or expired pairing token. Please check the token and try again.';
            this.isLoading = false;
            this.cdr.markForCheck();
            return;
          }

          // Open approval dialog for the found request
          this.openApprovalDialog(request);
          this.isLoading = false;
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to find pairing token';
          this.isLoading = false;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Open approval dialog for a registration request
   */
  private openApprovalDialog(request: RegistrationRequest): void {
    const dialogData: ApprovalDialogData = {
      request,
    };

    const dialogRef = this.dialog.open(ApprovalDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      const typedResult = result as ApprovalDialogResult | undefined;
      if (typedResult?.approved) {
        // Clear the highlight
        this.highlightedRequestId.set(null);
        // Reload nodes and pending requests to show the newly paired node
        this.loadNodes();
        this.loadPendingRequests();
        this.isLoading = false;
      } else if (result === null || result === undefined) {
        // Dialog was cancelled
        this.isLoading = false;
      }
    });
  }

  /**
   * Approve a registration request with configuration
   */
  private approveRequest(
    requestId: string,
    config?: { maxWorkers?: number; cpuLimit?: number }
  ): void {
    this.isLoading = true;
    this.cdr.markForCheck();

    this.nodesApi
      .approveRequest(requestId, config)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadNodes(); // Reload nodes to show the newly paired node
          this.loadPendingRequests(); // Reload pending requests
          this.isLoading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to approve request';
          this.isLoading = false;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Open approval dialog for a pending request card
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
      // Dialog returns { approved, nodeId, capabilities }
      const dialogResult = result as ApprovalDialogResult | undefined;
      if (dialogResult?.approved) {
        // Clear the highlight
        this.highlightedRequestId.set(null);
        // Reload nodes and pending requests to show the newly paired node
        this.loadNodes();
        this.loadPendingRequests();
      }
    });
  }

  /**
   * Open rejection dialog for a registration request
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
    this.isLoading = true;
    this.cdr.markForCheck();

    this.nodesApi
      .rejectRequest(requestId, { reason })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // Clear the highlight
          this.highlightedRequestId.set(null);
          this.loadPendingRequests(); // Reload pending requests
          this.isLoading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to reject request';
          this.isLoading = false;
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
   * Start uptime counter - calculates current uptime every second based on start time
   */
  private startUptimeCounter(): void {
    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const now = Date.now();
        // Calculate current uptime for each node based on when we first saw it
        this.nodes = this.nodes.map((node) => {
          const startTime = this.nodeStartTimes.get(node.id);
          if (startTime) {
            const currentUptimeSeconds = Math.floor((now - startTime) / 1000);
            return { ...node, uptimeSeconds: currentUptimeSeconds };
          }
          return node;
        });
        this.cdr.markForCheck();
      });
  }

  /**
   * Edit node configuration
   */
  onEditNode(node: Node): void {
    const dialogRef = this.dialog.open(NodeConfigModalComponent, {
      data: { node },
      disableClose: false,
    });

    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result) {
        this.isLoading = true;
        this.error = null;
        this.cdr.markForCheck();

        this.nodesApi
          .updateNode(node.id, result)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (updatedNode) => {
              // Update the node in the list
              this.nodes = this.nodes.map((n) => (n.id === updatedNode.id ? updatedNode : n));
              this.isLoading = false;
              this.cdr.markForCheck();
            },
            error: (err) => {
              this.error = err.error?.message || 'Failed to update node configuration';
              this.isLoading = false;
              this.cdr.markForCheck();
            },
          });
      }
    });
  }

  /**
   * View node statistics
   */
  onViewStats(node: Node): void {
    this.nodesApi
      .getNodeStats(node.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => {
          this.dialog.open(NodeStatsModalComponent, {
            data: { stats },
            disableClose: false,
          });
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to load node stats';
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Manage storage shares for a node
   */
  onManageStorage(node: Node): void {
    this.dialog.open(StorageSharesModal, {
      data: { node },
      disableClose: false,
    });
  }

  /**
   * Initiate node deletion
   */
  onRemoveNode(node: Node): void {
    // Prevent deleting MAIN node
    if (!NodeBo.canDeleteNode(node)) {
      this.error = NodeBo.getDeletionErrorMessage();
      this.cdr.markForCheck();
      return;
    }

    const dialogData: ConfirmationDialogData = {
      title: 'Remove Node?',
      itemName: node.name,
      itemType: 'node',
      willHappen: [
        'Unpair the node from BitBonsai',
        'Stop sending encoding jobs to this node',
        'Remove node configuration and statistics',
        'Cancel any jobs currently assigned to this node',
      ],
      wontHappen: [
        'Uninstall the node software from your machine',
        'Delete any encoded videos',
        'Affect other nodes or their jobs',
        'Lose completed encoding history',
      ],
      irreversible: false,
      confirmButtonText: 'Remove Node',
      cancelButtonText: 'Keep Node',
    };

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result === true) {
        // Set loading state to prevent double-delete
        this.deletingNodeId = node.id;
        this.cdr.markForCheck();

        this.nodesApi
          .deleteNode(node.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.nodes = this.nodes.filter((n) => n.id !== node.id);
              this.deletingNodeId = null;
              this.cdr.markForCheck();
            },
            error: (err) => {
              this.error = err.error?.message || 'Failed to delete node';
              this.deletingNodeId = null;
              this.cdr.markForCheck();
            },
          });
      }
    });
  }

  /**
   * Check storage configuration for node pairs
   * Shows recommendation banner if MAIN and LINKED nodes need configuration
   */
  private checkStorageConfiguration(): void {
    // Wait for nodes to load
    if (this.nodes.length < 2) return;

    // Find MAIN and first LINKED node
    const mainNode = this.nodes.find((n) => n.role === NodeRole.MAIN);
    const linkedNode = this.nodes.find((n) => n.role === NodeRole.LINKED);

    if (!mainNode || !linkedNode) return;

    // Check if we've already dismissed this recommendation
    const recommendationKey = `${mainNode.id}-${linkedNode.id}`;
    if (this.dismissedStorageRecommendations.has(recommendationKey)) return;

    // Get storage recommendation
    this.environmentService
      .getStorageRecommendation(mainNode.id, linkedNode.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (recommendation) => {
          // Only show if there's a warning or action required
          if (recommendation.warning || recommendation.actionRequired) {
            this.storageRecommendation = recommendation;
            this.storageSourceNode = mainNode;
            this.storageTargetNode = linkedNode;
            this.showStorageRecommendation = true;
            this.cdr.markForCheck();
          }
        },
        error: () => {
          // Silently handle errors
        },
      });
  }

  /**
   * Open storage setup wizard modal
   */
  onConfigureStorage(): void {
    if (!this.storageSourceNode || !this.storageTargetNode || !this.storageRecommendation) {
      return;
    }

    // Detect target node environment first
    this.environmentService
      .detectEnvironment()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (targetEnvironment) => {
          this.openStorageWizard(targetEnvironment);
        },
        error: () => {
          // Open wizard without environment info
          this.openStorageWizard(undefined);
        },
      });
  }

  private openStorageWizard(targetEnvironment?: EnvironmentInfo): void {
    if (!this.storageSourceNode || !this.storageTargetNode || !this.storageRecommendation) {
      return;
    }

    const dialogData: StorageSetupWizardData = {
      sourceNodeId: this.storageSourceNode.id,
      sourceNodeName: this.storageSourceNode.name,
      targetNodeId: this.storageTargetNode.id,
      targetNodeName: this.storageTargetNode.name,
      recommendation: this.storageRecommendation,
      targetEnvironment,
    };

    const dialogRef = this.dialog.open(StorageSetupWizardModal, {
      data: dialogData,
      disableClose: false,
      panelClass: 'storage-wizard-dialog',
      width: '90vw',
      maxWidth: '900px',
      height: '90vh',
    });

    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result && typeof result === 'object' && 'configured' in result && result.configured) {
        // Hide the recommendation banner after successful configuration
        this.showStorageRecommendation = false;
        this.cdr.markForCheck();

        // Reload nodes to get updated storage configuration
        this.loadNodes();
      }
    });
  }

  /**
   * Dismiss storage recommendation banner
   */
  onDismissStorageRecommendation(): void {
    if (this.storageSourceNode && this.storageTargetNode) {
      const recommendationKey = `${this.storageSourceNode.id}-${this.storageTargetNode.id}`;
      this.dismissedStorageRecommendations.add(recommendationKey);
    }
    this.showStorageRecommendation = false;
    this.cdr.markForCheck();
  }
}
