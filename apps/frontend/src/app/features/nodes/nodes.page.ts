import { Dialog } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnDestroy,
  type OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { interval, type Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import {
  ConfirmationDialogComponent,
  type ConfirmationDialogData,
} from '../../shared/components/confirmation-dialog/confirmation-dialog.component';
import { RichTooltipDirective } from '../../shared/directives/rich-tooltip.directive';
import type { Node } from './models/node.model';
import { AccelerationType, NodeRole, NodeStatus } from './models/node.model';
import { NodesClient } from './services/nodes.client';

enum PairingStep {
  INSTRUCTIONS = 1,
  CODE_INPUT = 2,
  SUCCESS = 3,
}

@Component({
  selector: 'app-nodes',
  standalone: true,
  imports: [CommonModule, FormsModule, RichTooltipDirective],
  templateUrl: './nodes.page.html',
  styleUrls: ['./nodes.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodesComponent implements OnInit, OnDestroy {
  private readonly nodesApi = inject(NodesClient);
  private readonly dialog = inject(Dialog);

  // Expose enums to template
  readonly NodeStatus = NodeStatus;
  readonly NodeRole = NodeRole;
  readonly AccelerationType = AccelerationType;

  // State
  nodes: Node[] = [];
  isLoading = false;
  error: string | null = null;

  // Pairing modal state
  showPairingModal = false;
  pairingStep: PairingStep = PairingStep.INSTRUCTIONS;
  pairingCommand = '';
  pairingCode = '';
  pairingError: string | null = null;
  countdownSeconds = 600; // 10 minutes
  pairedNode: Node | null = null;

  // Subscriptions
  private pollingSubscription?: Subscription;
  private countdownSubscription?: Subscription;

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
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.stopCountdown();
  }

  /**
   * Load all nodes from API
   */
  loadNodes(): void {
    this.isLoading = true;
    this.error = null;

    this.nodesApi.getNodes().subscribe({
      next: (nodes) => {
        this.nodes = nodes;
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load nodes';
        this.isLoading = false;
      },
    });
  }

  /**
   * Start polling for node status updates every 10 seconds
   */
  private startPolling(): void {
    this.pollingSubscription = interval(10000)
      .pipe(switchMap(() => this.nodesApi.getNodes()))
      .subscribe({
        next: (nodes) => {
          this.nodes = nodes;
        },
        error: (err) => {
          console.error('Polling error:', err);
        },
      });
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    this.pollingSubscription?.unsubscribe();
  }

  /**
   * Open pairing modal and initiate registration
   */
  onRegisterNode(): void {
    this.showPairingModal = true;
    this.pairingStep = PairingStep.INSTRUCTIONS;
    this.pairingCode = '';
    this.pairingError = null;
    this.countdownSeconds = 600;

    this.nodesApi.register().subscribe({
      next: (response) => {
        this.pairingCommand = response.command;
        this.startCountdown();
      },
      error: (err) => {
        this.pairingError = err.error?.message || 'Failed to initiate registration';
      },
    });
  }

  /**
   * Start countdown timer for code expiration
   */
  private startCountdown(): void {
    this.countdownSubscription = interval(1000).subscribe(() => {
      const current = this.countdownSeconds;
      if (current > 0) {
        this.countdownSeconds = current - 1;
      } else {
        this.stopCountdown();
      }
    });
  }

  /**
   * Stop countdown timer
   */
  private stopCountdown(): void {
    this.countdownSubscription?.unsubscribe();
  }

  /**
   * Format countdown as MM:SS
   */
  getCountdownDisplay(): string {
    const seconds = this.countdownSeconds;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Move to code input step
   */
  onNextToCodeInput(): void {
    this.pairingStep = PairingStep.CODE_INPUT;
  }

  /**
   * Handle code input and submit pairing
   */
  onSubmitPairingCode(): void {
    const code = this.pairingCode.trim();

    if (code.length !== 6) {
      this.pairingError = 'Please enter a valid 6-digit code';
      return;
    }

    this.isLoading = true;
    this.pairingError = null;

    this.nodesApi.pair({ code }).subscribe({
      next: (response) => {
        if (response.success) {
          this.pairedNode = response.node;
          this.pairingStep = PairingStep.SUCCESS;
          this.stopCountdown();
          this.loadNodes();
        } else {
          this.pairingError = 'Invalid pairing code. Please try again.';
        }
        this.isLoading = false;
      },
      error: (err) => {
        this.pairingError = err.error?.message || 'Failed to pair node';
        this.isLoading = false;
      },
    });
  }

  /**
   * Close pairing modal
   */
  onClosePairingModal(): void {
    this.showPairingModal = false;
    this.stopCountdown();
    this.pairingCode = '';
    this.pairingError = null;
  }

  /**
   * Retry pairing after expiration
   */
  onRetryPairing(): void {
    this.onRegisterNode();
  }

  /**
   * Copy command to clipboard
   */
  onCopyCommand(): void {
    navigator.clipboard.writeText(this.pairingCommand);
  }

  /**
   * Format uptime in human-readable format
   */
  formatUptime(uptimeSeconds: number): string {
    if (uptimeSeconds < 60) {
      return `${uptimeSeconds}s`;
    }

    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);

    if (days > 0) {
      return `${days}d ${hours}h`;
    }

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }

    return `${minutes}m`;
  }

  /**
   * Format last heartbeat as relative time
   */
  formatLastHeartbeat(lastHeartbeat: string): string {
    const now = new Date();
    const heartbeatDate = new Date(lastHeartbeat);
    const diffMs = now.getTime() - heartbeatDate.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);

    if (diffSeconds < 60) {
      return `${diffSeconds}s ago`;
    }

    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) {
      return `${diffMinutes}m ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  /**
   * Check if node is offline (no heartbeat in 2+ minutes)
   */
  isNodeOffline(lastHeartbeat: string): boolean {
    const now = new Date();
    const heartbeatDate = new Date(lastHeartbeat);
    const diffMs = now.getTime() - heartbeatDate.getTime();
    const diffMinutes = diffMs / (1000 * 60);
    return diffMinutes > 2;
  }

  /**
   * Get status class for node
   */
  getStatusClass(node: Node): string {
    if (this.isNodeOffline(node.lastHeartbeat)) {
      return 'offline';
    }
    return node.status.toLowerCase();
  }

  /**
   * Get status display text
   */
  getStatusText(node: Node): string {
    if (this.isNodeOffline(node.lastHeartbeat)) {
      return 'Offline';
    }
    return node.status === NodeStatus.ONLINE ? 'Online' : 'Error';
  }

  /**
   * Get status explanation for tooltip
   */
  getStatusExplanation(node: Node): string {
    if (this.isNodeOffline(node.lastHeartbeat)) {
      return 'This node has not sent a heartbeat in over 2 minutes. It may be powered off, disconnected, or experiencing network issues.';
    }
    if (node.status === NodeStatus.ONLINE) {
      return 'This node is online and ready to accept encoding jobs. It is actively communicating with BitBonsai.';
    }
    return 'This node has encountered an error and may not be able to accept jobs. Check the node logs for details.';
  }

  /**
   * Get acceleration display name
   */
  getAccelerationLabel(acceleration: AccelerationType): string {
    switch (acceleration) {
      case AccelerationType.NVIDIA:
        return 'NVIDIA GPU';
      case AccelerationType.INTEL:
        return 'Intel QSV';
      case AccelerationType.AMD:
        return 'AMD GPU';
      case AccelerationType.APPLE:
        return 'Apple M-Series';
      case AccelerationType.NONE:
        return 'CPU Only';
      default:
        return 'Unknown';
    }
  }

  /**
   * View node statistics
   */
  onViewStats(node: Node): void {
    // TODO: Navigate to node stats page or open stats modal
    console.log('View stats for node:', node.id);
  }

  /**
   * Initiate node deletion
   */
  onRemoveNode(node: Node): void {
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

    dialogRef.closed.subscribe((result) => {
      if (result === true) {
        this.nodesApi.deleteNode(node.id).subscribe({
          next: () => {
            this.nodes = this.nodes.filter((n) => n.id !== node.id);
          },
          error: (err) => {
            this.error = err.error?.message || 'Failed to delete node';
          },
        });
      }
    });
  }
}
