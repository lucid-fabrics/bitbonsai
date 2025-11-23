import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { StorageShareService } from '../../nodes/services/storage-share.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NFSAutoExportService } from './nfs-auto-export.service';

/**
 * Storage Initialization Service
 *
 * Automatically initializes storage sharing on application startup:
 * - MAIN nodes: Auto-exports Docker volumes as NFS shares
 * - LINKED nodes: Auto-detects and mounts shares from main node
 * - Enables zero-config storage sharing for all nodes
 *
 * This runs once on startup to ensure storage is immediately available.
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
        // MAIN node: Auto-export Docker volumes as NFS shares
        this.logger.log('🗂️  Detected MAIN node - initiating Docker volume auto-export...');
        await this.nfsAutoExport.autoExportDockerVolumes();
        this.logger.log('✅ MAIN node storage initialization complete');
      } else if (currentNode.role === 'LINKED') {
        // LINKED node: Auto-detect and mount shares from main node
        this.logger.log('🗂️  Detected LINKED node - initiating storage auto-mount...');

        // Only auto-mount if mainNodeUrl is configured
        if (!currentNode.mainNodeUrl) {
          this.logger.warn(
            '⚠️  No mainNodeUrl configured - skipping auto-mount (will mount after pairing)'
          );
          return;
        }

        const result = await this.storageShareService.autoDetectAndMount(currentNode.id);

        this.logger.log(
          `✅ LINKED node storage initialization complete: ${result.detected} detected, ${result.created} created, ${result.mounted} mounted`
        );

        if (result.errors.length > 0) {
          this.logger.warn(`⚠️  Mount errors: ${result.errors.join(', ')}`);
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
}
