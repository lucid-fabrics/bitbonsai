import { forwardRef, Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { LibrariesModule } from '../libraries/libraries.module';
import { NodesModule } from '../nodes/nodes.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ContainerCompatibilityService } from './container-compatibility.service';
import { EncodingController } from './encoding.controller';
import { EncodingHistoryService } from './encoding-history.service';
import { EncodingPreviewService } from './encoding-preview.service';
import { EncodingProcessorService } from './encoding-processor.service';
import { EncodingSchedulerService } from './encoding-scheduler.service';
import { FfmpegService } from './ffmpeg.service';
import { FileHealthService } from './file-health.service';

/**
 * EncodingModule
 *
 * Provides encoding job processing with FFmpeg integration.
 * Handles worker orchestration, queue management, and file operations.
 * Uses EventEmitter2 for real-time progress tracking (registered globally in AppModule).
 * FfmpegService communicates with QueueService via events (no direct dependency).
 * Includes FileHealthService for pre-encoding file validation.
 * Includes EncodingPreviewService for live encoding preview generation.
 * Includes EncodingHistoryService for ETA improvements with historical data.
 */
@Module({
  imports: [
    CoreModule,
    PrismaModule,
    forwardRef(() => LibrariesModule),
    forwardRef(() => NodesModule),
  ],
  controllers: [EncodingController],
  providers: [
    EncodingProcessorService,
    FfmpegService,
    FileHealthService,
    ContainerCompatibilityService,
    EncodingPreviewService,
    EncodingHistoryService,
    EncodingSchedulerService,
    PrismaService,
  ],
  exports: [
    EncodingProcessorService,
    FfmpegService,
    FileHealthService,
    ContainerCompatibilityService,
    EncodingPreviewService,
    EncodingHistoryService,
    EncodingSchedulerService,
  ],
})
export class EncodingModule {}
