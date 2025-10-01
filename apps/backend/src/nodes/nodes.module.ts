import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';

/**
 * NodesModule
 *
 * Provides complete API for multi-node architecture management:
 * - Node registration with license validation
 * - Pairing mechanism (6-digit token)
 * - Heartbeat tracking and uptime monitoring
 * - Node statistics and cluster overview
 */
@Module({
  controllers: [NodesController],
  providers: [NodesService, PrismaService],
  exports: [NodesService],
})
export class NodesModule {}
