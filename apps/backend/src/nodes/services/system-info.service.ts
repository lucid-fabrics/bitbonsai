import { Injectable, Logger } from '@nestjs/common';
import { AccelerationType, ContainerType } from '@prisma/client';
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface SystemInfo {
  // Network
  ipAddress: string;
  hostname: string;
  macAddress: string | null;
  subnet: string | null;

  // Container/Environment
  containerType: ContainerType;

  // Hardware
  hardwareSpecs: {
    cpuCores: number;
    cpuModel: string;
    ramGb: number;
    diskGb: number;
    gpuModel: string | null;
  };
  acceleration: AccelerationType;
}

/**
 * Service to collect system information for node registration
 */
@Injectable()
export class SystemInfoService {
  private readonly logger = new Logger(SystemInfoService.name);

  /**
   * Collect complete system information
   */
  async collectSystemInfo(): Promise<SystemInfo> {
    const [ipAddress, hostname, macAddress, subnet, containerType, hardwareSpecs, acceleration] =
      await Promise.all([
        this.getIpAddress(),
        this.getHostname(),
        this.getMacAddress(),
        this.getSubnet(),
        this.detectContainerType(),
        this.getHardwareSpecs(),
        this.detectAcceleration(),
      ]);

    return {
      ipAddress,
      hostname,
      macAddress,
      subnet,
      containerType,
      hardwareSpecs,
      acceleration,
    };
  }

  /**
   * Get primary IP address (non-localhost)
   */
  private async getIpAddress(): Promise<string> {
    try {
      const interfaces = os.networkInterfaces();

      // Find first non-internal IPv4 address
      for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs) continue;

        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal) {
            this.logger.debug(`Found IP address: ${addr.address} on interface ${name}`);
            return addr.address;
          }
        }
      }

      // Fallback to localhost
      this.logger.warn('No external IP found, using localhost');
      return '127.0.0.1';
    } catch (error: unknown) {
      this.logger.error('Failed to get IP address', error);
      return '127.0.0.1';
    }
  }

  /**
   * Get system hostname
   */
  private async getHostname(): Promise<string> {
    try {
      return os.hostname();
    } catch (error: unknown) {
      this.logger.error('Failed to get hostname', error);
      return 'unknown';
    }
  }

  /**
   * Get MAC address of primary network interface
   */
  private async getMacAddress(): Promise<string | null> {
    try {
      const interfaces = os.networkInterfaces();

      // Find MAC of first non-internal interface
      for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs) continue;

        for (const addr of addrs) {
          if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
            this.logger.debug(`Found MAC address: ${addr.mac} on interface ${name}`);
            return addr.mac;
          }
        }
      }

      return null;
    } catch (error: unknown) {
      this.logger.error('Failed to get MAC address', error);
      return null;
    }
  }

  /**
   * Get network subnet
   */
  private async getSubnet(): Promise<string | null> {
    try {
      const interfaces = os.networkInterfaces();

      for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs) continue;

        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal && addr.netmask) {
            // Calculate subnet from IP and netmask
            const subnet = this.calculateSubnet(addr.address, addr.netmask);
            this.logger.debug(`Found subnet: ${subnet} on interface ${name}`);
            return subnet;
          }
        }
      }

      return null;
    } catch (error: unknown) {
      this.logger.error('Failed to get subnet', error);
      return null;
    }
  }

  /**
   * Calculate subnet from IP and netmask
   */
  private calculateSubnet(ip: string, netmask: string): string {
    const ipParts = ip.split('.').map(Number);
    const maskParts = netmask.split('.').map(Number);

    const subnetParts = ipParts.map((part, i) => part & maskParts[i]);
    const cidr = maskParts.reduce(
      (count, part) => count + part.toString(2).split('1').length - 1,
      0
    );

    return `${subnetParts.join('.')}/${cidr}`;
  }

  /**
   * Detect container type (Docker, LXC, VM, Bare Metal)
   */
  private async detectContainerType(): Promise<ContainerType> {
    try {
      // Check for Docker
      if (await this.fileExists('/.dockerenv')) {
        return ContainerType.DOCKER;
      }

      // Check for LXC
      const cgroupContent = await this.safeReadFile('/proc/1/cgroup');
      if (cgroupContent.includes('lxc') || cgroupContent.includes('/lxc/')) {
        return ContainerType.LXC;
      }

      // Check for systemd-detect-virt (most reliable for VMs)
      try {
        const { stdout } = await execAsync('systemd-detect-virt 2>/dev/null || echo none');
        const virt = stdout.trim().toLowerCase();

        if (virt !== 'none' && virt !== '' && virt !== 'container') {
          // VM detected (kvm, vmware, virtualbox, etc)
          return ContainerType.VM;
        }
      } catch {
        // systemd-detect-virt not available, continue
      }

      // Check for common VM indicators
      const dmiProduct = await this.safeReadFile('/sys/devices/virtual/dmi/id/product_name');
      if (
        dmiProduct.includes('VirtualBox') ||
        dmiProduct.includes('VMware') ||
        dmiProduct.includes('KVM')
      ) {
        return ContainerType.VM;
      }

      // Default to bare metal
      return ContainerType.BARE_METAL;
    } catch (error: unknown) {
      this.logger.warn('Failed to detect container type, assuming bare metal', error);
      return ContainerType.UNKNOWN;
    }
  }

  /**
   * Get hardware specifications
   */
  private async getHardwareSpecs(): Promise<SystemInfo['hardwareSpecs']> {
    try {
      const cpuCores = os.cpus().length;
      const cpuModel = os.cpus()[0]?.model || 'Unknown CPU';
      const ramGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
      const diskGb = await this.getDiskSpace();
      const gpuModel = await this.detectGpu();

      return {
        cpuCores,
        cpuModel,
        ramGb,
        diskGb,
        gpuModel,
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get hardware specs', error);
      return {
        cpuCores: os.cpus().length,
        cpuModel: 'Unknown',
        ramGb: 0,
        diskGb: 0,
        gpuModel: null,
      };
    }
  }

  /**
   * Get available disk space in GB
   */
  private async getDiskSpace(): Promise<number> {
    try {
      const { stdout } = await execAsync("df -BG / | tail -1 | awk '{print $2}'");
      const diskGb = parseInt(stdout.replace('G', ''), 10);
      return Number.isNaN(diskGb) ? 0 : diskGb;
    } catch (error: unknown) {
      this.logger.warn('Failed to get disk space', error);
      return 0;
    }
  }

  /**
   * Detect GPU model
   */
  private async detectGpu(): Promise<string | null> {
    try {
      // Try nvidia-smi first
      try {
        const { stdout } = await execAsync(
          'nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null'
        );
        const gpu = stdout.trim();
        if (gpu && !gpu.includes('command not found')) {
          return gpu;
        }
      } catch {
        // NVIDIA not found
      }

      // Try lspci for any GPU
      try {
        const { stdout } = await execAsync('lspci | grep -i vga | head -1');
        const match = stdout.match(/: (.+)$/);
        if (match) {
          return match[1].trim();
        }
      } catch {
        // lspci not available
      }

      return null;
    } catch {
      this.logger.debug('No GPU detected');
      return null;
    }
  }

  /**
   * Detect hardware acceleration type
   */
  private async detectAcceleration(): Promise<AccelerationType> {
    try {
      // Check for NVIDIA
      try {
        await execAsync('nvidia-smi --version 2>/dev/null');
        return AccelerationType.NVIDIA;
      } catch {
        // Not NVIDIA
      }

      // Check for Intel QSV
      if (await this.fileExists('/dev/dri/renderD128')) {
        const cpuModel = os.cpus()[0]?.model.toLowerCase() || '';
        if (cpuModel.includes('intel')) {
          return AccelerationType.INTEL_QSV;
        }
      }

      // Check for AMD
      try {
        const { stdout } = await execAsync('lspci | grep -i amd');
        if (stdout.includes('VGA') || stdout.includes('Display')) {
          return AccelerationType.AMD;
        }
      } catch {
        // Not AMD
      }

      // Check for Apple Silicon (M-series)
      if (process.platform === 'darwin' && process.arch === 'arm64') {
        return AccelerationType.APPLE_M;
      }

      // Default to CPU
      return AccelerationType.CPU;
    } catch (error: unknown) {
      this.logger.warn('Failed to detect acceleration type, defaulting to CPU', error);
      return AccelerationType.CPU;
    }
  }

  /**
   * Check if file exists
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Safely read file content
   */
  private async safeReadFile(path: string): Promise<string> {
    try {
      return await fs.readFile(path, 'utf-8');
    } catch {
      return '';
    }
  }
}
