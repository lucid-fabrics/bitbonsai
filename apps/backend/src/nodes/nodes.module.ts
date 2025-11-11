import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';
import { NodeCapabilityDetectorService } from './services/node-capability-detector.service';
import { NodeDiscoveryService } from './services/node-discovery.service';
import { RegistrationRequestService } from './services/registration-request.service';
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
  controllers: [NodesController],
  providers: [
    NodesService,
    PrismaService,
    NodeDiscoveryService,
    RegistrationRequestService,
    SystemInfoService,
    NodeCapabilityDetectorService,
  ],
  exports: [
    NodesService,
    NodeDiscoveryService,
    RegistrationRequestService,
    SystemInfoService,
    NodeCapabilityDetectorService,
  ],
})
export class NodesModule {}
