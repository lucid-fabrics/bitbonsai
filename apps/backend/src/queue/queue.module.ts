import { forwardRef, Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { EncodingModule } from '../encoding/encoding.module';
import { LibrariesModule } from '../libraries/libraries.module';
import { NodesModule } from '../nodes/nodes.module';
import { PrismaService } from '../prisma/prisma.service';
import { BackupCleanupWorker } from './backup-cleanup.worker';
import { BatchController } from './batch.controller';
import { FileTransferWorker } from './file-transfer.worker';
import { HealthCheckWorker } from './health-check.worker';
import { QueueController } from './queue.controller';
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
    forwardRef(() => LibrariesModule),
    forwardRef(() => NodesModule),
  ],
  controllers: [QueueController, BatchController],
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
