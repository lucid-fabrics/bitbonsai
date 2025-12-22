import { forwardRef, Module } from '@nestjs/common';
import { DistributionModule } from '../distribution/distribution.module';
import { FileWatcherModule } from '../file-watcher/file-watcher.module';
import { PrismaService } from '../prisma/prisma.service';
import { QueueModule } from '../queue/queue.module';
import { SettingsModule } from '../settings/settings.module';
import { LibrariesController } from './libraries.controller';
import { LibrariesService } from './libraries.service';
import { MediaAnalysisService } from './services/media-analysis.service';

/**
 * LibrariesModule
 *
 * Provides complete CRUD API for managing media libraries.
 * Includes Prisma database integration, file watching, and media analysis capabilities.
 */
@Module({
  imports: [
    forwardRef(() => FileWatcherModule),
    forwardRef(() => QueueModule),
    forwardRef(() => DistributionModule),
    SettingsModule,
  ],
  controllers: [LibrariesController],
  providers: [LibrariesService, MediaAnalysisService, PrismaService],
  exports: [LibrariesService, MediaAnalysisService],
})
export class LibrariesModule {}
