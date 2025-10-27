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
import { interval, Subject, takeUntil } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { NodesClient } from '../../core/clients/nodes.client';
import {
  ConfirmationDialogComponent,
  type ConfirmationDialogData,
} from '../../shared/components/confirmation-dialog/confirmation-dialog.component';
import { RichTooltipDirective } from '../../shared/directives/rich-tooltip.directive';
import { NodeBo } from './bos/node.bo';
import { TimerBo } from './bos/timer.bo';
import { NodeStatsModalComponent } from './modals/node-stats/node-stats.modal';
import type { Node } from './models/node.model';
import { AccelerationType, NodeRole, NodeStatus } from './models/node.model';

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

  // Pairing modal state
  showPairingModal = false;
  pairingStep: PairingStep = PairingStep.INSTRUCTIONS;
  pairingCommand = '';
  pairingCode = '';
  pairingError: string | null = null;
  countdownSeconds = 600; // 10 minutes
  pairedNode: Node | null = null;

  // Subjects for manual control of countdown
  private stopCountdown$ = new Subject<void>();

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
        error: (err) => {
          console.error('Polling error:', err);
        },
      });
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
    this.cdr.markForCheck();

    this.nodesApi
      .register()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.pairingCommand = response.command;
          this.startCountdown();
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.pairingError = err.error?.message || 'Failed to initiate registration';
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Start countdown timer for code expiration
   */
  private startCountdown(): void {
    // Reset the stop signal for a new countdown
    this.stopCountdown$ = new Subject<void>();

    interval(1000)
      .pipe(takeUntil(this.stopCountdown$), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const current = this.countdownSeconds;
        if (current > 0) {
          this.countdownSeconds = current - 1;
          this.cdr.markForCheck();
        } else {
          this.stopCountdown();
        }
      });
  }

  /**
   * Stop countdown timer
   */
  private stopCountdown(): void {
    this.stopCountdown$.next();
    this.stopCountdown$.complete();
  }

  /**
   * Format countdown as MM:SS
   */
  getCountdownDisplay(): string {
    return TimerBo.formatCountdown(this.countdownSeconds);
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
   * Move to code input step
   */
  onNextToCodeInput(): void {
    this.pairingStep = PairingStep.CODE_INPUT;
    this.cdr.markForCheck();
  }

  /**
   * Handle code input and submit pairing
   */
  onSubmitPairingCode(): void {
    const code = this.pairingCode.trim();

    if (code.length !== 6) {
      this.pairingError = 'Please enter a valid 6-digit code';
      this.cdr.markForCheck();
      return;
    }

    this.isLoading = true;
    this.pairingError = null;
    this.cdr.markForCheck();

    this.nodesApi
      .pair({ code })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.pairingError = err.error?.message || 'Failed to pair node';
          this.isLoading = false;
          this.cdr.markForCheck();
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
    this.cdr.markForCheck();
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
