import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { JobRepository } from '../common/repositories/job.repository';
import { LicenseRepository } from '../common/repositories/license.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { JobLimitGuard } from './guards/job-limit.guard';
import { NodeLimitGuard } from './guards/node-limit.guard';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';
import { LicenseClientService } from './license-client.service';
import { LicenseGuardService } from './license-guard.service';

/**
 * LicenseModule
 *
 * Provides license management functionality:
 * - License validation and creation (provider mode - legacy)
 * - License verification client (consumer mode - queries remote API)
 * - License limit enforcement (nodes, concurrent jobs)
 * - Feature gating based on tier
 *
 * Note: ScheduleModule.forRoot() is registered in AppModule
 */
@Module({
  imports: [
    PrismaModule,
    // M2: Configure global HTTP timeout and redirect limits
    HttpModule.register({
      timeout: 10000, // 10 second default timeout
      maxRedirects: 3,
    }),
  ],
  controllers: [LicenseController],
  providers: [
    LicenseRepository,
    NodeRepository,
    JobRepository,
    LicenseService,
    LicenseGuardService,
    LicenseClientService,
    NodeLimitGuard,
    JobLimitGuard,
  ],
  exports: [
    LicenseRepository,
    LicenseService,
    LicenseGuardService,
    LicenseClientService,
    NodeLimitGuard,
    JobLimitGuard,
  ],
})
export class LicenseModule {}
