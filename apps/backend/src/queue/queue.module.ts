import { forwardRef, Module } from '@nestjs/common';
import { FileFailureRecordRepository } from '../common/repositories/file-failure-record.repository';
import { JobRepository } from '../common/repositories/job.repository';
import { JobHistoryRepository } from '../common/repositories/job-history.repository';
import { LibraryRepository } from '../common/repositories/library.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import { SettingsRepository } from '../common/repositories/settings.repository';
import { CoreModule } from '../core/core.module';
import { EncodingModule } from '../encoding/encoding.module';
import { MediaModule } from '../media/media.module';
import { NodesModule } from '../nodes/nodes.module';
import { PolicyRepository } from '../policies/repositories/policy.repository';
import { PrismaService } from '../prisma/prisma.service';
import { BackupCleanupWorker } from './backup-cleanup.worker';
import { BatchController } from './batch.controller';
import { JobController } from './controllers/job.controller';
import { JobMetricsController } from './controllers/job-metrics.controller';
import { JobPreviewController } from './controllers/job-preview.controller';
import { JobTransferController } from './controllers/job-transfer.controller';
import { QueueManagementController } from './controllers/queue-management.controller';
import { FileTransferWorker } from './file-transfer.worker';
import { JobOwnershipGuard } from './guards/job-ownership.guard';
import { HealthCheckWorker } from './health-check.worker';
import { QueueService } from './queue.service';
import { AutoHealingService } from './services/auto-healing.service';
import { BatchOperationsService } from './services/batch-operations.service';
import { CircuitBreakerService } from './services/circuit-breaker.service';
import { CompletionOutboxService } from './services/completion-outbox.service';
import { FileFailureTrackingService } from './services/file-failure-tracking.service';
import { FileTransferService } from './services/file-transfer.service';
import { HealthCheckCodecAnalyzerService } from './services/health-check-codec-analyzer.service';
import { JobBulkOperationsService } from './services/job-bulk-operations.service';
import { JobCancellationService } from './services/job-cancellation.service';
import { JobCleanupService } from './services/job-cleanup.service';
import { JobCompletionService } from './services/job-completion.service';
import { JobCreationValidatorService } from './services/job-creation-validator.service';
import { JobDecisionService } from './services/job-decision.service';
import { JobEncodingControlService } from './services/job-encoding-control.service';
import { JobFailureService } from './services/job-failure.service';
import { JobFileOperationsService } from './services/job-file-operations.service';
import { JobHistoryService } from './services/job-history.service';
import { JobMetricsService } from './services/job-metrics.service';
import { JobQueueManipulationService } from './services/job-queue-manipulation.service';
import { JobRouterService } from './services/job-router.service';
import { OwnershipLeaseService } from './services/ownership-lease.service';
import { QueueDelegationService } from './services/queue-delegation.service';
import { QueueFileDetectionService } from './services/queue-file-detection.service';
import { QueueJobCrudService } from './services/queue-job-crud.service';
import { QueueJobOwnershipService } from './services/queue-job-ownership.service';
import { QueueJobStateService } from './services/queue-job-state.service';
import { QueueJobStatsService } from './services/queue-job-stats.service';
import { QueueProcessingService } from './services/queue-processing.service';
import { QueueStartupHealingService } from './services/queue-startup-healing.service';
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
  // forwardRef required on BOTH sides of the QueueModule ↔ EncodingModule
  // cycle: with a plain import, webpack's module evaluation order determines
  // whether EncodingModule is defined when this decorator runs, and that
  // order shifts with unrelated import changes (undefined imports[1] at boot).
  imports: [CoreModule, forwardRef(() => EncodingModule), MediaModule, NodesModule],
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
    JobCreationValidatorService,
    QueueJobCrudService,
    QueueJobOwnershipService,
    QueueJobStatsService,
    QueueJobStateService,
    JobCompletionService,
    JobFailureService,
    JobCancellationService,
    JobEncodingControlService,
    JobDecisionService,
    JobQueueManipulationService,
    JobMetricsService,
    JobBulkOperationsService,
    JobFileOperationsService,
    QueueDelegationService,
    QueueProcessingService,
    QueueStartupHealingService,
    QueueFileDetectionService,
    JobCleanupService,
    JobHistoryService,
    JobRouterService,
    FileTransferService,
    FileTransferWorker,
    HealthCheckWorker,
    HealthCheckCodecAnalyzerService,
    AutoHealingService,
    CompletionOutboxService,
    CircuitBreakerService,
    RetrySchedulerService,
    StuckJobRecoveryWorker,
    BackupCleanupWorker,
    BatchOperationsService,
    WebhookNotificationService,
    OwnershipLeaseService,
    JobOwnershipGuard,
    PrismaService,
    FileFailureRecordRepository,
    JobHistoryRepository,
    JobRepository,
    LibraryRepository,
    NodeRepository,
    PolicyRepository,
    SettingsRepository,
  ],
  exports: [
    QueueService,
    FileFailureTrackingService,
    QueueJobCrudService,
    QueueJobOwnershipService,
    QueueJobStateService,
    JobCompletionService,
    JobFailureService,
    JobCancellationService,
    JobEncodingControlService,
    JobDecisionService,
    JobQueueManipulationService,
    QueueDelegationService,
    QueueProcessingService,
    JobHistoryService,
    JobRouterService,
    FileTransferService,
    BatchOperationsService,
    WebhookNotificationService,
    CompletionOutboxService,
    CircuitBreakerService,
    OwnershipLeaseService,
  ],
})
export class QueueModule {}
