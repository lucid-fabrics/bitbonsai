import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnDestroy,
  type OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { interval, type Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { Node } from './models/node.model';
import { AccelerationType, NodeRole, NodeStatus } from './models/node.model';
import { NodesClient } from './services/nodes.client';
import { ConfirmationDialogComponent } from '../../shared/components/confirmation-dialog/confirmation-dialog.component';

enum PairingStep {
  INSTRUCTIONS = 1,
  CODE_INPUT = 2,
  SUCCESS = 3,
}

@Component({
  selector: 'app-nodes',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmationDialogComponent],
  templateUrl: './nodes.component.html',
  styleUrls: ['./nodes.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodesComponent implements OnInit, OnDestroy {
  private readonly nodesApi = inject(NodesClient);

  // Expose enums to template
  readonly NodeStatus = NodeStatus;
  readonly NodeRole = NodeRole;
  readonly AccelerationType = AccelerationType;

  // State signals
  nodes = signal<Node[]>([]);
  isLoading = signal(false);
  error = signal<string | null>(null);

  // Pairing modal state
  showPairingModal = signal(false);
  pairingStep = signal<PairingStep>(PairingStep.INSTRUCTIONS);
  pairingCommand = signal('');
  pairingCode = signal('');
  pairingError = signal<string | null>(null);
  countdownSeconds = signal(600); // 10 minutes
  pairedNode = signal<Node | null>(null);

  // Delete confirmation state
  showDeleteDialog = signal(false);
  nodeToDelete = signal<Node | null>(null);

  // Subscriptions
  private pollingSubscription?: Subscription;
  private countdownSubscription?: Subscription;

  get totalNodes(): number {
    return this.nodes().length;
  }

  get onlineNodes(): number {
    return this.nodes().filter((n) => n.status === NodeStatus.ONLINE).length;
  }

  get offlineNodes(): number {
    return this.nodes().filter((n) => n.status === NodeStatus.OFFLINE).length;
  }

  get hasNodes(): boolean {
    return this.nodes().length > 0;
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
    this.isLoading.set(true);
    this.error.set(null);

    this.nodesApi.getNodes().subscribe({
      next: (nodes) => {
        this.nodes.set(nodes);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.message || 'Failed to load nodes');
        this.isLoading.set(false);
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
          this.nodes.set(nodes);
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
    this.showPairingModal.set(true);
    this.pairingStep.set(PairingStep.INSTRUCTIONS);
    this.pairingCode.set('');
    this.pairingError.set(null);
    this.countdownSeconds.set(600);

    this.nodesApi.register().subscribe({
      next: (response) => {
        this.pairingCommand.set(response.command);
        this.startCountdown();
      },
      error: (err) => {
        this.pairingError.set(err.error?.message || 'Failed to initiate registration');
      },
    });
  }

  /**
   * Start countdown timer for code expiration
   */
  private startCountdown(): void {
    this.countdownSubscription = interval(1000).subscribe(() => {
      const current = this.countdownSeconds();
      if (current > 0) {
        this.countdownSeconds.set(current - 1);
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
    const seconds = this.countdownSeconds();
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Move to code input step
   */
  onNextToCodeInput(): void {
    this.pairingStep.set(PairingStep.CODE_INPUT);
  }

  /**
   * Handle code input and submit pairing
   */
  onSubmitPairingCode(): void {
    const code = this.pairingCode().trim();

    if (code.length !== 6) {
      this.pairingError.set('Please enter a valid 6-digit code');
      return;
    }

    this.isLoading.set(true);
    this.pairingError.set(null);

    this.nodesApi.pair({ code }).subscribe({
      next: (response) => {
        if (response.success) {
          this.pairedNode.set(response.node);
          this.pairingStep.set(PairingStep.SUCCESS);
          this.stopCountdown();
          this.loadNodes();
        } else {
          this.pairingError.set('Invalid pairing code. Please try again.');
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        this.pairingError.set(err.error?.message || 'Failed to pair node');
        this.isLoading.set(false);
      },
    });
  }

  /**
   * Close pairing modal
   */
  onClosePairingModal(): void {
    this.showPairingModal.set(false);
    this.stopCountdown();
    this.pairingCode.set('');
    this.pairingError.set(null);
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
    navigator.clipboard.writeText(this.pairingCommand());
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
    this.nodeToDelete.set(node);
    this.showDeleteDialog.set(true);
  }

  getDeleteMessage(): string {
    const node = this.nodeToDelete();
    if (!node) return 'Are you sure?';
    return `Are you sure you want to remove "${node.name}"? This will permanently remove the node and cannot be undone.`;
  }

  /**
   * Confirm node deletion
   */
  onConfirmDelete(): void {
    const node = this.nodeToDelete();
    if (!node) return;

    this.nodesApi.deleteNode(node.id).subscribe({
      next: () => {
        this.nodes.update((nodes) => nodes.filter((n) => n.id !== node.id));
        this.showDeleteDialog.set(false);
        this.nodeToDelete.set(null);
      },
      error: (err) => {
        this.error.set(err.error?.message || 'Failed to delete node');
        this.showDeleteDialog.set(false);
        this.nodeToDelete.set(null);
      },
    });
  }

  /**
   * Cancel node deletion
   */
  onCancelDelete(): void {
    this.showDeleteDialog.set(false);
    this.nodeToDelete.set(null);
  }
}
