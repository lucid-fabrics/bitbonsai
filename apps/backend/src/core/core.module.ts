import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { NodeRepository } from '../common/repositories/node.repository';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StorageShareRepository } from '../nodes/repositories/storage-share.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { ContentFingerprintService } from './services/content-fingerprint.service';
import { DataAccessService } from './services/data-access.service';
import { DockerVolumeDetectorService } from './services/docker-volume-detector.service';
import { EncryptionService } from './services/encryption.service';
import { EnvironmentDetectorService } from './services/environment-detector.service';
import { FileRelocatorService } from './services/file-relocator.service';
import { NFSAutoExportService } from './services/nfs-auto-export.service';
import { NodeConfigService } from './services/node-config.service';
import { StorageInitService } from './services/storage-init.service';

/**
 * CoreModule
 *
 * Provides core services that are used across the application.
 * Includes:
 * - DataAccessService for unified data access abstraction
 * - NodeConfigService for node configuration management
 * - DockerVolumeDetectorService for detecting Docker volume mounts
 * - NFSAutoExportService for auto-exporting Docker volumes as NFS shares
 * - StorageInitService for initializing storage on app startup (uses events for cross-module comms)
 * - EncryptionService for encrypting sensitive data (passwords, API keys)
 */
@Module({
  imports: [
    HttpModule.register({
      timeout: 30000, // 30 second default timeout
      maxRedirects: 5,
    }),
    PrismaModule,
    IntegrationsModule,
  ],
  providers: [
    NodeConfigService,
    ContentFingerprintService,
    DataAccessService,
    DockerVolumeDetectorService,
    EncryptionService,
    FileRelocatorService,
    NFSAutoExportService,
    StorageInitService,
    EnvironmentDetectorService,
    NodeRepository,
    {
      provide: 'IStorageShareRepository',
      useClass: StorageShareRepository,
    },
  ],
  exports: [
    NodeConfigService,
    ContentFingerprintService,
    DataAccessService,
    DockerVolumeDetectorService,
    EncryptionService,
    FileRelocatorService,
    NFSAutoExportService,
    StorageInitService,
    EnvironmentDetectorService,
    HttpModule,
  ],
})
export class CoreModule {}
