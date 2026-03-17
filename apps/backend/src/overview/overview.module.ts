import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

/**
 * OverviewModule
 *
 * Provides dashboard overview statistics with aggregated metrics.
 * Imports PrismaModule for database access.
 */
@Module({
  imports: [PrismaModule],
  controllers: [OverviewController],
  providers: [OverviewService],
  exports: [OverviewService],
})
export class OverviewModule {}
