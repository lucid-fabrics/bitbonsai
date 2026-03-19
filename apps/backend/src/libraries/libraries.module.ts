import { forwardRef, Module } from '@nestjs/common';
import { JobRepository } from '../common/repositories/job.repository';
import { LibraryRepository } from '../common/repositories/library.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import { PolicyRepository } from '../common/repositories/policy.repository';
import { DistributionModule } from '../distribution/distribution.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { SettingsModule } from '../settings/settings.module';
import { LibrariesController } from './libraries.controller';
import { LibrariesService } from './libraries.service';
import { MediaAnalysisService } from './services/media-analysis.service';

/**
 * LibrariesModule
 *
 * Provides complete CRUD API for managing media libraries.
 * Includes Prisma database integration and media analysis capabilities.
 * File watcher communication happens via EventEmitter (no direct module dependency).
 */
@Module({
  imports: [
    // forwardRef required: LibrariesModule ↔ QueueModule circular dependency
    // LibrariesService calls QueueService.create() to enqueue encoding jobs
    // QueueModule imports LibrariesModule for MediaAnalysisService (probeVideoFile)
    // Removing requires extracting job creation or media probing into a shared module
    forwardRef(() => QueueModule),
    DistributionModule,
    SettingsModule,
    PrismaModule,
  ],
  controllers: [LibrariesController],
  providers: [
    LibrariesService,
    MediaAnalysisService,
    LibraryRepository,
    NodeRepository,
    JobRepository,
    PolicyRepository,
  ],
  exports: [LibrariesService, MediaAnalysisService],
})
export class LibrariesModule {}
