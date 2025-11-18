import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DataAccessService } from './services/data-access.service';
import { DockerVolumeDetectorService } from './services/docker-volume-detector.service';
import { EnvironmentDetectorService } from './services/environment-detector.service';
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
 * - StorageInitService for initializing storage on app startup
 */
@Module({
  imports: [
    HttpModule.register({
      timeout: 30000, // 30 second default timeout
      maxRedirects: 5,
    }),
    PrismaModule,
  ],
  providers: [
    NodeConfigService,
    DataAccessService,
    DockerVolumeDetectorService,
    NFSAutoExportService,
    StorageInitService,
    EnvironmentDetectorService,
  ],
  exports: [
    NodeConfigService,
    DataAccessService,
    DockerVolumeDetectorService,
    NFSAutoExportService,
    StorageInitService,
    EnvironmentDetectorService,
    HttpModule,
  ],
})
export class CoreModule {}
