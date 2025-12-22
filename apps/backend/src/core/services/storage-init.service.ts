import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import { StorageShareService } from '../../nodes/services/storage-share.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NFSAutoExportService } from './nfs-auto-export.service';

const execAsync = promisify(exec);

/**
 * Storage Initialization Service
 *
 * Automatically initializes storage sharing on application startup:
 * - MAIN nodes: Detects Docker volumes and creates StorageShare records
 * - LINKED nodes: Verifies NFS mounts and sets hasSharedStorage accordingly
 *
 * NOTE: NFS exports must be configured on the HOST (e.g., Unraid Settings → NFS).
 * This service does NOT create NFS exports - it only detects and verifies them.
 */
@Injectable()
export class StorageInitService implements OnModuleInit {
  private readonly logger = new Logger(StorageInitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nfsAutoExport: NFSAutoExportService,
    private readonly storageShareService: StorageShareService
  ) {}

  async onModuleInit() {
    // Wait a moment for database to be fully initialized
    setTimeout(() => this.initializeStorage(), 2000);
  }

  /**
   * Initialize storage sharing based on node role
   */
  private async initializeStorage(): Promise<void> {
    try {
      // Get the current node from database
      const currentNode = await this.prisma.node.findFirst();

      if (!currentNode) {
        this.logger.debug('No node found in database - skipping storage initialization');
        return;
      }

      if (currentNode.role === 'MAIN') {
        // MAIN node: Detect Docker volumes and create StorageShare records
        this.logger.log('🗂️  Detected MAIN node - detecting Docker volumes...');
        await this.nfsAutoExport.autoExportDockerVolumes();
        this.logger.log('✅ MAIN node storage initialization complete');
      } else if (currentNode.role === 'LINKED') {
        // LINKED node: Verify NFS mounts and set hasSharedStorage
        this.logger.log('🗂️  Detected LINKED node - verifying shared storage...');

        // Check for NFS mounts FIRST (from deploy script or manual setup)
        const hasNFSMounts = await this.verifyNFSMounts();

        if (hasNFSMounts) {
          this.logger.log('✅ NFS mounts detected - enabling shared storage mode');

          // Update node to enable shared storage
          await this.prisma.node.update({
            where: { id: currentNode.id },
            data: {
              hasSharedStorage: true,
              networkLocation: 'LOCAL',
            },
          });

          this.logger.log('✅ LINKED node: Zero-copy shared storage ENABLED');
        } else {
          this.logger.warn('⚠️  No NFS mounts detected - will use file transfer mode');

          // Ensure hasSharedStorage is false
          await this.prisma.node.update({
            where: { id: currentNode.id },
            data: {
              hasSharedStorage: false,
            },
          });

          // Try to auto-detect and mount shares from main node
          if (currentNode.mainNodeUrl) {
            this.logger.log('Attempting to fetch share info from main node...');
            const result = await this.storageShareService.autoDetectAndMount(currentNode.id);

            this.logger.log(
              `Auto-detect result: ${result.detected} detected, ${result.mounted} mounted`
            );

            if (result.mounted > 0) {
              // Re-verify mounts after auto-mount attempt
              const mountsNow = await this.verifyNFSMounts();
              if (mountsNow) {
                await this.prisma.node.update({
                  where: { id: currentNode.id },
                  data: { hasSharedStorage: true, networkLocation: 'LOCAL' },
                });
                this.logger.log('✅ NFS mounts now working - shared storage enabled');
              }
            }

            if (result.errors.length > 0) {
              this.logger.warn(`Mount errors: ${result.errors.join(', ')}`);
            }
          } else {
            this.logger.warn('No mainNodeUrl configured - cannot fetch share info');
          }
        }
      }
    } catch (error) {
      this.logger.error(
        '❌ Failed to initialize storage:',
        error instanceof Error ? error.stack : error
      );
      // Don't throw - allow app to continue even if storage init fails
    }
  }

  /**
   * Check if any NFS mounts exist on this system
   * Returns true if at least one NFS mount is found
   */
  private async verifyNFSMounts(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('mount -t nfs,nfs4 2>/dev/null || true');
      const nfsMounts = stdout
        .trim()
        .split('\n')
        .filter((line) => line.includes(' on '));

      if (nfsMounts.length > 0) {
        this.logger.debug(`Found ${nfsMounts.length} NFS mount(s):`);
        for (const mount of nfsMounts) {
          const match = mount.match(/(\S+) on (\S+)/);
          if (match) {
            this.logger.debug(`  - ${match[1]} → ${match[2]}`);
          }
        }
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }
}
