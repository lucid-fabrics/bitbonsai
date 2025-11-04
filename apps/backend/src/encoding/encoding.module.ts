import { forwardRef, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LibrariesModule } from '../libraries/libraries.module';
import { QueueModule } from '../queue/queue.module';
import { EncodingController } from './encoding.controller';
import { EncodingPreviewService } from './encoding-preview.service';
import { EncodingProcessorService } from './encoding-processor.service';
import { FfmpegService } from './ffmpeg.service';
import { FileHealthService } from './file-health.service';

/**
 * EncodingModule
 *
 * Provides encoding job processing with FFmpeg integration.
 * Handles worker orchestration, queue management, and file operations.
 * Includes EventEmitter2 for real-time progress tracking.
 * Includes FileHealthService for pre-encoding file validation.
 * Includes EncodingPreviewService for live encoding preview generation.
 */
@Module({
  imports: [EventEmitterModule.forRoot(), forwardRef(() => QueueModule), LibrariesModule],
  controllers: [EncodingController],
  providers: [EncodingProcessorService, FfmpegService, FileHealthService, EncodingPreviewService],
  exports: [EncodingProcessorService, FfmpegService, FileHealthService, EncodingPreviewService],
})
export class EncodingModule {}
