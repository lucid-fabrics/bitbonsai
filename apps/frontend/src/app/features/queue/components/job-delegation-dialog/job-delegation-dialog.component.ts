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
          // Filter to online nodes only, excluding the current node (can't delegate to itself)
          this.nodes = nodes.filter((n) => n.status === 'ONLINE' && n.id !== this.data.job.nodeId);
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
    if (!this.selectedNodeId) {
      this.error = 'Please select a node';
      return;
    }

    // Check if node is outside schedule
    if (this.isOutsideSchedule(this.selectedNodeId)) {
      this.showScheduleConflictWarning();
    } else {
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

    this.isLoading = true;
    this.error = null;

    this.queueClient
      .delegateJob(this.data.job.id, this.selectedNodeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.dialogRef.close(true);
        },
        error: (err) => {
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
