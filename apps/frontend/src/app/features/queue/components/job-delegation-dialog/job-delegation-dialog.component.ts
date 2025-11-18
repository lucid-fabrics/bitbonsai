import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { NodesClient } from '../../../../core/clients/nodes.client';
import { QueueClient } from '../../../../core/clients/queue.client';
import {
  ScheduleConflictDialogComponent,
  type ScheduleConflictDialogData,
} from '../../../../shared/components/schedule-conflict-dialog/schedule-conflict-dialog.component';
import type { Node } from '../../../nodes/models/node.model';
import type { NodeScore } from '../../../nodes/models/node-score.model';
import type { QueueJobBo } from '../../bos/queue-job.bo';

export interface JobDelegationDialogData {
  job: QueueJobBo;
}

@Component({
  selector: 'app-job-delegation-dialog',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule],
  templateUrl: './job-delegation-dialog.component.html',
  styleUrls: ['./job-delegation-dialog.component.scss'],
})
export class JobDelegationDialogComponent implements OnInit {
  readonly data: JobDelegationDialogData = inject(DIALOG_DATA);
  readonly dialogRef = inject(DialogRef);
  readonly dialog = inject(Dialog);
  readonly nodesClient = inject(NodesClient);
  readonly queueClient = inject(QueueClient);
  readonly destroyRef = inject(DestroyRef);

  nodes: Node[] = [];
  nodeScores: NodeScore[] = [];
  selectedNodeId: string | null = null;
  isLoading = false;
  error: string | null = null;

  ngOnInit(): void {
    this.loadNodesAndScores();
  }

  /**
   * Load nodes and their scores
   */
  private loadNodesAndScores(): void {
    this.isLoading = true;

    // Load nodes
    this.nodesClient
      .getNodes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (nodes) => {
          // Filter to online nodes only
          this.nodes = nodes.filter((n) => n.status === 'ONLINE');
          this.isLoading = false;
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to load nodes';
          this.isLoading = false;
        },
      });

    // Load node scores
    this.nodesClient
      .getNodeScores()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (scores) => {
          this.nodeScores = scores;
        },
        error: () => {
          // Silently handle score loading errors
        },
      });
  }

  /**
   * Get score for a specific node
   */
  getNodeScore(nodeId: string): NodeScore | undefined {
    return this.nodeScores.find((score) => score.nodeId === nodeId);
  }

  /**
   * Check if node is outside schedule window
   */
  isOutsideSchedule(nodeId: string): boolean {
    const score = this.getNodeScore(nodeId);
    return score ? !score.breakdown.scheduleAvailable : false;
  }

  /**
   * Select a node
   */
  selectNode(nodeId: string): void {
    this.selectedNodeId = nodeId;
  }

  /**
   * Delegate job to selected node (with schedule conflict check)
   */
  delegateJob(): void {
    console.log('[JobDelegationDialog] delegateJob() called');
    console.log('[JobDelegationDialog] selectedNodeId:', this.selectedNodeId);
    console.log('[JobDelegationDialog] job.id:', this.data.job.id);

    if (!this.selectedNodeId) {
      this.error = 'Please select a node';
      console.error('[JobDelegationDialog] No node selected!');
      return;
    }

    // Check if node is outside schedule
    if (this.isOutsideSchedule(this.selectedNodeId)) {
      console.log('[JobDelegationDialog] Node is outside schedule, showing warning');
      this.showScheduleConflictWarning();
    } else {
      console.log('[JobDelegationDialog] Proceeding with delegation');
      this.performDelegation();
    }
  }

  /**
   * Show schedule conflict warning dialog
   */
  private showScheduleConflictWarning(): void {
    const selectedNode = this.nodes.find((n) => n.id === this.selectedNodeId);
    if (!selectedNode) return;

    const dialogData: ScheduleConflictDialogData = {
      nodeName: selectedNode.name,
      message: 'This node is currently outside its scheduled encoding window.',
    };

    const conflictDialogRef = this.dialog.open(ScheduleConflictDialogComponent, {
      data: dialogData,
      disableClose: false,
    });

    conflictDialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed) => {
      if (confirmed === true) {
        this.performDelegation();
      }
    });
  }

  /**
   * Perform the actual delegation API call
   */
  private performDelegation(): void {
    if (!this.selectedNodeId) return;

    console.log('[JobDelegationDialog] performDelegation() starting...');
    console.log(
      '[JobDelegationDialog] Calling API: delegateJob(' +
        this.data.job.id +
        ', ' +
        this.selectedNodeId +
        ')'
    );

    this.isLoading = true;
    this.error = null;

    this.queueClient
      .delegateJob(this.data.job.id, this.selectedNodeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          console.log('[JobDelegationDialog] Delegation successful!');
          this.dialogRef.close(true);
        },
        error: (err) => {
          console.error('[JobDelegationDialog] Delegation failed:', err);
          this.error = err.error?.message || 'Failed to delegate job';
          this.isLoading = false;
        },
      });
  }

  /**
   * Close dialog
   */
  onClose(): void {
    this.dialogRef.close(false);
  }
}
