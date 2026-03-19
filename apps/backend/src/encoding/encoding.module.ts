import { forwardRef, Module } from '@nestjs/common';
import { JobRepository } from '../common/repositories/job.repository';
import { LibraryRepository } from '../common/repositories/library.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import { PolicyRepository } from '../common/repositories/policy.repository';
import { SettingsRepository } from '../common/repositories/settings.repository';
import { CoreModule } from '../core/core.module';
import { LibrariesModule } from '../libraries/libraries.module';
import { NodesModule } from '../nodes/nodes.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ContainerCompatibilityService } from './container-compatibility.service';
import { EncodingController } from './encoding.controller';
import { EncodingFileService } from './encoding-file.service';
import { EncodingHistoryService } from './encoding-history.service';
import { EncodingPreviewService } from './encoding-preview.service';
import { EncodingProcessorService } from './encoding-processor.service';
import { EncodingSchedulerService } from './encoding-scheduler.service';
import { FfmpegService } from './ffmpeg.service';
import { FfmpegFlagBuilderService } from './ffmpeg-flag-builder.service';
import { FileHealthService } from './file-health.service';
import { HardwareAccelerationService } from './hardware-acceleration.service';
import { PoolLockService } from './pool-lock.service';
import { QualityMetricsService } from './quality-metrics.service';
import { SystemResourceService } from './system-resource.service';
import { WorkerPoolService } from './worker-pool.service';

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
    // forwardRef required: EncodingModule ↔ LibrariesModule circular dependency
    // EncodingFileService + EncodingProcessorService inject LibrariesService.getAllLibraryPaths()
    // LibrariesModule imports QueueModule which imports EncodingModule
    forwardRef(() => LibrariesModule),
    // forwardRef required: EncodingModule ↔ NodesModule circular dependency
    // EncodingProcessorService + SystemResourceService inject NodesService.getCurrentNode()
    // NodesModule imports LibrariesModule which imports QueueModule which imports EncodingModule
    forwardRef(() => NodesModule),
  ],
  controllers: [EncodingController],
  providers: [
    EncodingFileService,
    EncodingProcessorService,
    FfmpegFlagBuilderService,
    FfmpegService,
    HardwareAccelerationService,
    FileHealthService,
    ContainerCompatibilityService,
    EncodingPreviewService,
    EncodingHistoryService,
    EncodingSchedulerService,
    PoolLockService,
    QualityMetricsService,
    SystemResourceService,
    WorkerPoolService,
    JobRepository,
    LibraryRepository,
    NodeRepository,
    PolicyRepository,
    SettingsRepository,
  ],
  exports: [
    EncodingProcessorService,
    FfmpegService,
    FileHealthService,
    ContainerCompatibilityService,
    EncodingPreviewService,
    EncodingHistoryService,
    EncodingSchedulerService,
    QualityMetricsService,
  ],
})
export class EncodingModule {}
