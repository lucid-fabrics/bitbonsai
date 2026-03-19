import { forwardRef, Module } from '@nestjs/common';
import { JobRepository } from '../common/repositories/job.repository';
import { LibraryRepository } from '../common/repositories/library.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import { SettingsRepository } from '../common/repositories/settings.repository';
import { CoreModule } from '../core/core.module';
import { EncodingModule } from '../encoding/encoding.module';
import { LibrariesModule } from '../libraries/libraries.module';
import { NodesModule } from '../nodes/nodes.module';
import { PrismaService } from '../prisma/prisma.service';
import { BackupCleanupWorker } from './backup-cleanup.worker';
import { BatchController } from './batch.controller';
import { JobController } from './controllers/job.controller';
import { JobMetricsController } from './controllers/job-metrics.controller';
import { JobPreviewController } from './controllers/job-preview.controller';
import { JobTransferController } from './controllers/job-transfer.controller';
import { QueueManagementController } from './controllers/queue-management.controller';
import { FileTransferWorker } from './file-transfer.worker';
import { HealthCheckWorker } from './health-check.worker';
import { QueueService } from './queue.service';
import { AutoHealingService } from './services/auto-healing.service';
import { BatchOperationsService } from './services/batch-operations.service';
import { FileFailureTrackingService } from './services/file-failure-tracking.service';
import { FileTransferService } from './services/file-transfer.service';
import { JobBulkOperationsService } from './services/job-bulk-operations.service';
import { JobCleanupService } from './services/job-cleanup.service';
import { JobFileOperationsService } from './services/job-file-operations.service';
import { JobHistoryService } from './services/job-history.service';
import { JobMetricsService } from './services/job-metrics.service';
import { JobRouterService } from './services/job-router.service';
import { QueueDelegationService } from './services/queue-delegation.service';
import { QueueJobCrudService } from './services/queue-job-crud.service';
import { QueueJobStateService } from './services/queue-job-state.service';
import { QueueProcessingService } from './services/queue-processing.service';
import { RetrySchedulerService } from './services/retry-scheduler.service';
import { WebhookNotificationService } from './services/webhook-notification.service';
import { StuckJobRecoveryWorker } from './stuck-job-recovery.worker';

/**
 * QueueModule
 *
 * Provides complete job queue management API for encoding jobs.
 * Handles job lifecycle from creation through completion/failure.
 * Includes Prisma database integration for job persistence.
 * Automatically cleans up stuck and timed-out jobs via JobCleanupService.
 * Runs background health check worker for just-in-time file validation.
 * Auto-heals failed jobs on container restart via AutoHealingService.
 * Background retry scheduler retries eligible failed jobs every 5 minutes.
 * Monitors and recovers orphaned jobs via StuckJobRecoveryWorker (defense-in-depth).
 * Cleans up orphaned .backup files via BackupCleanupWorker (LOW PRIORITY FIX #17).
 * Batch operations for bulk pause/resume/cancel via BatchOperationsService.
 * Webhook notifications for job events via WebhookNotificationService.
 */
@Module({
  imports: [
    CoreModule,
    EncodingModule,
    // forwardRef required: QueueModule ↔ LibrariesModule circular dependency
    // QueueProcessingService injects MediaAnalysisService from LibrariesModule
    // LibrariesService injects QueueService from QueueModule to create encoding jobs
    forwardRef(() => LibrariesModule),
    // forwardRef required: QueueModule ↔ NodesModule via shared cycle
    // QueueModule imports EncodingModule which imports NodesModule
    // NodesModule imports LibrariesModule which imports QueueModule
    forwardRef(() => NodesModule),
  ],
  controllers: [
    JobController,
    JobMetricsController,
    JobPreviewController,
    JobTransferController,
    QueueManagementController,
    BatchController,
  ],
  providers: [
    QueueService,
    FileFailureTrackingService,
    QueueJobCrudService,
    QueueJobStateService,
    JobMetricsService,
    JobBulkOperationsService,
    JobFileOperationsService,
    QueueDelegationService,
    QueueProcessingService,
    JobCleanupService,
    JobHistoryService,
    JobRouterService,
    FileTransferService,
    FileTransferWorker,
    HealthCheckWorker,
    AutoHealingService,
    RetrySchedulerService,
    StuckJobRecoveryWorker,
    BackupCleanupWorker,
    BatchOperationsService,
    WebhookNotificationService,
    PrismaService,
    JobRepository,
    LibraryRepository,
    NodeRepository,
    SettingsRepository,
  ],
  exports: [
    QueueService,
    FileFailureTrackingService,
    QueueJobCrudService,
    QueueJobStateService,
    QueueDelegationService,
    QueueProcessingService,
    JobHistoryService,
    JobRouterService,
    FileTransferService,
    BatchOperationsService,
    WebhookNotificationService,
  ],
})
export class QueueModule {}
