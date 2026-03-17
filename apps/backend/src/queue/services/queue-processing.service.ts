import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { type Job, JobStage } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { normalizeCodec } from '../../common/utils/codec.util';
import { NodeConfigService } from '../../core/services/node-config.service';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import { MediaAnalysisService } from '../../libraries/services/media-analysis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FileTransferService } from './file-transfer.service';
import { JobRouterService } from './job-router.service';
import { QueueJobCrudService } from './queue-job-crud.service';

/**
 * QueueProcessingService
 *
 * Handles job processing orchestration: getNextJob, file detection event handling,
 * startup self-healing, and orphaned job recovery.
 */
@Injectable()
export class QueueProcessingService implements OnModuleInit {
  private readonly logger = new Logger(QueueProcessingService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => MediaAnalysisService))
    private mediaAnalysis: MediaAnalysisService,
    @Inject(forwardRef(() => FfmpegService))
    private ffmpegService: FfmpegService,
    private jobRouterService: JobRouterService,
    private fileTransferService: FileTransferService,
    private nodeConfig: NodeConfigService,
    private httpService: HttpService,
    private jobCrudService: QueueJobCrudService
  ) {}

  /**
   * SELF-HEALING: Scan and heal orphaned jobs on startup
   */
  async onModuleInit(): Promise<void> {
    if (this.nodeConfig.getMainApiUrl()) {
      this.logger.debug('POLICY HEAL: Skipping startup scan (LINKED node)');
      return;
    }

    this.logger.log('POLICY HEAL: Starting orphaned job scan...');

    try {
      await this.healOrphanedJobs();
    } catch (error) {
      this.logger.error('POLICY HEAL: Failed to complete startup scan', error);
    }
  }

  /**
   * SELF-HEALING: Find and fix all jobs with orphaned or mismatched policies
   */
  private async healOrphanedJobs(): Promise<void> {
    const allPolicies = await this.prisma.policy.findMany();
    const policyMap = new Map(allPolicies.map((p) => [p.id, p]));

    if (allPolicies.length === 0) {
      this.logger.warn('POLICY HEAL: No policies exist - cannot heal orphaned jobs');
      return;
    }

    const jobsToCheck = await this.prisma.job.findMany({
      where: {
        stage: {
          in: [JobStage.QUEUED, JobStage.DETECTED, JobStage.PAUSED_LOAD],
        },
      },
      include: {
        library: {
          include: {
            defaultPolicy: true,
            policies: true,
          },
        },
      },
    });

    let healedCount = 0;
    let errorCount = 0;

    for (const job of jobsToCheck) {
      try {
        const currentPolicy = job.policyId ? policyMap.get(job.policyId) : null;

        if (currentPolicy && job.targetCodec === currentPolicy.targetCodec) {
          continue;
        }

        if (currentPolicy && job.targetCodec !== currentPolicy.targetCodec) {
          await this.prisma.job.update({
            where: { id: job.id },
            data: { targetCodec: currentPolicy.targetCodec },
          });
          this.logger.log(
            `POLICY HEAL: Fixed codec mismatch for job ${job.id} (${job.targetCodec} → ${currentPolicy.targetCodec})`
          );
          healedCount++;
          continue;
        }

        let newPolicy = null;

        if (job.library?.defaultPolicy && policyMap.has(job.library.defaultPolicy.id)) {
          newPolicy = job.library.defaultPolicy;
        } else if (job.library?.policies?.length) {
          newPolicy = job.library.policies.find((p) => policyMap.has(p.id));
        }
        if (!newPolicy) {
          newPolicy = allPolicies[0];
        }

        if (!newPolicy || !newPolicy.id) {
          this.logger.error(
            `POLICY HEAL FAILED: No valid policy found for job ${job.id}. ` +
              `Tried: library default, library policies, first available. ` +
              `Please create at least one policy and assign to library.`
          );
          errorCount++;
          continue;
        }

        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            policyId: newPolicy.id,
            targetCodec: newPolicy.targetCodec,
          },
        });
        this.logger.log(
          `POLICY HEAL: Assigned policy "${newPolicy.name}" to orphaned job ${job.id}`
        );
        healedCount++;
      } catch (error) {
        this.logger.error(`POLICY HEAL: Failed to heal job ${job.id}`, error);
        errorCount++;
      }
    }

    if (healedCount > 0 || errorCount > 0) {
      this.logger.log(
        `POLICY HEAL: Startup scan complete - healed: ${healedCount}, errors: ${errorCount}`
      );
    } else {
      this.logger.debug('POLICY HEAL: No orphaned jobs found');
    }
  }

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
      } catch (error) {
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

    const node = await this.prisma.node.findUnique({
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

          const updateResult = await tx.job.updateMany({
            where: {
              id: job.id,
              stage: JobStage.QUEUED,
              pauseRequestedAt: null,
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

  /**
   * Event handler for file.detected events from FileWatcherService
   */
  @OnEvent('file.detected')
  async handleFileDetected(payload: {
    libraryId: string;
    filePath: string;
    fileName: string;
  }): Promise<void> {
    this.logger.log(`Handling file.detected event for: ${payload.fileName}`);

    try {
      const library = await this.prisma.library.findUnique({
        where: { id: payload.libraryId },
        include: {
          defaultPolicy: true,
        },
      });

      if (!library) {
        this.logger.error(`Library ${payload.libraryId} not found, cannot create job`);
        return;
      }

      if (!library.defaultPolicyId || !library.defaultPolicy) {
        this.logger.warn(
          `Library ${library.name} has no default policy. Skipping job creation for ${payload.fileName}`
        );
        return;
      }

      const videoInfo = await this.mediaAnalysis.probeVideoFile(payload.filePath);

      if (!videoInfo) {
        this.logger.warn(`Failed to probe video file: ${payload.filePath}, skipping job creation`);
        return;
      }

      const detailedInfo = await this.ffmpegService.getVideoInfoCached(payload.filePath);
      const sourceCodec = normalizeCodec(detailedInfo.codec);
      const targetCodec = normalizeCodec(library.defaultPolicy.targetCodec);
      const sourceContainer = detailedInfo.container;
      const targetContainer = library.defaultPolicy.targetContainer || 'mkv';

      let jobType: 'ENCODE' | 'REMUX' = 'ENCODE';
      let decisionReason: string;

      if (sourceCodec === targetCodec) {
        if (library.defaultPolicy.skipReencoding) {
          if (sourceContainer === targetContainer) {
            this.logger.log(
              `File ${payload.fileName} already uses target codec ${targetCodec} and container ${targetContainer}, skipping`
            );
            return;
          } else {
            jobType = 'REMUX';
            decisionReason = `REMUX: ${sourceCodec} → ${targetCodec} (codec match, container: ${sourceContainer} → ${targetContainer})`;
            this.logger.log(`${decisionReason} for ${payload.fileName}`);
          }
        } else {
          jobType = 'ENCODE';
          decisionReason = `ENCODE: Policy requires re-encoding (skipReencoding=false)`;
          this.logger.log(`${decisionReason} for ${payload.fileName}`);
        }
      } else {
        jobType = 'ENCODE';
        decisionReason = `ENCODE: ${sourceCodec} → ${targetCodec} (codec change)`;
        this.logger.log(`${decisionReason} for ${payload.fileName}`);
      }

      let warning: string | undefined;
      let resourceThrottled = false;
      let resourceThrottleReason: string | undefined;
      let ffmpegThreads: number | undefined;

      if (videoInfo.codec.toLowerCase() === 'av1') {
        const durationHours = Math.max(videoInfo.duration / 3600, 0.0167);
        const estimatedHours = Math.round(durationHours * 150);

        warning =
          `⚠️ WARNING: AV1 → HEVC TRANSCODING\n\n` +
          `This is an extremely resource-intensive task:\n` +
          `• Expected encoding time: ${estimatedHours}+ hours (for ${Math.round(durationHours)}h video)\n` +
          `• CPU usage will be limited to 8 threads to prevent system instability\n` +
          `• Output file may be LARGER than source (AV1 is more efficient than HEVC)\n\n` +
          `⚠️ RECOMMENDATION: Skip this file or reconsider target codec`;

        resourceThrottled = true;
        resourceThrottleReason = 'AV1 source codec requires reduced CPU usage';
        ffmpegThreads = 8;

        this.logger.warn(
          `AV1 source detected for ${payload.fileName} - will throttle to ${ffmpegThreads} threads`
        );
      }

      const optimalNodeId = await this.jobRouterService.findBestNodeForJob(
        `pending-${payload.fileName}`,
        BigInt(videoInfo.sizeBytes)
      );

      const assignedNodeId = optimalNodeId || library.nodeId;

      if (!optimalNodeId) {
        this.logger.warn(
          `JobRouter could not find optimal node for ${payload.fileName}, falling back to library node`
        );
      }

      const targetNode = await this.prisma.node.findUnique({
        where: { id: assignedNodeId },
      });

      const sourceNode = await this.prisma.node.findUnique({
        where: { id: library.nodeId },
      });

      const transferRequired =
        targetNode && sourceNode && !targetNode.hasSharedStorage && targetNode.id !== sourceNode.id;

      const job = await this.jobCrudService.create({
        filePath: payload.filePath,
        fileLabel: payload.fileName,
        sourceCodec: videoInfo.codec,
        targetCodec: library.defaultPolicy.targetCodec,
        beforeSizeBytes: videoInfo.sizeBytes.toString(),
        nodeId: assignedNodeId,
        libraryId: library.id,
        policyId: library.defaultPolicyId,
        warning,
        resourceThrottled,
        resourceThrottleReason,
        ffmpegThreads,
        type: jobType,
        sourceContainer,
        targetContainer,
      });

      if (transferRequired && targetNode && sourceNode) {
        this.logger.log(
          `Transfer required for job ${job.id}: ${sourceNode.name} -> ${targetNode.name}`
        );

        this.fileTransferService
          .transferFile(job.id, payload.filePath, sourceNode, targetNode)
          .catch((error) => {
            this.logger.error(`Background file transfer failed for job ${job.id}:`, error);
          });
      }

      this.logger.log(`Successfully created job for detected file: ${payload.fileName}`);
    } catch (error) {
      if (error instanceof BadRequestException && error.message.includes('already exists')) {
        this.logger.log(`Job already exists for ${payload.fileName}, skipping`);
      } else {
        this.logger.error(`Failed to create job for detected file ${payload.fileName}:`, error);
      }
    }
  }
}
