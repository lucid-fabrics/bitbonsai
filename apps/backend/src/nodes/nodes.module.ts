import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaService } from '../prisma/prisma.service';
import { StorageSharesController } from './controllers/storage-shares.controller';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';
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
  imports: [CoreModule, NotificationsModule],
  controllers: [NodesController, StorageSharesController],
  providers: [
    NodesService,
    PrismaService,
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
