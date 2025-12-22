import { forwardRef, Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { EncodingModule } from '../encoding/encoding.module';
import { LibrariesModule } from '../libraries/libraries.module';
import { PrismaService } from '../prisma/prisma.service';
import { BackupCleanupWorker } from './backup-cleanup.worker';
import { BatchController } from './batch.controller';
import { HealthCheckWorker } from './health-check.worker';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';
import { AutoHealingService } from './services/auto-healing.service';
import { BatchOperationsService } from './services/batch-operations.service';
import { FileTransferService } from './services/file-transfer.service';
import { JobCleanupService } from './services/job-cleanup.service';
import { JobHistoryService } from './services/job-history.service';
import { JobRouterService } from './services/job-router.service';
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
    forwardRef(() => EncodingModule),
    forwardRef(() => LibrariesModule),
    forwardRef(() => {
      const { NodesModule } = require('../nodes/nodes.module');
      return NodesModule;
    }),
  ],
  controllers: [QueueController, BatchController],
  providers: [
    QueueService,
    JobCleanupService,
    JobHistoryService,
    JobRouterService,
    FileTransferService,
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
    JobHistoryService,
    JobRouterService,
    FileTransferService,
    BatchOperationsService,
    WebhookNotificationService,
  ],
})
export class QueueModule {}
