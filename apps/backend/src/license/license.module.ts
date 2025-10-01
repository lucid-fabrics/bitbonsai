import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';

/**
 * LicenseModule
 *
 * Provides license management functionality:
 * - License validation
 * - License creation
 * - Node limit checking
 *
 * Imports PrismaModule for database access
 */
@Module({
  imports: [PrismaModule],
  controllers: [LicenseController],
  providers: [LicenseService],
  exports: [LicenseService],
})
export class LicenseModule {}
