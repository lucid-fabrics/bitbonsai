export enum RegistrationRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum ContainerType {
  BARE_METAL = 'BARE_METAL',
  DOCKER = 'DOCKER',
  LXC = 'LXC',
  VM = 'VM',
  UNKNOWN = 'UNKNOWN',
}

export interface HardwareSpecs {
  cpuCores: number;
  cpuModel: string;
  ramGb: number;
  diskGb: number;
  gpuModel: string | null;
}

export interface RegistrationRequest {
  id: string;
  childNodeName: string;
  childVersion: string;
  ipAddress: string;
  hostname: string;
  containerType: ContainerType;
  hardwareSpecs: HardwareSpecs;
  acceleration: string;
  pairingToken: string;
  tokenExpiresAt: Date;
  status: RegistrationRequestStatus;
  requestedAt: Date;
  respondedAt?: Date;
  message?: string;
  rejectionReason?: string;
  childNodeId?: string;
}

export interface DiscoveredMainNode {
  nodeId: string;
  nodeName: string;
  ipAddress: string;
  port: number;
  apiUrl: string;
  version: string;
  discovered: boolean;
}

export interface CreateRegistrationRequestDto {
  mainNodeId: string;
  message?: string;
}

export interface ApproveRequestDto {
  maxWorkers?: number;
  cpuLimit?: number;
}

export interface RejectRequestDto {
  reason: string;
}
