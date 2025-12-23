import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';
import { LicenseGuardService } from './license-guard.service';

/**
 * LicenseModule
 *
 * Provides license management functionality:
 * - License validation and creation
 * - License limit enforcement (nodes, concurrent jobs)
 * - Feature gating based on tier
 */
@Module({
  imports: [PrismaModule],
  controllers: [LicenseController],
  providers: [LicenseService, LicenseGuardService],
  exports: [LicenseService, LicenseGuardService],
})
export class LicenseModule {}
