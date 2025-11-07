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
import { FormsModule } from '@angular/forms';
import { interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { NodesClient } from '../../core/clients/nodes.client';
import {
  ConfirmationDialogComponent,
  type ConfirmationDialogData,
} from '../../shared/components/confirmation-dialog/confirmation-dialog.component';
import { RichTooltipDirective } from '../../shared/directives/rich-tooltip.directive';
import {
  ApprovalDialogComponent,
  type ApprovalDialogData,
} from '../pending-requests/dialogs/approval-dialog.component';
import { NodeBo } from './bos/node.bo';
import { TimerBo } from './bos/timer.bo';
import { TokenEntryDialogComponent } from './dialogs/token-entry-dialog.component';
import { NodeConfigModalComponent } from './modals/node-config/node-config.modal';
import { NodeStatsModalComponent } from './modals/node-stats/node-stats.modal';
import type { Node } from './models/node.model';
import { AccelerationType, NodeRole, NodeStatus } from './models/node.model';
import type { RegistrationRequest } from './models/registration-request.model';

@Component({
  selector: 'app-nodes',
  standalone: true,
  imports: [CommonModule, FormsModule, RichTooltipDirective],
  templateUrl: './nodes.page.html',
  styleUrls: ['./nodes.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodesComponent implements OnInit {
  private readonly nodesApi = inject(NodesClient);
  private readonly dialog = inject(Dialog);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  // Expose enums and BOs to template
  readonly NodeStatus = NodeStatus;
  readonly NodeRole = NodeRole;
  readonly AccelerationType = AccelerationType;
  readonly NodeBo = NodeBo;
  readonly TimerBo = TimerBo;

  // State
  nodes: Node[] = [];
  isLoading = false;
  error: string | null = null;

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

  ngOnInit(): void {
    this.loadNodes();
    this.startPolling();
    this.startUptimeCounter();
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
   * Start polling for node status updates every 10 seconds
   */
  private startPolling(): void {
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
      if (result) {
        this.approveRequest(request.id, result);
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
        this.nodesApi
          .deleteNode(node.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.nodes = this.nodes.filter((n) => n.id !== node.id);
              this.cdr.markForCheck();
            },
            error: (err) => {
              this.error = err.error?.message || 'Failed to delete node';
              this.cdr.markForCheck();
            },
          });
      }
    });
  }
}
