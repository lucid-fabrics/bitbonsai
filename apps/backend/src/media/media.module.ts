import { Module } from '@nestjs/common';
import { LibraryRepository } from '../common/repositories/library.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { LibraryPathsService } from './library-paths.service';
import { MediaAnalysisService } from './media-analysis.service';

/**
 * MediaModule
 *
 * Provides FFprobe-based media analysis and library path lookups as a standalone module.
 * Extracted from LibrariesModule to break circular dependencies:
 *
 * - LibrariesModule ↔ QueueModule: QueueProcessingService needed MediaAnalysisService
 * - NodesModule ↔ LibrariesModule: NodeCapabilityDetectorService needed getAllLibraryPaths()
 * - QueueModule ↔ NodesModule: transitive via EncodingModule needing both Libraries + Nodes
 *
 * No circular module dependencies — only depends on PrismaModule.
 */
@Module({
  imports: [PrismaModule],
  providers: [MediaAnalysisService, LibraryPathsService, LibraryRepository],
  exports: [MediaAnalysisService, LibraryPathsService],
})
export class MediaModule {}
