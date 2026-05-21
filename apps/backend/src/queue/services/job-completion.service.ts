import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Job, JobStage } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { NodeConfigService } from '../../core/services/node-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { CompleteJobDto } from '../dto/complete-job.dto';
import { JobMetricsService } from './job-metrics.service';
import { QueueJobCrudService } from './queue-job-crud.service';

@Injectable()
export class JobCompletionService {
  private readonly logger = new Logger(JobCompletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nodeConfig: NodeConfigService,
    private readonly httpService: HttpService,
    private readonly jobCrudService: QueueJobCrudService,
    private readonly jobMetricsService: JobMetricsService
  ) {}

  private proxyOptions(): { timeout: number; headers: Record<string, string> } {
    const nodeId = this.nodeConfig.getNodeId();
    return {
      timeout: 30000,
      headers: nodeId ? { 'x-node-id': nodeId } : {},
    };
  }

  async completeJob(
    id: string,
    completeJobDto: CompleteJobDto,
    callerNodeId?: string
  ): Promise<Job> {
    this.logger.log(`Completing job: ${id}`);

    await this.jobCrudService.validateJobOwnership(id, 'complete', callerNodeId);

    const mainApiUrl = this.nodeConfig.getMainApiUrl();
    if (mainApiUrl) {
      const url = `${mainApiUrl}/api/v1/queue/${id}/complete`;
      this.logger.debug(`🔍 MULTI-NODE: LINKED node proxying job completion to MAIN: ${url}`);
      try {
        const response = await firstValueFrom(
          this.httpService.post(url, completeJobDto, this.proxyOptions())
        );
        this.logger.debug(`✅ MULTI-NODE: Job completion successful for ${id}`);
        return response.data;
      } catch (error: unknown) {
        this.logger.error(`❌ MULTI-NODE: Failed to proxy job completion to MAIN:`, error);
        throw error;
      }
    }

    let job: Job;
    try {
      // PrismaService retained for atomic $transaction — not replaceable with repository
      job = await this.prisma.$transaction(async (tx) => {
        const existingJob = await tx.job.findUnique({
          where: { id },
          select: { stage: true },
        });

        if (!existingJob) {
          throw new NotFoundException(`Job with ID "${id}" not found`);
        }

        if (existingJob.stage === JobStage.COMPLETED) {
          this.logger.warn(`Job ${id} already completed - skipping to prevent double metrics`);
          return tx.job.findUnique({
            where: { id },
            include: { node: true },
          }) as Promise<Job & { node: Record<string, unknown> }>;
        }

        const completedJob = await tx.job.update({
          where: { id },
          data: {
            stage: JobStage.COMPLETED,
            progress: 100,
            afterSizeBytes: BigInt(completeJobDto.afterSizeBytes),
            savedBytes: BigInt(completeJobDto.savedBytes),
            savedPercent: completeJobDto.savedPercent,
            completedAt: new Date(),
            priority: 0,
            prioritySetAt: null,
            ...(completeJobDto.qualityMetrics && { qualityMetrics: completeJobDto.qualityMetrics }),
          },
          include: { node: true },
        });

        await this.jobMetricsService.updateMetrics(completedJob, tx);

        if (completedJob.contentFingerprint) {
          await tx.processedFileRecord.upsert({
            where: { contentFingerprint: completedJob.contentFingerprint },
            create: {
              contentFingerprint: completedJob.contentFingerprint,
              filePath: completedJob.filePath,
              libraryId: completedJob.libraryId,
              completedAt: new Date(),
              resultCodec: completedJob.targetCodec,
              savedPercent: completeJobDto.savedPercent,
            },
            update: {
              filePath: completedJob.filePath,
              completedAt: new Date(),
              resultCodec: completedJob.targetCodec,
              savedPercent: completeJobDto.savedPercent,
            },
          });
        }

        return completedJob;
      });
    } catch (txError: unknown) {
      this.logger.error(`Transaction failed for job ${id}:`, txError);
      const errorMessage = txError instanceof Error ? txError.message : String(txError);
      throw new Error(`Failed to mark job as completed: ${errorMessage}`);
    }

    this.logger.log(`Job completed: ${id} (saved ${completeJobDto.savedPercent}%)`);
    return job;
  }
}
