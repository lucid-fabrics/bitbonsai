export enum StorageMethod {
  NFS = 'NFS',
  RSYNC = 'RSYNC',
  EITHER = 'EITHER',
}

export enum ContainerType {
  BARE_METAL = 'BARE_METAL',
  LXC = 'LXC',
  DOCKER = 'DOCKER',
  KUBERNETES = 'KUBERNETES',
  UNKNOWN = 'UNKNOWN',
}

export interface EnvironmentInfo {
  containerType: ContainerType;
  isPrivileged: boolean;
  canMountNFS: boolean;
  networkSubnet: string | null;
  hostname: string;
}

export interface StorageRecommendation {
  recommended: StorageMethod;
  reason: string;
  warning?: string;
  actionRequired?: string;
}

export interface StorageRecommendationDisplay {
  recommendation: StorageRecommendation;
  sourceNode: {
    id: string;
    name: string;
    environment?: EnvironmentInfo;
  };
  targetNode: {
    id: string;
    name: string;
    environment?: EnvironmentInfo;
  };
}
