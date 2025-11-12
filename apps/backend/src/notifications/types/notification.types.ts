/**
 * Notification types for different events in the system
 */
export enum NotificationType {
  NODE_DISCOVERED = 'NODE_DISCOVERED',
  NODE_REGISTRATION_REQUEST = 'NODE_REGISTRATION_REQUEST',
  NODE_APPROVED = 'NODE_APPROVED',
  NODE_REJECTED = 'NODE_REJECTED',
  ENCODING_COMPLETE = 'ENCODING_COMPLETE',
  ENCODING_FAILED = 'ENCODING_FAILED',
}

/**
 * Notification priority levels
 */
export enum NotificationPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

/**
 * Notification interface
 */
export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Node discovered notification data
 */
export interface NodeDiscoveredData {
  nodeId: string;
  nodeName: string;
  ipAddress: string;
  hostname: string;
  version: string;
}
