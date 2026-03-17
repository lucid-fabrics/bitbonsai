import type { Node } from '../models/node.model';
import { AccelerationType, NodeRole, NodeStatus } from '../models/node.model';

/**
 * Business Object for Node formatting and presentation logic
 * Following SRP: Separates business logic from component UI interactions
 */
export class NodeBo {
  /**
   * Format uptime in human-readable format
   */
  static formatUptime(uptimeSeconds: number): string {
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
  static formatLastHeartbeat(lastHeartbeat: string): string {
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
  static isNodeOffline(lastHeartbeat: string): boolean {
    const now = new Date();
    const heartbeatDate = new Date(lastHeartbeat);
    const diffMs = now.getTime() - heartbeatDate.getTime();
    const diffMinutes = diffMs / (1000 * 60);
    return diffMinutes > 2;
  }

  /**
   * Get status class for node
   */
  static getStatusClass(node: Node): string {
    if (NodeBo.isNodeOffline(node.lastHeartbeat)) {
      return 'offline';
    }
    return node.status.toLowerCase();
  }

  /**
   * Get status display text
   */
  static getStatusText(node: Node): string {
    if (NodeBo.isNodeOffline(node.lastHeartbeat)) {
      return 'Offline';
    }
    return node.status === NodeStatus.ONLINE ? 'Online' : 'Error';
  }

  /**
   * Get status explanation for tooltip
   */
  static getStatusExplanation(node: Node): string {
    if (NodeBo.isNodeOffline(node.lastHeartbeat)) {
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
  static getAccelerationLabel(acceleration: AccelerationType): string {
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
   * Check if node can be deleted (not a MAIN node)
   */
  static canDeleteNode(node: Node): boolean {
    return node.role !== NodeRole.MAIN;
  }

  /**
   * Get deletion error message for MAIN nodes
   */
  static getDeletionErrorMessage(): string {
    return 'Cannot delete MAIN node. MAIN nodes manage the entire BitBonsai cluster and cannot be removed.';
  }
}
