import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { CloudAuthModule } from '../cloud-auth/cloud-auth.module';
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

@Module({
  imports: [
    PrismaModule,
    CloudAuthModule,
    HttpModule.register({
      timeout: 10000,
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
