import { Injectable, Logger } from '@nestjs/common';
import { StorageProtocol, StorageShareStatus } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PrismaService } from '../../prisma/prisma.service';
import type { DockerVolumeMount } from '../interfaces/file-transport.interface';
import { DockerVolumeDetectorService } from './docker-volume-detector.service';

const execAsync = promisify(exec);

/**
 * NFS Auto-Export Service
 *
 * Detects Docker volume mounts and creates StorageShare records for child node discovery.
 *
 * IMPORTANT: This service does NOT create NFS exports itself!
 * NFS exports must be configured on the HOST (e.g., Unraid Settings → NFS).
 *
 * Flow:
 * 1. Unraid user configures NFS exports in Unraid UI (one-time setup)
 * 2. This service detects Docker volumes: /mnt/user/media:/media
 * 3. Creates StorageShare records: sharePath=/mnt/user/media, mountPoint=/media
 * 4. Child nodes fetch share info and mount via NFS
 *
 * Why we don't write /etc/exports:
 * - BitBonsai runs inside Docker, /etc/exports would be container's not host's
 * - Unraid already has NFS management in its UI
 * - Manual host-level NFS config is more reliable than container manipulation
 */
@Injectable()
export class NFSAutoExportService {
  private readonly logger = new Logger(NFSAutoExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly volumeDetector: DockerVolumeDetectorService
  ) {}

  /**
   * Detect Docker volumes and create StorageShare records for child node discovery.
   *
   * IMPORTANT: This does NOT create NFS exports on the host!
   * NFS exports must be pre-configured on the host (e.g., Unraid Settings → NFS).
   */
  async autoExportDockerVolumes(): Promise<void> {
    this.logger.log('🔍 Detecting Docker volumes for shared storage...');

    try {
      // Get the main node
      const mainNode = await this.getMainNode();
      if (!mainNode) {
        this.logger.warn('No main node found - skipping storage detection');
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
        this.logger.log('No Docker volumes detected');
        return;
      }

      this.logger.log(`Detected ${volumes.length} Docker volume(s)`);

      // Check which HOST paths are actually NFS-exported
      const exportedPaths = await this.getHostNFSExports();

      // Process each volume
      let createdCount = 0;
      let missingExportCount = 0;

      for (const volume of volumes) {
        const isExported = exportedPaths.some(
          (exp) => volume.source.startsWith(exp) || exp.startsWith(volume.source)
        );

        if (!isExported) {
          this.logger.warn(
            `⚠️  Volume ${volume.source} is NOT exported via NFS on host. ` +
              `Child nodes won't be able to mount it.`
          );
          missingExportCount++;
        }

        await this.createShareRecord(volume, mainNode.id, isExported);
        createdCount++;
      }

      // Summary logging with user guidance
      this.logger.log(`✓ Created ${createdCount} StorageShare record(s)`);

      if (missingExportCount > 0) {
        this.logger.warn('');
        this.logger.warn('═══════════════════════════════════════════════════════════════');
        this.logger.warn('  NFS SETUP REQUIRED FOR MULTI-NODE OPERATION');
        this.logger.warn('═══════════════════════════════════════════════════════════════');
        this.logger.warn('');
        this.logger.warn('  Some Docker volumes are not exported via NFS on the host.');
        this.logger.warn('  Child nodes will fall back to slower file transfers (rsync).');
        this.logger.warn('');
        this.logger.warn('  To enable zero-copy shared storage:');
        this.logger.warn('');
        this.logger.warn('  UNRAID:');
        this.logger.warn('    1. Go to Settings → NFS');
        this.logger.warn('    2. Set "Enable NFS" to Yes');
        this.logger.warn('    3. Add export rules for /mnt/user/media, /mnt/user/Downloads');
        this.logger.warn('    4. Apply and restart NFS');
        this.logger.warn('');
        this.logger.warn('  OTHER LINUX:');
        this.logger.warn('    1. Edit /etc/exports on HOST (not in Docker)');
        this.logger.warn('    2. Add: /path/to/media 192.168.1.0/24(rw,sync,no_subtree_check)');
        this.logger.warn('    3. Run: exportfs -ra');
        this.logger.warn('');
        this.logger.warn('═══════════════════════════════════════════════════════════════');
        this.logger.warn('');
      }
    } catch (error) {
      this.logger.error(
        'Failed to detect Docker volumes',
        error instanceof Error ? error.stack : error
      );
    }
  }

  /**
   * Query the HOST's NFS exports by checking what's visible from localhost
   */
  private async getHostNFSExports(): Promise<string[]> {
    try {
      // Try to get exports from the host via showmount
      // This works if we can reach the host (usually via gateway IP or host.docker.internal)
      const hostAddresses = ['host.docker.internal', '172.17.0.1', 'localhost'];

      for (const host of hostAddresses) {
        try {
          const { stdout } = await execAsync(`showmount -e ${host} 2>/dev/null`, {
            timeout: 5000,
          });

          // Parse showmount output: "/path/to/export 192.168.1.0/24"
          const exports = stdout
            .split('\n')
            .slice(1) // Skip header
            .map((line) => line.trim().split(/\s+/)[0])
            .filter((path) => path?.startsWith('/'));

          if (exports.length > 0) {
            this.logger.debug(`Found ${exports.length} NFS exports on host (${host})`);
            return exports;
          }
        } catch {
          // This host address didn't work, try next
        }
      }

      this.logger.debug('Could not query host NFS exports - assuming none configured');
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Create a StorageShare record for a Docker volume (without manipulating /etc/exports)
   */
  private async createShareRecord(
    volume: DockerVolumeMount,
    mainNodeId: string,
    isExportedOnHost: boolean
  ): Promise<void> {
    try {
      // Check if already exists
      const existing = await this.prisma.storageShare.findFirst({
        where: {
          ownerNodeId: mainNodeId,
          sharePath: volume.source,
          autoManaged: true,
        },
      });

      if (existing) {
        this.logger.debug(`Volume ${volume.source} already has StorageShare record`);
        return;
      }

      // Generate share name from destination path (container mount point)
      const shareName = this.volumeDetector.getSuggestedShareName(volume.destination);

      // Get main node's IP address
      const serverAddress = await this.getMainNodeIP();

      // Create StorageShare record
      const exportPath = `${serverAddress}:${volume.source}`;

      // Status depends on whether HOST has NFS export configured
      const status = isExportedOnHost ? StorageShareStatus.AVAILABLE : StorageShareStatus.ERROR;

      await this.prisma.storageShare.create({
        data: {
          nodeId: mainNodeId,
          ownerNodeId: mainNodeId,
          name: `${shareName} (Auto)`,
          protocol: StorageProtocol.NFS,
          status,
          serverAddress,
          sharePath: volume.source, // HOST path for NFS export
          exportPath,
          mountPoint: volume.destination, // Container path for child nodes
          readOnly: volume.readOnly,
          mountOptions: volume.readOnly ? 'ro,nolock,soft' : 'rw,nolock,soft',
          autoMount: true,
          addToFstab: true,
          mountOnDetection: true,
          autoManaged: true,
          isMounted: true, // Main node has direct access via Docker volume
          lastError: isExportedOnHost
            ? null
            : 'NFS export not configured on host - child nodes will use file transfer',
        },
      });

      const statusIcon = isExportedOnHost ? '✓' : '⚠️';
      this.logger.log(
        `${statusIcon} Created share record: ${volume.destination} → ${volume.source}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to create share record for ${volume.destination}`,
        error instanceof Error ? error.stack : error
      );
    }
  }

  /**
   * Remove all auto-managed StorageShare records
   * (No longer manipulates /etc/exports since we don't write to it)
   */
  async removeAutoManagedExports(): Promise<void> {
    try {
      const deleted = await this.prisma.storageShare.deleteMany({
        where: { autoManaged: true },
      });

      this.logger.log(`✓ Removed ${deleted.count} auto-managed StorageShare record(s)`);
    } catch (error) {
      this.logger.error(
        'Failed to remove auto-managed shares',
        error instanceof Error ? error.stack : error
      );
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
    } catch {
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
