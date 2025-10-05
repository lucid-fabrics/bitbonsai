import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
 */
@Module({
  controllers: [QueueController],
  providers: [QueueService, JobCleanupService, PrismaService],
  exports: [QueueService],
})
export class QueueModule {}
