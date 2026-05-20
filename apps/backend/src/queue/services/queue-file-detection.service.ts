import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NodeRepository } from '../../common/repositories/node.repository';
import { normalizeCodec } from '../../common/utils/codec.util';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import { MediaAnalysisService } from '../../media/media-analysis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FileTransferService } from './file-transfer.service';
import { JobRouterService } from './job-router.service';
import { QueueJobCrudService } from './queue-job-crud.service';

/**
 * QueueFileDetectionService
 *
 * Handles file.detected events from FileWatcherService:
 * probes the file, decides ENCODE vs REMUX, creates the job, and triggers
 * file transfer when the target node has no shared storage.
 */
@Injectable()
export class QueueFileDetectionService {
  private readonly logger = new Logger(QueueFileDetectionService.name);

  constructor(
    private prisma: PrismaService,
    private readonly nodeRepository: NodeRepository,
    private mediaAnalysis: MediaAnalysisService,
    private ffmpegService: FfmpegService,
    private jobRouterService: JobRouterService,
    private fileTransferService: FileTransferService,
    private jobCrudService: QueueJobCrudService
  ) {}

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
      // PrismaService retained for atomic $transaction — not replaceable with repository
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

      const targetNode = await this.nodeRepository.findById(assignedNodeId);
      const sourceNode = await this.nodeRepository.findById(library.nodeId);

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
    } catch (error: unknown) {
      if (error instanceof BadRequestException && error.message.includes('already exists')) {
        this.logger.log(`Job already exists for ${payload.fileName}, skipping`);
      } else {
        this.logger.error(`Failed to create job for detected file ${payload.fileName}:`, error);
      }
    }
  }
}
