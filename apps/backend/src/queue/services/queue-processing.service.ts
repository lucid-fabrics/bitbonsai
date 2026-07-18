import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Job, JobStage } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { NodeRepository } from '../../common/repositories/node.repository';
import { NodeConfigService } from '../../core/services/node-config.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * QueueProcessingService
 *
 * Core getNextJob logic: advisory lock, optimistic claim, concurrent limit check,
 * and proxy forwarding for LINKED nodes.
 *
 * Startup self-healing → QueueStartupHealingService
 * File detection handling → QueueFileDetectionService
 */
@Injectable()
export class QueueProcessingService {
  private readonly logger = new Logger(QueueProcessingService.name);

  constructor(
    private prisma: PrismaService,
    private readonly nodeRepository: NodeRepository,
    private nodeConfig: NodeConfigService,
    private httpService: HttpService
  ) {}

  /**
   * Get next available job for a node
   */
  async getNextJob(nodeId: string): Promise<Job | null> {
    this.logger.log(`🔍 MULTI-NODE: Getting next job for node: ${nodeId}`);

    const mainApiUrl = this.nodeConfig.getMainApiUrl();
    if (mainApiUrl) {
      const url = `${mainApiUrl}/api/v1/queue/next/${nodeId}`;
      this.logger.log(`🔍 MULTI-NODE: LINKED node detected - proxying getNextJob to MAIN`);
      this.logger.log(`🔍 MULTI-NODE: Calling ${url}`);

      try {
        const response = await firstValueFrom(
          this.httpService.get(url, {
            timeout: 30000,
          })
        );

        if (response.data) {
          this.logger.log(
            `✅ MULTI-NODE: Received job from MAIN: ${response.data.id} (${response.data.fileLabel})`
          );
        } else {
          this.logger.debug(`🔍 MULTI-NODE: MAIN node returned null (no jobs available)`);
        }

        return response.data;
      } catch (error: unknown) {
        this.logger.error(`❌ MULTI-NODE: Failed to proxy getNextJob to MAIN node:`, error);
        if (error instanceof Error) {
          this.logger.error(`❌ MULTI-NODE: Error message: ${error.message}`);
          this.logger.error(`❌ MULTI-NODE: Error stack: ${error.stack}`);
        }
        this.logger.warn(
          `⚠️ MULTI-NODE: Falling back to local database query (this may not work on LINKED nodes)`
        );
      }
    }

    const node = await this.nodeRepository.findUnique<{
      id: string;
      name: string;
      ipAddress: string | null;
      hasSharedStorage: boolean;
      license: { maxConcurrentJobs: number };
      _count: { jobs: number };
    } | null>({
      where: { id: nodeId },
      include: {
        license: true,
        _count: {
          select: {
            jobs: {
              where: {
                stage: { in: [JobStage.ENCODING, JobStage.VERIFYING] },
              },
            },
          },
        },
      },
    });

    if (!node) {
      throw new NotFoundException(`Node with ID "${nodeId}" not found`);
    }

    if (node._count.jobs >= node.license.maxConcurrentJobs) {
      this.logger.log(
        `Node ${nodeId} at capacity (${node._count.jobs}/${node.license.maxConcurrentJobs})`
      );
      return null;
    }

    const maxAttempts = 5;
    let attempt = 0;
    const pendingTransfers: Array<{
      jobId: string;
      filePath: string;
      sourceNode: { id: string; name: string; ipAddress: string | null };
      targetNode: { id: string; name: string; ipAddress: string | null };
    }> = [];

    while (attempt < maxAttempts) {
      attempt++;

      // PrismaService retained for atomic $transaction - not replaceable with repository
      // Uses pg_advisory_xact_lock + optimistic claim (updateMany) to prevent double-claim
      const result = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${nodeId}))`;

          const job = await tx.job.findFirst({
            where: {
              nodeId,
              stage: JobStage.QUEUED,
              OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
            },
            orderBy: [{ priority: 'desc' }, { healthScore: 'desc' }, { createdAt: 'asc' }],
            include: {
              library: {
                select: {
                  nodeId: true,
                },
              },
            },
          });

          if (!job) {
            return null;
          }

          const sourceNodeId = job.library.nodeId;
          const needsTransfer =
            !node.hasSharedStorage &&
            sourceNodeId !== nodeId &&
            (job.transferRequired !== false || (job.transferProgress || 0) < 100);

          if (needsTransfer) {
            this.logger.log(
              `Job ${job.id} requires file transfer before encoding (node has no shared storage)`
            );

            await tx.job.update({
              where: { id: job.id },
              data: {
                transferRequired: true,
                stage: JobStage.DETECTED,
              },
            });

            const sourceNode = await tx.node.findUnique({
              where: { id: sourceNodeId },
            });

            if (sourceNode) {
              pendingTransfers.push({
                jobId: job.id,
                filePath: job.filePath,
                sourceNode,
                targetNode: node,
              });
            }

            return { claimFailed: true, needsTransfer: true };
          }

          if (job.pauseRequestedAt) {
            this.logger.debug(
              `Job ${job.id} has pause request (${job.pauseRequestedAt.toISOString()}), skipping`
            );
            return { claimFailed: true, pauseRequested: true };
          }

          if (job.cancelRequestedAt) {
            this.logger.debug(
              `Job ${job.id} has cancel request (${job.cancelRequestedAt.toISOString()}), skipping`
            );
            return { claimFailed: true, cancelRequested: true };
          }

          const updateResult = await tx.job.updateMany({
            where: {
              id: job.id,
              stage: JobStage.QUEUED,
              pauseRequestedAt: null,
              cancelRequestedAt: null,
              // Honor retry backoff: never claim a job whose nextRetryAt is
              // still in the future (mirrors the candidate query above)
              OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
            },
            data: {
              stage: JobStage.ENCODING,
              startedAt: new Date(),
            },
          });

          if (updateResult.count === 0) {
            this.logger.debug(
              `Job ${job.id} was claimed by another worker (attempt ${attempt}/${maxAttempts}), trying next job`
            );
            return { claimFailed: true, attemptedJobId: job.id };
          }

          const claimedJob = await tx.job.findUnique({
            where: { id: job.id },
            include: {
              policy: true,
              library: true,
            },
          });

          return { claimedJob };
        },
        {
          maxWait: 5000,
          timeout: 10000,
          isolationLevel: 'ReadCommitted',
        }
      );

      if (!result) {
        return null;
      }

      if (result.claimFailed) {
        const jitterMs = 10 + Math.random() * 40;
        await new Promise((resolve) => setTimeout(resolve, jitterMs));
        continue;
      }

      if (result.claimedJob) {
        this.logger.log(`Assigned job ${result.claimedJob.id} to node ${nodeId}`);
        return result.claimedJob;
      }

      this.logger.log(`No queued jobs available for node ${nodeId}`);
      return null;
    }

    this.logger.debug(`Failed to claim job after ${maxAttempts} attempts (high concurrency)`);
    return null;
  }
}
