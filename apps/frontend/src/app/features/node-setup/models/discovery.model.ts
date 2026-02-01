import type { AccelerationType } from '../../nodes/models/node.model';

/**
 * Discovered Main Node
 *
 * Represents a BitBonsai main node found during network discovery.
 */
export interface DiscoveredNode {
  nodeId: string;
  name: string;
  ipAddress: string;
  apiPort: number;
  hostname: string;
  version: string;
  discoveredAt: string;
}

/**
 * Scan Result
 *
 * Contains all nodes discovered during a network scan.
 */
export interface ScanResult {
  nodes: DiscoveredNode[];
  scanDurationMs: number;
}

/**
 * Pairing Request
 *
 * Request payload for initiating pairing with a main node.
 */
export interface PairingRequest {
  mainNodeId: string;
  childNodeName: string;
}

/**
 * Pairing Status
 *
 * Real-time pairing status during the connection process.
 */
export enum PairingStatus {
  PENDING = 'PENDING',
  WAITING_APPROVAL = 'WAITING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  TIMEOUT = 'TIMEOUT',
  ERROR = 'ERROR',
}

/**
 * Pairing Response
 *
 * Response from pairing request.
 */
export interface PairingResponse {
  status: PairingStatus;
  requestId?: string;
  pairingCode?: string;
  message?: string;
  connectionToken?: string;
  childNodeId?: string;
  mainNodeInfo?: {
    id: string;
    name: string;
    version: string;
  };
}

/**
 * Hardware Detection Summary
 *
 * Summary of detected hardware capabilities on the child node.
 */
export interface HardwareDetection {
  acceleration: AccelerationType;
  cpuCores: number;
  totalMemoryGB: number;
  availableDiskGB: number;
  platform: string;
  nodeVersion: string;
}

/**
 * Registration Request Status
 *
 * Status of a node registration request from the main node perspective.
 */
export type RegistrationRequestStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED';

/**
 * Registration Request Response
 *
 * Response from the main node when polling registration request status.
 */
export interface RegistrationRequestResponse {
  id: string;
  childNodeName: string;
  childVersion: string;
  ipAddress: string;
  hostname: string;
  containerType: string;
  hardwareSpecs: {
    cpuCores: number;
    cpuModel: string;
    ramGb: number;
    diskGb: number;
    gpuModel: string | null;
  };
  acceleration: AccelerationType;
  pairingToken: string;
  tokenExpiresAt: string;
  status: RegistrationRequestStatus;
  requestedAt: string;
  respondedAt?: string;
  message?: string;
  rejectionReason?: string;
  childNodeId?: string;
  apiKey?: string;
  mainNodeId?: string;
  mainNode?: {
    id: string;
    name: string;
    version: string;
  };
}
