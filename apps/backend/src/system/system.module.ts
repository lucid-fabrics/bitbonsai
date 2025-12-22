import { forwardRef, Module } from '@nestjs/common';
import { EncodingModule } from '../encoding/encoding.module';
import { LibrariesModule } from '../libraries/libraries.module';
import { NodesModule } from '../nodes/nodes.module';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardController } from './dashboard.controller';
import { DebugController } from './debug.controller';
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
  imports: [
    forwardRef(() => EncodingModule),
    forwardRef(() => NodesModule),
    forwardRef(() => LibrariesModule),
  ],
  controllers: [SystemController, DashboardController, DebugController],
  providers: [SystemService, HardwareDetectionService, HealthDashboardService, PrismaService],
  exports: [SystemService, HardwareDetectionService, HealthDashboardService],
})
export class SystemModule {}
