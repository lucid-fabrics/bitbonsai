import { Module } from '@nestjs/common';
import { JobRepository } from '../common/repositories/job.repository';
import { LibraryRepository } from '../common/repositories/library.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import { PolicyRepository } from '../common/repositories/policy.repository';
import { DistributionModule } from '../distribution/distribution.module';
import { MediaModule } from '../media/media.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { SettingsModule } from '../settings/settings.module';
import { LibrariesController } from './libraries.controller';
import { LibrariesService } from './libraries.service';
import { LibraryBulkJobService } from './library-bulk-job.service';
import { LibraryScannerService } from './library-scanner.service';

/**
 * LibrariesModule
 *
 * Provides complete CRUD API for managing media libraries.
 * Includes Prisma database integration and media analysis capabilities.
 * File watcher communication happens via EventEmitter (no direct module dependency).
 * MediaAnalysisService is provided by MediaModule to avoid circular dependencies.
 */
@Module({
  imports: [QueueModule, MediaModule, DistributionModule, SettingsModule, PrismaModule],
  controllers: [LibrariesController],
  providers: [
    LibrariesService,
    LibraryScannerService,
    LibraryBulkJobService,
    LibraryRepository,
    NodeRepository,
    JobRepository,
    PolicyRepository,
  ],
  exports: [LibrariesService, LibraryScannerService, LibraryBulkJobService],
})
export class LibrariesModule {}
