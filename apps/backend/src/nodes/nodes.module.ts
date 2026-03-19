import { forwardRef, Module } from '@nestjs/common';
import { JobRepository } from '../common/repositories/job.repository';
import { LicenseRepository } from '../common/repositories/license.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import { CoreModule } from '../core/core.module';
import { DistributionModule } from '../distribution/distribution.module';
import { LibrariesModule } from '../libraries/libraries.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaService } from '../prisma/prisma.service';
import { NodeRegistrationController } from './controllers/node-registration.controller';
import { StorageSharesController } from './controllers/storage-shares.controller';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';
import { RegistrationRequestRepository } from './repositories/registration-request.repository';
import { StorageShareRepository } from './repositories/storage-share.repository';
import { JobAttributionService } from './services/job-attribution.service';
import { NodeCapabilityDetectorService } from './services/node-capability-detector.service';
import { NodeDiscoveryService } from './services/node-discovery.service';
import { RegistrationRequestService } from './services/registration-request.service';
import { ScheduleEnforcementService } from './services/schedule-enforcement.service';
import { SharedStorageVerifierService } from './services/shared-storage-verifier.service';
import { SshKeyService } from './services/ssh-key.service';
import { StorageMountService } from './services/storage-mount.service';
import { StorageShareService } from './services/storage-share.service';
import { MountStrategyFactory } from './services/strategies/mount-strategy.factory';
import { NFSMountStrategy } from './services/strategies/nfs-mount.strategy';
import { SMBMountStrategy } from './services/strategies/smb-mount.strategy';
import { SystemInfoService } from './services/system-info.service';

/**
 * NodesModule
 *
 * Provides complete API for multi-node architecture management:
 * - Node registration with license validation
 * - Pairing mechanism (6-digit token)
 * - Heartbeat tracking and uptime monitoring
 * - Node statistics and cluster overview
 * - mDNS-based node discovery (MAIN node broadcasting)
 * - Registration request queue with pending approval
 * - System information collection (hardware, network, container type)
 */
@Module({
  imports: [
    CoreModule,
    NotificationsModule,
    DistributionModule,
    // forwardRef required: NodesModule ↔ LibrariesModule circular dependency
    // NodeCapabilityDetectorService injects LibrariesService.getAllLibraryPaths()
    // LibrariesModule imports QueueModule which imports EncodingModule which imports NodesModule
    forwardRef(() => LibrariesModule),
  ],
  controllers: [NodesController, NodeRegistrationController, StorageSharesController],
  providers: [
    NodesService,
    PrismaService,
    NodeRepository,
    JobRepository,
    LicenseRepository,
    RegistrationRequestRepository,
    {
      provide: 'IStorageShareRepository',
      useClass: StorageShareRepository,
    },
    NodeDiscoveryService,
    RegistrationRequestService,
    SystemInfoService,
    NodeCapabilityDetectorService,
    JobAttributionService,
    ScheduleEnforcementService,
    StorageShareService,
    StorageMountService,
    SshKeyService,
    SharedStorageVerifierService,
    // Mount strategies
    NFSMountStrategy,
    SMBMountStrategy,
    MountStrategyFactory,
  ],
  exports: [
    NodesService,
    NodeDiscoveryService,
    RegistrationRequestService,
    SystemInfoService,
    NodeCapabilityDetectorService,
    JobAttributionService,
    ScheduleEnforcementService,
    StorageShareService,
    StorageMountService,
    SshKeyService,
    SharedStorageVerifierService,
  ],
})
export class NodesModule {}
