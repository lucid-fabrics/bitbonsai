import { forwardRef, Module } from '@nestjs/common';
import { DistributionModule } from '../distribution/distribution.module';
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
 * Includes Prisma database integration and media analysis capabilities.
 * File watcher communication happens via EventEmitter (no direct module dependency).
 */
@Module({
  imports: [forwardRef(() => QueueModule), DistributionModule, SettingsModule],
  controllers: [LibrariesController],
  providers: [LibrariesService, MediaAnalysisService, PrismaService],
  exports: [LibrariesService, MediaAnalysisService],
})
export class LibrariesModule {}
