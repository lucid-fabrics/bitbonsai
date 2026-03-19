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
import { EncodingFileReplacementService } from './encoding-file-replacement.service';
import { EncodingHistoryService } from './encoding-history.service';
import { EncodingOutputVerificationService } from './encoding-output-verification.service';
import { EncodingPreviewService } from './encoding-preview.service';
import { EncodingProcessorService } from './encoding-processor.service';
import { EncodingSchedulerService } from './encoding-scheduler.service';
import { EncodingStartupService } from './encoding-startup.service';
import { EncodingWatchdogService } from './encoding-watchdog.service';
import { FfmpegService } from './ffmpeg.service';
import { FfmpegFileVerificationService } from './ffmpeg-file-verification.service';
import { FfmpegFlagBuilderService } from './ffmpeg-flag-builder.service';
import { FfmpegProcessCleanupService } from './ffmpeg-process-cleanup.service';
import { FfmpegProgressParserService } from './ffmpeg-progress-parser.service';
import { FfprobeService } from './ffprobe.service';
import { FileHealthService } from './file-health.service';
import { HardwareAccelerationService } from './hardware-acceleration.service';
import { JobRetryStrategyService } from './job-retry-strategy.service';
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
    // EncodingFileService injects LibrariesService.findOne() + update()
    // LibrariesModule imports QueueModule which imports EncodingModule
    forwardRef(() => LibrariesModule),
    // NodesModule is a plain import: NodesModule no longer imports LibrariesModule
    // so the transitive cycle EncodingModule → NodesModule → ... → EncodingModule is gone
    NodesModule,
  ],
  controllers: [EncodingController],
  providers: [
    EncodingFileService,
    EncodingFileReplacementService,
    EncodingOutputVerificationService,
    EncodingProcessorService,
    EncodingStartupService,
    EncodingWatchdogService,
    FfmpegFlagBuilderService,
    FfmpegProgressParserService,
    FfprobeService,
    FfmpegProcessCleanupService,
    FfmpegFileVerificationService,
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
    JobRetryStrategyService,
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
