import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type Job, JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { SharedStorageVerifierService } from '../../nodes/services/shared-storage-verifier.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FileTransferService } from './file-transfer.service';
import { JobRouterService } from './job-router.service';
import { QueueJobCrudService } from './queue-job-crud.service';
import { QueueJobStateService } from './queue-job-state.service';

/**
 * QueueDelegationService
 *
 * Handles multi-node job delegation, rebalancing, and stuck transfer cleanup.
 */
const MAX_TRANSFER_RETRIES = 3;

@Injectable()
export class QueueDelegationService {
  private readonly logger = new Logger(QueueDelegationService.name);

  constructor(
    private prisma: PrismaService,
    private jobRepository: JobRepository,
    private jobRouterService: JobRouterService,
    private fileTransferService: FileTransferService,
    private sharedStorageVerifier: SharedStorageVerifierService,
    private jobCrudService: QueueJobCrudService,
    private jobStateService: QueueJobStateService
  ) {}

  /**
   * Cleanup stuck file transfers
   *
   * Runs every 10 minutes to detect and recover from stuck file transfers.
   */
  @Cron('*/10 * * * *')
  async cleanupStuckTransfers(): Promise<void> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const stuckJobs = await this.jobRepository.findManyWithInclude<{
        id: string;
        fileLabel: string;
        transferRetryCount: number | null;
        transferProgress: number | null;
        transferStartedAt: Date | null;
      }>({
        where: {
          stage: 'TRANSFERRING',
          transferStartedAt: { lt: oneHourAgo },
          transferProgress: { lt: 100 },
        },
        select: {
          id: true,
          fileLabel: true,
          transferRetryCount: true,
          transferProgress: true,
          transferStartedAt: true,
        },
      });

      if (stuckJobs.length === 0) {
        return;
      }

      this.logger.warn(
        `🔧 CRITICAL #27 FIX: Found ${stuckJobs.length} stuck transfer(s) - attempting recovery`
      );

      for (const job of stuckJobs) {
        const retryCount = job.transferRetryCount || 0;
        const stuckDuration = Math.floor(
          (Date.now() - new Date(job.transferStartedAt || 0).getTime()) / (60 * 1000)
        );

        if (retryCount >= MAX_TRANSFER_RETRIES) {
          this.logger.error(
            `  ✗ Job ${job.fileLabel}: Transfer failed after ${retryCount} retries (stuck ${stuckDuration}min)`
          );

          await this.jobStateService.failJob(
            job.id,
            `File transfer stuck for over ${stuckDuration} minutes after ${retryCount} retry attempts. ` +
              `Progress: ${job.transferProgress}%. Manual intervention required.`
          );
        } else {
          this.logger.warn(
            `  ⟳ Job ${job.fileLabel}: Resetting stuck transfer for retry ${retryCount + 1}/${MAX_TRANSFER_RETRIES} (stuck ${stuckDuration}min, progress ${job.transferProgress}%)`
          );

          await this.jobCrudService.update(job.id, {
            stage: JobStage.DETECTED,
            transferError: `Transfer timeout after ${stuckDuration} minutes - retry ${retryCount + 1}/${MAX_TRANSFER_RETRIES}`,
            transferRetryCount: retryCount + 1,
            transferProgress: 0,
            transferStartedAt: null,
          });
        }
      }

      this.logger.log(
        `✅ CRITICAL #27 FIX: Stuck transfer cleanup complete - processed ${stuckJobs.length} job(s)`
      );
    } catch (error: unknown) {
      this.logger.error('CRITICAL #27 FIX: Failed to cleanup stuck transfers:', error);
    }
  }

  /**
   * Manually delegate a job to a specific node
   */
  async delegateJob(jobId: string, targetNodeId: string): Promise<Job> {
    // PrismaService retained for atomic $transaction — not replaceable with repository
    return await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({
        where: { id: jobId },
        include: {
          library: {
            select: {
              nodeId: true,
            },
          },
        },
      });

      if (!job) {
        throw new NotFoundException(`Job ${jobId} not found`);
      }

      if (job.nodeId === targetNodeId) {
        throw new BadRequestException(
          `Job is already assigned to this node. Please select a different node.`
        );
      }

      const allowedStages = ['QUEUED', 'PAUSED', 'FAILED', 'ENCODING'];
      if (!allowedStages.includes(job.stage)) {
        throw new BadRequestException(
          `Cannot delegate job in ${job.stage} stage. Only QUEUED, PAUSED, FAILED, or ENCODING jobs can be delegated.`
        );
      }

      if (job.stage === 'ENCODING') {
        this.logger.log(`Pausing ENCODING job ${jobId} before delegation to node ${targetNodeId}`);
      }

      const targetNode = await tx.node.findUnique({
        where: { id: targetNodeId },
      });

      if (!targetNode) {
        throw new NotFoundException(`Target node ${targetNodeId} not found`);
      }

      if (targetNode.status !== 'ONLINE') {
        throw new BadRequestException('Selected node is not available for job assignment');
      }

      this.logger.log(
        `Manually delegating job ${jobId} from node ${job.nodeId} to node ${targetNodeId}`
      );

      const sourceNodeId = job.library.nodeId;
      const sourceNode = await tx.node.findUnique({ where: { id: sourceNodeId } });

      if (!sourceNode) {
        throw new NotFoundException(`Source node ${sourceNodeId} not found`);
      }

      let needsTransfer = false;
      let translatedPath: string | null = null;

      if (sourceNodeId !== targetNodeId && targetNode.hasSharedStorage) {
        this.logger.log(
          `Verifying shared storage access for job ${jobId} on target node ${targetNode.name}...`
        );

        const verification = await this.sharedStorageVerifier.verifyFileAccess(
          job.filePath,
          targetNode,
          sourceNode
        );

        if (verification.isAccessible && verification.translatedPath) {
          this.logger.log(`✅ File accessible via shared storage: ${verification.translatedPath}`);
          needsTransfer = false;
          translatedPath = verification.translatedPath;
        } else {
          this.logger.warn(
            `⚠️  Shared storage verification failed: ${verification.error}. Will use file transfer instead.`
          );
          needsTransfer = true;
        }
      } else if (sourceNodeId !== targetNodeId) {
        this.logger.log(`Target node has no shared storage configured, will use file transfer`);
        needsTransfer = true;
      }

      let targetStage: JobStage = job.stage;
      if (job.stage === 'FAILED') {
        targetStage = 'QUEUED';
      } else if (job.stage === 'ENCODING') {
        targetStage = 'PAUSED';
      }

      const updateData: Record<string, unknown> = {
        nodeId: targetNodeId,
        stage: targetStage,
        manualAssignment: true,
        originalNodeId: job.originalNodeId || job.nodeId,
        transferRequired: needsTransfer,
        transferProgress: needsTransfer ? 0 : job.transferProgress,
        transferError: null,
        error: job.stage === 'FAILED' ? null : job.error,
        retryCount: job.stage === 'FAILED' ? 0 : job.retryCount,
      };

      if (!needsTransfer && translatedPath && translatedPath !== job.filePath) {
        this.logger.log(`Translating path: ${job.filePath} -> ${translatedPath}`);
        updateData.filePath = translatedPath;
        if (!job.originalFilePath) {
          updateData.originalFilePath = job.filePath;
        }
      }

      const updateResult = await tx.job.updateMany({
        where: {
          id: jobId,
          stage: { in: ['QUEUED', 'PAUSED', 'FAILED', 'ENCODING'] },
        },
        data: updateData,
      });

      if (updateResult.count === 0) {
        throw new BadRequestException(
          'Job stage changed during delegation. Please retry the operation.'
        );
      }

      if (needsTransfer) {
        const sourceNode = await tx.node.findUnique({
          where: { id: sourceNodeId },
        });

        if (sourceNode) {
          this.logger.log(
            `Job ${jobId} requires file transfer: ${sourceNode.name} -> ${targetNode.name}`
          );

          setImmediate(() => {
            this.fileTransferService
              .transferFile(jobId, job.filePath, sourceNode, targetNode)
              .catch((error) => {
                this.logger.error(`Background file transfer failed for job ${jobId}:`, error);
              });
          });
        }
      }

      const updatedJob = await tx.job.findUnique({
        where: { id: jobId },
      });

      this.logger.log(
        `Job ${jobId} successfully delegated to node ${targetNodeId}${needsTransfer ? ' (file transfer initiated)' : ''}`
      );

      return updatedJob!;
    });
  }

  /**
   * Rebalance queued jobs across nodes
   */
  async rebalanceJobs(): Promise<number> {
    return this.jobRouterService.rebalanceJobs();
  }

  /**
   * Fix stuck transfers
   */
  async fixStuckTransfers(): Promise<number> {
    this.logger.log('🔧 Fixing stuck transfers...');

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const stuckJobs = await this.jobRepository.findManyWithInclude<{
      id: string;
      fileLabel: string;
      nodeId: string | null;
      node: { name: string; hasSharedStorage: boolean } | null;
    }>({
      where: {
        stage: 'TRANSFERRING',
        transferProgress: 0,
        OR: [{ transferStartedAt: { lt: fiveMinutesAgo } }, { transferStartedAt: null }],
      },
      select: {
        id: true,
        fileLabel: true,
        nodeId: true,
        node: {
          select: {
            name: true,
            hasSharedStorage: true,
          },
        },
      },
    });

    if (stuckJobs.length === 0) {
      this.logger.log('No stuck transfers found');
      return 0;
    }

    this.logger.log(`Found ${stuckJobs.length} stuck transfer(s)`);

    for (const job of stuckJobs) {
      this.logger.log(
        `Resetting stuck transfer: ${job.fileLabel} (node: ${job.node?.name}, hasSharedStorage: ${job.node?.hasSharedStorage})`
      );

      await this.jobRepository.updateById(job.id, {
        stage: 'QUEUED',
        transferProgress: 0,
        transferError: null,
        transferStartedAt: null,
        transferCompletedAt: null,
        transferSpeedMBps: null,
        transferRequired: !job.node?.hasSharedStorage,
      });
    }

    this.logger.log(`✅ Fixed ${stuckJobs.length} stuck transfer(s)`);

    return stuckJobs.length;
  }
}
