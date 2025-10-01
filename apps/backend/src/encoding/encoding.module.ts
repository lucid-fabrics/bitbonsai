import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LibrariesModule } from '../libraries/libraries.module';
import { QueueModule } from '../queue/queue.module';
import { EncodingProcessorService } from './encoding-processor.service';
import { FfmpegService } from './ffmpeg.service';

/**
 * EncodingModule
 *
 * Provides encoding job processing with FFmpeg integration.
 * Handles worker orchestration, queue management, and file operations.
 * Includes EventEmitter2 for real-time progress tracking.
 */
@Module({
  imports: [EventEmitterModule.forRoot(), QueueModule, LibrariesModule],
  providers: [EncodingProcessorService, FfmpegService],
  exports: [EncodingProcessorService, FfmpegService],
})
export class EncodingModule {}
