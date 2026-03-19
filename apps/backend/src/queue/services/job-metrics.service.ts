import { Injectable, Logger } from '@nestjs/common';
import type { Job, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * JobMetricsService
 *
 * Handles job completion metrics: daily stats, node encoding speed, and
 * idempotency tracking to prevent double-counting.
 * Extracted from QueueJobStateService to separate metrics concerns.
 */
@Injectable()
export class JobMetricsService {
  private readonly logger = new Logger(JobMetricsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Update metrics after job completion.
   * Idempotent — skips if already processed for this job.
   *
   * @param job - Completed job with node relation
   * @param tx - Optional transaction client (used when called inside a transaction)
   */
  async updateMetrics(
    job: Job & { node?: { licenseId: string } },
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    if (!job.node?.licenseId) {
      this.logger.warn(
        `Cannot update metrics for job ${job.id}: missing node relation or licenseId`
      );
      return;
    }

    const prisma = tx || this.prisma;

    const alreadyProcessed = await prisma.metricsProcessedJob.findUnique({
      where: { jobId: job.id },
    });

    if (alreadyProcessed) {
      this.logger.debug(
        `Metrics already processed for job ${job.id} at ${alreadyProcessed.processedAt}, skipping to prevent double-count`
      );
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      await prisma.metric.upsert({
        where: {
          date_nodeId_licenseId: {
            date: today,
            nodeId: job.nodeId,
            licenseId: job.node.licenseId,
          },
        },
        create: {
          date: today,
          nodeId: job.nodeId,
          licenseId: job.node.licenseId,
          jobsCompleted: 1,
          totalSavedBytes: job.savedBytes || BigInt(0),
          avgThroughputFilesPerHour: 0,
          codecDistribution: {},
        },
        update: {
          jobsCompleted: { increment: 1 },
          totalSavedBytes: { increment: job.savedBytes || BigInt(0) },
        },
      });

      if (job.fps && job.fps > 0) {
        const currentNode = await prisma.node.findUnique({
          where: { id: job.nodeId },
          select: { avgEncodingSpeed: true },
        });

        if (currentNode) {
          const alpha = 0.3;
          const newSpeed = currentNode.avgEncodingSpeed
            ? currentNode.avgEncodingSpeed * (1 - alpha) + job.fps * alpha
            : job.fps;

          await prisma.node.update({
            where: { id: job.nodeId },
            data: { avgEncodingSpeed: newSpeed },
          });

          this.logger.debug(
            `Updated node ${job.nodeId} avgEncodingSpeed: ${currentNode.avgEncodingSpeed?.toFixed(2)} → ${newSpeed.toFixed(2)} FPS`
          );
        }
      }

      await prisma.metricsProcessedJob.create({
        data: { jobId: job.id },
      });

      this.logger.log(`Metrics updated for job: ${job.id}`);
    } catch (error: unknown) {
      this.logger.error(`Failed to update metrics for job: ${job.id}`, error);
      if (tx) {
        throw error;
      }
    }
  }
}
