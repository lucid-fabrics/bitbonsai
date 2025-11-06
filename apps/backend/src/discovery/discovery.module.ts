import { Module } from '@nestjs/common';
import { NodesModule } from '../nodes/nodes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaService } from '../prisma/prisma.service';
import { SyncModule } from '../sync/sync.module';
import { SystemModule } from '../system/system.module';
import { DiscoveryController } from './discovery.controller';
import { NodeDiscoveryService } from './node-discovery.service';

/**
 * DiscoveryModule
 *
 * Provides mDNS-based auto-discovery for BitBonsai distributed encoding nodes.
 *
 * Features:
 * - Automatic broadcasting for MAIN nodes
 * - Network scanning for LINKED nodes
 * - Pairing workflow with token exchange
 * - Real-time node discovery events
 * - Hardware capabilities detection and broadcasting
 * - Automatic policy and settings sync on approval
 */
@Module({
  imports: [NodesModule, NotificationsModule, SystemModule, SyncModule],
  controllers: [DiscoveryController],
  providers: [NodeDiscoveryService, PrismaService],
  exports: [NodeDiscoveryService],
})
export class DiscoveryModule {}
