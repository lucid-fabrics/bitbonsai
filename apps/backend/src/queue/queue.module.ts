import { forwardRef, Module } from '@nestjs/common';
import { EncodingModule } from '../encoding/encoding.module';
import { PrismaService } from '../prisma/prisma.service';
import { HealthCheckWorker } from './health-check.worker';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';
import { JobCleanupService } from './services/job-cleanup.service';

/**
 * QueueModule
 *
 * Provides complete job queue management API for encoding jobs.
 * Handles job lifecycle from creation through completion/failure.
 * Includes Prisma database integration for job persistence.
 * Automatically cleans up stuck and timed-out jobs via JobCleanupService.
 * Runs background health check worker for just-in-time file validation.
 */
@Module({
  imports: [forwardRef(() => EncodingModule)],
  controllers: [QueueController],
  providers: [QueueService, JobCleanupService, HealthCheckWorker, PrismaService],
  exports: [QueueService],
})
export class QueueModule {}
