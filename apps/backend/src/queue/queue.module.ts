import { forwardRef, Module } from '@nestjs/common';
import { EncodingModule } from '../encoding/encoding.module';
import { LibrariesModule } from '../libraries/libraries.module';
import { PrismaService } from '../prisma/prisma.service';
import { BackupCleanupWorker } from './backup-cleanup.worker';
import { HealthCheckWorker } from './health-check.worker';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';
import { AutoHealingService } from './services/auto-healing.service';
import { JobCleanupService } from './services/job-cleanup.service';
import { JobHistoryService } from './services/job-history.service';
import { RetrySchedulerService } from './services/retry-scheduler.service';
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
 */
@Module({
  imports: [forwardRef(() => EncodingModule), forwardRef(() => LibrariesModule)],
  controllers: [QueueController],
  providers: [
    QueueService,
    JobCleanupService,
    JobHistoryService,
    HealthCheckWorker,
    AutoHealingService,
    RetrySchedulerService,
    StuckJobRecoveryWorker,
    BackupCleanupWorker,
    PrismaService,
  ],
  exports: [QueueService, JobHistoryService],
})
export class QueueModule {}
