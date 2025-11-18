import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NFSAutoExportService } from './nfs-auto-export.service';

/**
 * Storage Initialization Service
 *
 * Automatically initializes storage sharing on application startup:
 * - Detects if running as MAIN node
 * - Auto-exports Docker volumes as NFS shares
 * - Enables zero-config storage sharing for child nodes
 *
 * This runs once on startup to ensure Docker volumes are immediately
 * available for sharing with child nodes.
 */
@Injectable()
export class StorageInitService implements OnModuleInit {
  private readonly logger = new Logger(StorageInitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nfsAutoExport: NFSAutoExportService
  ) {}

  async onModuleInit() {
    // Wait a moment for database to be fully initialized
    setTimeout(() => this.initializeStorage(), 2000);
  }

  /**
   * Initialize storage sharing if this is the main node
   */
  private async initializeStorage(): Promise<void> {
    try {
      // Check if this is a MAIN node
      const mainNode = await this.prisma.node.findFirst({
        where: { role: 'MAIN' },
      });

      if (!mainNode) {
        this.logger.debug('Not a main node - skipping storage auto-export');
        return;
      }

      this.logger.log('🗂️  Detected MAIN node - initiating Docker volume auto-export...');

      // Auto-export Docker volumes
      await this.nfsAutoExport.autoExportDockerVolumes();

      this.logger.log('✅ Storage initialization complete');
    } catch (error) {
      this.logger.error(
        '❌ Failed to initialize storage:',
        error instanceof Error ? error.stack : error
      );
      // Don't throw - allow app to continue even if storage init fails
    }
  }
}
