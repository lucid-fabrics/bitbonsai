import type { DiscoveredNode } from '../models/discovered-node.model';
import { DiscoveryStatus } from '../models/discovered-node.model';
import type { ManagedNode } from '../models/managed-node.model';
import { SyncStatus } from '../models/managed-node.model';

/**
 * Business Object for Discovery Node operations
 * Contains presentation logic and formatting for discovered and managed nodes
 */
export class DiscoveryNodeBo {
  /**
   * Get status badge class for discovered node
   */
  static getStatusClass(status: DiscoveryStatus): string {
    switch (status) {
      case DiscoveryStatus.PENDING:
        return 'status-pending';
      case DiscoveryStatus.APPROVED:
        return 'status-approved';
      case DiscoveryStatus.REJECTED:
        return 'status-rejected';
      default:
        return 'status-unknown';
    }
  }

  /**
   * Get status icon for discovered node
   */
  static getStatusIcon(status: DiscoveryStatus): string {
    switch (status) {
      case DiscoveryStatus.PENDING:
        return 'fa-clock';
      case DiscoveryStatus.APPROVED:
        return 'fa-check-circle';
      case DiscoveryStatus.REJECTED:
        return 'fa-ban';
      default:
        return 'fa-question-circle';
    }
  }

  /**
   * Get acceleration badge class
   */
  static getAccelerationClass(acceleration: string): string {
    const accel = acceleration.toLowerCase();
    if (accel.includes('nvidia')) return 'accel-nvidia';
    if (accel.includes('intel') || accel.includes('qsv')) return 'accel-intel';
    if (accel.includes('amd')) return 'accel-amd';
    if (accel.includes('apple') || accel.includes('m1') || accel.includes('m2'))
      return 'accel-apple';
    return 'accel-cpu';
  }

  /**
   * Get acceleration icon
   */
  static getAccelerationIcon(acceleration: string): string {
    const accel = acceleration.toLowerCase();
    if (accel.includes('nvidia')) return 'fa-rocket';
    if (accel.includes('intel') || accel.includes('qsv')) return 'fa-microchip';
    if (accel.includes('amd')) return 'fa-bolt';
    if (accel.includes('apple')) return 'fa-apple';
    return 'fa-server';
  }

  /**
   * Format hardware specs summary
   */
  static getHardwareSummary(node: DiscoveredNode): string {
    return `${node.cpuCores} cores, ${node.totalMemoryGB} GB RAM`;
  }

  /**
   * Check if node is recently discovered (within last 5 minutes)
   */
  static isRecentlyDiscovered(node: DiscoveredNode): boolean {
    const discoveredAt = new Date(node.discoveredAt).getTime();
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    return now - discoveredAt < fiveMinutes;
  }

  /**
   * Get online status class for managed node
   */
  static getOnlineStatusClass(status: string): string {
    const statusLower = status.toLowerCase();
    if (statusLower === 'online') return 'status-online';
    if (statusLower === 'offline') return 'status-offline';
    return 'status-unknown';
  }

  /**
   * Get online status icon for managed node
   */
  static getOnlineStatusIcon(status: string): string {
    const statusLower = status.toLowerCase();
    if (statusLower === 'online') return 'fa-circle';
    if (statusLower === 'offline') return 'fa-circle';
    return 'fa-question-circle';
  }

  /**
   * Get current activity label for managed node
   */
  static getCurrentActivity(node: ManagedNode): string {
    if (node.currentJobId && node.currentJobName) {
      return `Encoding: ${node.currentJobName}`;
    }
    if (node.activeJobs > 0) {
      return `${node.activeJobs} active job${node.activeJobs > 1 ? 's' : ''}`;
    }
    return 'Idle';
  }

  /**
   * Format resource usage percentage
   */
  static formatUsagePercent(usage?: number): string {
    if (usage === undefined || usage === null) return 'N/A';
    return `${Math.round(usage)}%`;
  }

  /**
   * Get CPU usage class based on percentage
   */
  static getCpuUsageClass(usage?: number): string {
    if (usage === undefined || usage === null) return '';
    if (usage < 50) return 'usage-low';
    if (usage < 80) return 'usage-medium';
    return 'usage-high';
  }

  /**
   * Get memory usage class based on percentage
   */
  static getMemoryUsageClass(usage?: number): string {
    if (usage === undefined || usage === null) return '';
    if (usage < 60) return 'usage-low';
    if (usage < 85) return 'usage-medium';
    return 'usage-high';
  }

  /**
   * Get sync status badge class
   */
  static getSyncStatusClass(status: SyncStatus): string {
    switch (status) {
      case SyncStatus.PENDING:
        return 'sync-status-pending';
      case SyncStatus.SYNCING:
        return 'sync-status-syncing';
      case SyncStatus.COMPLETED:
        return 'sync-status-completed';
      case SyncStatus.FAILED:
        return 'sync-status-failed';
      default:
        return 'sync-status-unknown';
    }
  }

  /**
   * Get sync status icon
   */
  static getSyncStatusIcon(status: SyncStatus): string {
    switch (status) {
      case SyncStatus.PENDING:
        return 'fa-clock';
      case SyncStatus.SYNCING:
        return 'fa-spinner fa-spin';
      case SyncStatus.COMPLETED:
        return 'fa-check-circle';
      case SyncStatus.FAILED:
        return 'fa-exclamation-triangle';
      default:
        return 'fa-question-circle';
    }
  }

  /**
   * Get sync status label
   */
  static getSyncStatusLabel(status: SyncStatus): string {
    switch (status) {
      case SyncStatus.PENDING:
        return 'Pending Sync';
      case SyncStatus.SYNCING:
        return 'Syncing...';
      case SyncStatus.COMPLETED:
        return 'Synced';
      case SyncStatus.FAILED:
        return 'Sync Failed';
      default:
        return 'Unknown';
    }
  }

  /**
   * Format last synced timestamp
   */
  static formatLastSynced(lastSyncedAt?: string): string {
    if (!lastSyncedAt) return 'Never synced';

    const date = new Date(lastSyncedAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  }
}
