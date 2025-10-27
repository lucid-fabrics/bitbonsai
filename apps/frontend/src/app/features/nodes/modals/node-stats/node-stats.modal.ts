import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BytesBo } from '../../bos/bytes.bo';
import { NodeBo } from '../../bos/node.bo';
import { AccelerationType, NodeRole, NodeStatus } from '../../models/node.model';
import type { NodeStats } from '../../models/node-stats.model';

export interface NodeStatsModalData {
  stats: NodeStats;
}

@Component({
  selector: 'app-node-stats-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './node-stats.modal.html',
  styleUrls: ['./node-stats.modal.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodeStatsModalComponent {
  protected readonly dialogRef = inject(DialogRef<void>);
  protected readonly data = inject<NodeStatsModalData>(DIALOG_DATA);

  // Expose enums and BOs to template
  readonly NodeStatus = NodeStatus;
  readonly NodeRole = NodeRole;
  readonly AccelerationType = AccelerationType;
  readonly NodeBo = NodeBo;
  readonly BytesBo = BytesBo;

  get stats(): NodeStats {
    return this.data.stats;
  }

  /**
   * Close modal
   */
  onClose(): void {
    this.dialogRef.close();
  }
}
