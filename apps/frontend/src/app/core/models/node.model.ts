/**
 * Node Role Types
 */
export type NodeRole = 'MAIN' | 'LINKED';

/**
 * Node Status Types
 */
export type NodeStatus = 'ONLINE' | 'OFFLINE' | 'ERROR';

/**
 * Hardware Acceleration Types
 */
export type AccelerationType = 'CPU' | 'INTEL_QSV' | 'NVIDIA' | 'AMD' | 'APPLE_M';

/**
 * Current Node Information
 *
 * Represents the currently running node instance.
 * Used to determine UI restrictions based on node role.
 */
export interface CurrentNode {
  id: string;
  name: string;
  role: NodeRole;
  status: NodeStatus;
  version: string;
  acceleration: AccelerationType;
}
