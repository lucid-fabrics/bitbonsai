import { Module } from '@nestjs/common';
import { JobRepository } from '../common/repositories/job.repository';
import { LibraryRepository } from '../common/repositories/library.repository';
import { NodeRepository } from '../common/repositories/node.repository';
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
  providers: [OverviewService, JobRepository, NodeRepository, LibraryRepository],
  exports: [OverviewService],
})
export class OverviewModule {}
