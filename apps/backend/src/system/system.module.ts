import { Module } from '@nestjs/common';
import { JobRepository } from '../common/repositories/job.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import { EncodingModule } from '../encoding/encoding.module';
import { LibrariesModule } from '../libraries/libraries.module';
import { NodesModule } from '../nodes/nodes.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DashboardController } from './dashboard.controller';
import { DebugController } from './debug.controller';
import { DebugService } from './debug.service';
import { HardwareDetectionService } from './hardware-detection.service';
import { HealthDashboardService } from './health-dashboard.service';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

/**
 * SystemModule
 *
 * Provides system-level services and monitoring.
 * Includes hardware detection, system metrics, health dashboard, and debug endpoints.
 */
@Module({
  imports: [EncodingModule, NodesModule, LibrariesModule, PrismaModule],
  controllers: [SystemController, DashboardController, DebugController],
  providers: [
    SystemService,
    HardwareDetectionService,
    HealthDashboardService,
    DebugService,
    NodeRepository,
    JobRepository,
  ],
  exports: [SystemService, HardwareDetectionService, HealthDashboardService, DebugService],
})
export class SystemModule {}
