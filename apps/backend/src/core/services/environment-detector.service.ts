import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import { promisify } from 'util';

const execAsync = promisify(exec);

export enum ContainerType {
  BARE_METAL = 'BARE_METAL',
  LXC = 'LXC',
  DOCKER = 'DOCKER',
  KUBERNETES = 'KUBERNETES',
  UNKNOWN = 'UNKNOWN',
}

export enum StorageRecommendation {
  NFS = 'NFS',
  RSYNC = 'RSYNC',
  EITHER = 'EITHER',
}

export interface EnvironmentInfo {
  containerType: ContainerType;
  isPrivileged: boolean;
  canMountNFS: boolean;
  networkSubnet: string | null;
  hostname: string;
}

export interface StorageMethodRecommendation {
  recommended: StorageRecommendation;
  reason: string;
  warning?: string;
  actionRequired?: string;
}

/**
 * Environment Detector Service
 *
 * Detects the runtime environment (bare metal, LXC, Docker, etc.)
 * and recommends optimal storage configuration
 */
@Injectable()
export class EnvironmentDetectorService {
  private readonly logger = new Logger(EnvironmentDetectorService.name);
  private cachedInfo: EnvironmentInfo | null = null;

  /**
   * Detect container type and environment
   */
  async detectEnvironment(): Promise<EnvironmentInfo> {
    if (this.cachedInfo) {
      return this.cachedInfo;
    }

    const containerType = await this.detectContainerType();
    const isPrivileged = await this.isPrivilegedContainer();
    const canMountNFS = await this.canMountNFS();
    const networkSubnet = await this.detectNetworkSubnet();
    const hostname = await this.getHostname();

    this.cachedInfo = {
      containerType,
      isPrivileged,
      canMountNFS,
      networkSubnet,
      hostname,
    };

    this.logger.log(
      `Environment detected: ${containerType}, Privileged: ${isPrivileged}, Can mount NFS: ${canMountNFS}`
    );

    return this.cachedInfo;
  }

  /**
   * Detect container type
   */
  private async detectContainerType(): Promise<ContainerType> {
    try {
      // Check for Docker
      const dockerEnvExists = await this.fileExists('/.dockerenv');
      if (dockerEnvExists) {
        return ContainerType.DOCKER;
      }

      // Check cgroup for container info
      const cgroupContent = await this.readFile('/proc/1/cgroup');

      if (cgroupContent.includes('docker')) {
        return ContainerType.DOCKER;
      }

      if (cgroupContent.includes('kubepods')) {
        return ContainerType.KUBERNETES;
      }

      // Check for LXC by examining /proc/1/environ
      const environContent = await this.readFile('/proc/1/environ');
      if (environContent.includes('container=lxc')) {
        return ContainerType.LXC;
      }

      // Check systemd-detect-virt (most reliable for LXC)
      try {
        const { stdout } = await execAsync('systemd-detect-virt --container 2>/dev/null');
        const virt = stdout.trim().toLowerCase();

        if (virt === 'lxc' || virt === 'lxc-libvirt') {
          return ContainerType.LXC;
        }

        if (virt === 'docker') {
          return ContainerType.DOCKER;
        }

        if (virt.includes('kube')) {
          return ContainerType.KUBERNETES;
        }

        if (virt === 'none') {
          return ContainerType.BARE_METAL;
        }
      } catch {
        // systemd-detect-virt not available
      }

      // Check /run/systemd/container
      const containerFile = await this.readFile('/run/systemd/container');
      if (containerFile) {
        const type = containerFile.trim().toLowerCase();
        if (type === 'lxc') return ContainerType.LXC;
        if (type === 'docker') return ContainerType.DOCKER;
      }

      // If no container detected, assume bare metal
      return ContainerType.BARE_METAL;
    } catch (error) {
      this.logger.warn('Error detecting container type', error);
      return ContainerType.UNKNOWN;
    }
  }

  /**
   * Check if running in privileged container
   */
  private async isPrivilegedContainer(): Promise<boolean> {
    try {
      // Check capabilities
      const capStatus = await this.readFile('/proc/self/status');
      const capEffMatch = capStatus.match(/CapEff:\s*([0-9a-f]+)/i);

      if (capEffMatch) {
        const capEff = BigInt(`0x${capEffMatch[1]}`);
        // CAP_SYS_ADMIN = bit 21 = 0x200000
        const CAP_SYS_ADMIN = BigInt(0x200000);
        const hasCapSysAdmin = (capEff & CAP_SYS_ADMIN) !== BigInt(0);

        return hasCapSysAdmin;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Test if NFS mounting is possible
   */
  private async canMountNFS(): Promise<boolean> {
    const isPrivileged = await this.isPrivilegedContainer();
    const containerType = await this.detectContainerType();

    // Bare metal can always mount
    if (containerType === ContainerType.BARE_METAL) {
      return true;
    }

    // Privileged containers can mount
    if (isPrivileged) {
      return true;
    }

    // Non-privileged containers cannot mount
    return false;
  }

  /**
   * Detect network subnet
   */
  private async detectNetworkSubnet(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        "ip -4 addr show | grep 'inet ' | grep -v '127.0.0.1' | head -1 | awk '{print $2}'"
      );

      const cidr = stdout.trim();
      if (!cidr) return null;

      // Extract subnet (e.g., 192.168.1.100/24 → 192.168.1.0/24)
      const [ip, mask] = cidr.split('/');
      const octets = ip.split('.');
      const maskNum = parseInt(mask, 10);

      if (maskNum >= 24) {
        return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
      } else if (maskNum >= 16) {
        return `${octets[0]}.${octets[1]}.0.0/16`;
      }

      return cidr;
    } catch {
      return null;
    }
  }

  /**
   * Get hostname
   */
  private async getHostname(): Promise<string> {
    try {
      const { stdout } = await execAsync('hostname');
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Recommend storage method for two nodes
   */
  async recommendStorageMethod(
    sourceNode: { subnet: string | null; containerType: ContainerType; canMountNFS: boolean },
    targetNode: { subnet: string | null; containerType: ContainerType; canMountNFS: boolean }
  ): Promise<StorageMethodRecommendation> {
    // Check if nodes are on same network
    const sameNetwork =
      sourceNode.subnet && targetNode.subnet && sourceNode.subnet === targetNode.subnet;

    // Target node cannot mount NFS
    if (!targetNode.canMountNFS) {
      if (targetNode.containerType === ContainerType.LXC) {
        return {
          recommended: StorageRecommendation.RSYNC,
          reason: 'Target node is non-privileged LXC container',
          warning: 'LXC container detected without mount privileges',
          actionRequired:
            'Enable privileged mode on LXC container for NFS support (see documentation), or use rsync file transfer',
        };
      }

      return {
        recommended: StorageRecommendation.RSYNC,
        reason: 'Target node cannot mount NFS',
        warning: 'Container lacks mount capabilities',
      };
    }

    // Both nodes can mount NFS and are on same network
    if (sameNetwork && sourceNode.canMountNFS && targetNode.canMountNFS) {
      return {
        recommended: StorageRecommendation.NFS,
        reason: 'Nodes are on same network and both support NFS mounting',
      };
    }

    // Different networks but both can mount
    if (!sameNetwork && sourceNode.canMountNFS && targetNode.canMountNFS) {
      return {
        recommended: StorageRecommendation.EITHER,
        reason:
          'Nodes are on different networks. NFS works but rsync may be more reliable over WAN.',
        warning: 'Cross-network NFS may have latency issues',
      };
    }

    // Fallback to rsync
    return {
      recommended: StorageRecommendation.RSYNC,
      reason: 'Rsync file transfer is most compatible',
    };
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.cachedInfo = null;
  }

  // Helper methods
  private async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async readFile(path: string): Promise<string> {
    try {
      return await fs.readFile(path, 'utf-8');
    } catch {
      return '';
    }
  }
}
