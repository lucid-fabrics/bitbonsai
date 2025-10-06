import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
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

  // Expose enums to template
  readonly NodeStatus = NodeStatus;
  readonly NodeRole = NodeRole;
  readonly AccelerationType = AccelerationType;

  get stats(): NodeStats {
    return this.data.stats;
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
      return `${days}d ${hours}h ${minutes}m`;
    }

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }

    return `${minutes}m`;
  }

  /**
   * Format bytes to human-readable size
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
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
   * Get acceleration display name
   */
  getAccelerationLabel(acceleration: AccelerationType): string {
    switch (acceleration) {
      case AccelerationType.NVIDIA:
        return 'NVIDIA GPU';
      case AccelerationType.INTEL_QSV:
        return 'Intel QSV';
      case AccelerationType.AMD:
        return 'AMD GPU';
      case AccelerationType.APPLE_M:
        return 'Apple M-Series';
      case AccelerationType.CPU:
        return 'CPU Only';
      default:
        return 'Unknown';
    }
  }

  /**
   * Close modal
   */
  onClose(): void {
    this.dialogRef.close();
  }
}
