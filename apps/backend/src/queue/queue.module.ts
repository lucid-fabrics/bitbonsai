import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';

/**
 * QueueModule
 *
 * Provides complete job queue management API for encoding jobs.
 * Handles job lifecycle from creation through completion/failure.
 * Includes Prisma database integration for job persistence.
 */
@Module({
  controllers: [QueueController],
  providers: [QueueService, PrismaService],
  exports: [QueueService],
})
export class QueueModule {}
