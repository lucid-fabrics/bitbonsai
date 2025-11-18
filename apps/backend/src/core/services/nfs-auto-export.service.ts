import { Injectable, Logger } from '@nestjs/common';
import { StorageProtocol, StorageShareStatus } from '@prisma/client';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import { promisify } from 'util';
import { PrismaService } from '../../prisma/prisma.service';
import type { DockerVolumeMount } from '../interfaces/file-transport.interface';
import { DockerVolumeDetectorService } from './docker-volume-detector.service';

const execAsync = promisify(exec);

/**
 * Automatically exports Docker volumes as NFS shares
 *
 * This service enables the revolutionary zero-config storage sharing:
 * 1. Detects Docker volume mounts on the main node
 * 2. Auto-exports them as NFS shares
 * 3. Child nodes can auto-detect and auto-mount
 *
 * Example flow:
 * - Main node has Docker volume: /mnt/user/media:/media
 * - This service creates NFS export: /media → 192.168.1.0/24
 * - Child nodes discover and mount at same path: /media
 * - FFmpeg reads directly from NFS without file transfers!
 */
@Injectable()
export class NFSAutoExportService {
  private readonly logger = new Logger(NFSAutoExportService.name);
  private readonly EXPORTS_FILE = '/etc/exports';
  private readonly AUTO_EXPORT_MARKER = '# BitBonsai Auto-Managed Export';

  constructor(
    private readonly prisma: PrismaService,
    private readonly volumeDetector: DockerVolumeDetectorService
  ) {}

  /**
   * Auto-export all detected Docker volumes as NFS shares
   * Called on main node startup or when requested
   */
  async autoExportDockerVolumes(): Promise<void> {
    this.logger.log('Starting auto-export of Docker volumes...');

    try {
      // Get the main node
      const mainNode = await this.getMainNode();
      if (!mainNode) {
        this.logger.warn('No main node found - skipping auto-export');
        return;
      }

      // Clean up old auto-managed shares first
      const deletedCount = await this.prisma.storageShare.deleteMany({
        where: { autoManaged: true },
      });
      if (deletedCount.count > 0) {
        this.logger.log(`Cleaned up ${deletedCount.count} old auto-managed shares`);
      }

      // Detect Docker volumes
      const volumes = await this.volumeDetector.detectVolumes();

      if (volumes.length === 0) {
        this.logger.log('No Docker volumes detected - nothing to export');
        return;
      }

      this.logger.log(`Detected ${volumes.length} Docker volumes for export`);

      // Get network subnet for NFS exports (e.g., 192.168.1.0/24)
      const networkSubnet = await this.detectNetworkSubnet();

      // Process each volume
      for (const volume of volumes) {
        await this.exportVolume(volume, mainNode.id, networkSubnet);
      }

      // Restart NFS server to apply changes
      await this.restartNFSServer();

      this.logger.log('✓ Auto-export completed successfully');
    } catch (error) {
      this.logger.error(
        'Failed to auto-export Docker volumes',
        error instanceof Error ? error.stack : error
      );
    }
  }

  /**
   * Export a single Docker volume as NFS share
   */
  private async exportVolume(
    volume: DockerVolumeMount,
    mainNodeId: string,
    networkSubnet: string
  ): Promise<void> {
    try {
      // Check if already exported
      const existing = await this.prisma.storageShare.findFirst({
        where: {
          ownerNodeId: mainNodeId,
          sharePath: volume.destination,
          autoManaged: true,
        },
      });

      if (existing) {
        this.logger.debug(`Volume ${volume.destination} already exported`);
        return;
      }

      // Generate share name from destination path
      const shareName = this.volumeDetector.getSuggestedShareName(volume.destination);

      // Add NFS export to /etc/exports
      await this.addNFSExport(volume.destination, networkSubnet, volume.readOnly);

      // Get main node's IP address
      const serverAddress = await this.getMainNodeIP();

      // Create StorageShare record
      const exportPath = `${serverAddress}:${volume.destination}`;

      await this.prisma.storageShare.create({
        data: {
          nodeId: mainNodeId, // Owned by main node
          ownerNodeId: mainNodeId, // Main node is sharing it
          name: `${shareName} (Auto)`,
          protocol: StorageProtocol.NFS,
          status: StorageShareStatus.AVAILABLE,
          serverAddress,
          sharePath: volume.destination,
          exportPath,
          mountPoint: volume.destination, // Same path for child nodes
          readOnly: volume.readOnly,
          mountOptions: volume.readOnly ? 'ro,nolock,soft' : 'rw,nolock,soft',
          autoMount: true,
          addToFstab: true,
          mountOnDetection: true,
          autoManaged: true, // Mark as auto-managed
          isMounted: true, // Already accessible locally
        },
      });

      this.logger.log(`✓ Exported volume: ${volume.destination} as "${shareName}"`);
    } catch (error) {
      this.logger.error(
        `Failed to export volume ${volume.destination}`,
        error instanceof Error ? error.stack : error
      );
    }
  }

  /**
   * Add NFS export entry to /etc/exports
   */
  private async addNFSExport(
    path: string,
    networkSubnet: string,
    readOnly: boolean
  ): Promise<void> {
    try {
      // Check if /etc/exports exists
      let exportsContent = '';
      try {
        exportsContent = await fs.readFile(this.EXPORTS_FILE, 'utf-8');
      } catch (_error) {
        // File doesn't exist, will be created
        this.logger.debug('/etc/exports does not exist, will create it');
      }

      // Check if this path is already exported
      if (exportsContent.includes(`${path} `)) {
        this.logger.debug(`Path ${path} already in /etc/exports`);
        return;
      }

      // Build NFS export options
      const options = readOnly
        ? 'ro,sync,no_subtree_check,no_root_squash'
        : 'rw,sync,no_subtree_check,no_root_squash';

      // Build export entry
      const exportEntry = `${path} ${networkSubnet}(${options})`;

      // Append to /etc/exports with auto-managed marker
      const newContent = `${exportsContent}\n${this.AUTO_EXPORT_MARKER}\n${exportEntry}\n`;

      await fs.writeFile(this.EXPORTS_FILE, newContent);

      this.logger.debug(`Added NFS export: ${exportEntry}`);
    } catch (error) {
      this.logger.error(
        `Failed to add NFS export for ${path}`,
        error instanceof Error ? error.stack : error
      );
      throw error;
    }
  }

  /**
   * Remove all auto-managed NFS exports
   */
  async removeAutoManagedExports(): Promise<void> {
    try {
      const exportsContent = await fs.readFile(this.EXPORTS_FILE, 'utf-8');
      const lines = exportsContent.split('\n');

      // Filter out auto-managed exports
      const filteredLines: string[] = [];
      let skipNext = false;

      for (const line of lines) {
        if (line.includes(this.AUTO_EXPORT_MARKER)) {
          skipNext = true; // Skip the marker line
          continue;
        }

        if (skipNext) {
          skipNext = false; // Skip the export line after marker
          continue;
        }

        filteredLines.push(line);
      }

      await fs.writeFile(this.EXPORTS_FILE, filteredLines.join('\n'));

      // Remove auto-managed StorageShare records
      await this.prisma.storageShare.deleteMany({
        where: { autoManaged: true },
      });

      // Restart NFS server
      await this.restartNFSServer();

      this.logger.log('✓ Removed all auto-managed exports');
    } catch (error) {
      this.logger.error(
        'Failed to remove auto-managed exports',
        error instanceof Error ? error.stack : error
      );
    }
  }

  /**
   * Restart NFS server to apply export changes
   */
  private async restartNFSServer(): Promise<void> {
    try {
      // Try systemd first (most common on modern Linux)
      try {
        await execAsync('systemctl restart nfs-server 2>/dev/null');
        this.logger.log('✓ NFS server restarted (systemd)');
        return;
      } catch {
        // systemd failed, try alternative commands
      }

      // Try traditional init script
      try {
        await execAsync('/etc/init.d/nfs-kernel-server restart 2>/dev/null');
        this.logger.log('✓ NFS server restarted (init.d)');
        return;
      } catch {
        // init.d failed too
      }

      // Try exportfs -ra (reload exports without restart)
      try {
        await execAsync('exportfs -ra');
        this.logger.log('✓ NFS exports reloaded (exportfs)');
        return;
      } catch {
        // exportfs failed
      }

      this.logger.warn('Could not restart NFS server - exports may not be active');
    } catch (error) {
      this.logger.error(
        'Error restarting NFS server',
        error instanceof Error ? error.stack : error
      );
    }
  }

  /**
   * Detect network subnet for NFS exports
   */
  private async detectNetworkSubnet(): Promise<string> {
    try {
      // Get primary network interface IP
      const { stdout } = await execAsync(
        "ip -4 addr show | grep 'inet ' | grep -v '127.0.0.1' | head -1 | awk '{print $2}'"
      );

      const cidr = stdout.trim();

      if (!cidr) {
        this.logger.warn('Could not detect network subnet, using 192.168.0.0/16');
        return '192.168.0.0/16';
      }

      // Extract subnet (e.g., 192.168.1.100/24 → 192.168.1.0/24)
      const [ip, mask] = cidr.split('/');
      const octets = ip.split('.');

      // For /24 networks, zero out the last octet
      // For /16 networks, zero out the last two octets
      const maskNum = parseInt(mask, 10);
      if (maskNum >= 24) {
        return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
      } else if (maskNum >= 16) {
        return `${octets[0]}.${octets[1]}.0.0/16`;
      }

      return cidr; // Use as-is for other masks
    } catch (_error) {
      this.logger.warn('Failed to detect network subnet, using default 192.168.0.0/16');
      return '192.168.0.0/16';
    }
  }

  /**
   * Get main node IP address
   */
  private async getMainNodeIP(): Promise<string> {
    try {
      // Get primary non-loopback IP
      const { stdout } = await execAsync(
        "ip -4 addr show | grep 'inet ' | grep -v '127.0.0.1' | head -1 | awk '{print $2}' | cut -d/ -f1"
      );

      const ip = stdout.trim();

      if (!ip) {
        this.logger.warn('Could not detect main node IP, using localhost');
        return 'localhost';
      }

      return ip;
    } catch (_error) {
      this.logger.warn('Failed to get main node IP, using localhost');
      return 'localhost';
    }
  }

  /**
   * Get the main node from database
   */
  private async getMainNode() {
    return this.prisma.node.findFirst({
      where: { role: 'MAIN' },
    });
  }
}
