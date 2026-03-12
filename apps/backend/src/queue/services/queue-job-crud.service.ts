import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type Job, JobStage, Prisma } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { normalizeCodec } from '../../common/utils/codec.util';
import { NodeConfigService } from '../../core/services/node-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateJobDto } from '../dto/create-job.dto';
import type { JobStatsDto } from '../dto/job-stats.dto';
import type { UpdateJobDto } from '../dto/update-job.dto';

/**
 * QueueJobCrudService
 *
 * Handles job CRUD operations, queries, and generic updates.
 */
@Injectable()
export class QueueJobCrudService {
  private readonly logger = new Logger(QueueJobCrudService.name);

  constructor(
    private prisma: PrismaService,
    private nodeConfig: NodeConfigService,
    private httpService: HttpService
  ) {}

  /**
   * Validate job ownership with optimistic locking support
   */
  async validateJobOwnership(
    jobId: string,
    operation: string
  ): Promise<{ nodeId: string | null; updatedAt: Date }> {
    const currentNodeId = this.nodeConfig.getNodeId();
    const isMainNode = this.nodeConfig.isMainNode();

    if (!currentNodeId) {
      const job = await this.prisma.job.findUnique({
        where: { id: jobId },
        select: { nodeId: true, updatedAt: true },
      });
      if (!job) throw new NotFoundException(`Job ${jobId} not found`);
      return job;
    }

    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { nodeId: true, fileLabel: true, updatedAt: true },
    });

    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    if (!isMainNode && job.nodeId && job.nodeId !== currentNodeId) {
      this.logger.error(
        `⚠️ HIGH #4: Cross-node ${operation} rejected: ` +
          `Node ${currentNodeId} attempted to modify job ${jobId} owned by ${job.nodeId} (${job.fileLabel})`
      );
      throw new ForbiddenException(
        `Node ${currentNodeId} cannot ${operation} job ${jobId} - job is assigned to node ${job.nodeId}`
      );
    }

    return { nodeId: job.nodeId, updatedAt: job.updatedAt };
  }

  /**
   * Validate file path to prevent directory traversal attacks
   */
  validateFilePath(filePath: string, libraryPath: string): void {
    const path = require('node:path');
    const fs = require('node:fs');

    if (
      filePath.includes('..') ||
      filePath.includes('%2e') ||
      filePath.includes('%2E') ||
      filePath.includes('\u2024')
    ) {
      throw new BadRequestException('File path contains directory traversal attempt');
    }

    const resolvedFile = path.resolve(filePath);
    const resolvedLibrary = path.resolve(libraryPath);

    try {
      const O_NOFOLLOW = 0o400000;
      const fd = fs.openSync(resolvedFile, fs.constants.O_RDONLY | O_NOFOLLOW);

      let realFile: string;
      try {
        realFile = fs.readlinkSync(`/proc/self/fd/${fd}`);
      } catch {
        realFile = resolvedFile;
      }

      fs.closeSync(fd);
      const realLibrary = fs.realpathSync(resolvedLibrary);

      if (!realFile.startsWith(realLibrary + path.sep)) {
        throw new BadRequestException(`File path '${filePath}' is outside library boundary`);
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ELOOP') {
        throw new BadRequestException('Symlink detected - operation rejected for security');
      }

      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        let currentPath = path.dirname(resolvedFile);
        let depth = 0;
        const maxDepth = 20;

        while (depth < maxDepth) {
          try {
            const realParent = fs.realpathSync(currentPath);
            const realLibrary = fs.realpathSync(resolvedLibrary);

            if (!realParent.startsWith(realLibrary + path.sep)) {
              throw new BadRequestException(`File path '${filePath}' is outside library boundary`);
            }

            return;
          } catch (parentErr) {
            if (parentErr && typeof parentErr === 'object' && 'code' in parentErr) {
              if (parentErr.code === 'ENOENT') {
                const nextParent = path.dirname(currentPath);
                if (nextParent === currentPath) {
                  throw new BadRequestException(
                    `File path '${filePath}' parent directories do not exist and cannot be validated`
                  );
                }
                currentPath = nextParent;
                depth++;
                continue;
              }
            }
            const message = parentErr instanceof Error ? parentErr.message : 'Unknown error';
            throw new BadRequestException(`Invalid file path: ${message}`);
          }
        }

        throw new BadRequestException(
          `File path '${filePath}' validation failed: too many missing parent directories (depth > ${maxDepth})`
        );
      } else {
        const message = err instanceof Error ? err.message : 'Unknown error';
        throw new BadRequestException(`Path validation error: ${message}`);
      }
    }
  }

  /**
   * Create a new encoding job
   */
  async create(createJobDto: CreateJobDto): Promise<Job> {
    this.logger.log(`Creating job for: ${createJobDto.fileLabel}`);

    const fileSizeBytes = BigInt(createJobDto.beforeSizeBytes);
    const maxFileSizeBytes = BigInt(500) * BigInt(1024) * BigInt(1024) * BigInt(1024);
    const minFileSizeBytes = BigInt(1024);

    if (fileSizeBytes > maxFileSizeBytes) {
      throw new BadRequestException(
        `File size ${fileSizeBytes} bytes exceeds maximum allowed size of ${maxFileSizeBytes} bytes (500 GB)`
      );
    }

    if (fileSizeBytes < minFileSizeBytes) {
      throw new BadRequestException(
        `File size ${fileSizeBytes} bytes is below minimum size of ${minFileSizeBytes} bytes (1 KB)`
      );
    }

    const mainApiUrl = this.nodeConfig.getMainApiUrl();
    if (mainApiUrl) {
      const url = `${mainApiUrl}/api/v1/queue`;
      this.logger.debug(`🔍 MULTI-NODE: LINKED node proxying job creation to MAIN: ${url}`);

      try {
        const response = await firstValueFrom(
          this.httpService.post(url, createJobDto, { timeout: 30000 })
        );
        this.logger.debug(`✅ MULTI-NODE: Job creation successful`);
        return response.data;
      } catch (error) {
        this.logger.error(`❌ MULTI-NODE: Failed to proxy job creation to MAIN:`, error);
        throw error;
      }
    }

    const [node, library, policy] = await Promise.all([
      this.prisma.node.findUnique({ where: { id: createJobDto.nodeId } }),
      this.prisma.library.findUnique({ where: { id: createJobDto.libraryId } }),
      this.prisma.policy.findUnique({ where: { id: createJobDto.policyId } }),
    ]);

    if (!node) {
      throw new NotFoundException(`Node with ID "${createJobDto.nodeId}" not found`);
    }

    if (!library) {
      throw new NotFoundException(`Library with ID "${createJobDto.libraryId}" not found`);
    }

    if (!policy) {
      throw new NotFoundException(`Policy with ID "${createJobDto.policyId}" not found`);
    }

    this.validateFilePath(createJobDto.filePath, library.path);

    const existingActiveJob = await this.prisma.job.findFirst({
      where: {
        filePath: createJobDto.filePath,
        stage: {
          in: [
            JobStage.DETECTED,
            JobStage.HEALTH_CHECK,
            JobStage.QUEUED,
            JobStage.ENCODING,
            JobStage.VERIFYING,
            JobStage.COMPLETED,
          ],
        },
      },
    });

    if (existingActiveJob) {
      this.logger.log(
        `Job already exists for file: ${createJobDto.filePath} (stage: ${existingActiveJob.stage}, id: ${existingActiveJob.id})`
      );
      throw new BadRequestException(
        `Job already exists for this file (stage: ${existingActiveJob.stage}). Cannot create duplicate.`
      );
    }

    const oldJobs = await this.prisma.job.findMany({
      where: {
        filePath: createJobDto.filePath,
        stage: {
          in: [JobStage.FAILED, JobStage.CANCELLED],
        },
      },
    });

    if (oldJobs.length > 0) {
      this.logger.log(
        `Deleting ${oldJobs.length} old job(s) for file: ${createJobDto.filePath} (stages: ${oldJobs.map((j) => j.stage).join(', ')})`
      );
      await this.prisma.job.deleteMany({
        where: {
          id: {
            in: oldJobs.map((j) => j.id),
          },
        },
      });
    }

    try {
      const job = await this.prisma.job.create({
        data: {
          filePath: createJobDto.filePath,
          fileLabel: createJobDto.fileLabel,
          sourceCodec: createJobDto.sourceCodec,
          targetCodec: createJobDto.targetCodec,
          beforeSizeBytes: BigInt(createJobDto.beforeSizeBytes),
          stage: JobStage.DETECTED,
          nodeId: createJobDto.nodeId,
          libraryId: createJobDto.libraryId,
          policyId: createJobDto.policyId,
          warning: createJobDto.warning,
          resourceThrottled: createJobDto.resourceThrottled ?? false,
          resourceThrottleReason: createJobDto.resourceThrottleReason,
          ffmpegThreads: createJobDto.ffmpegThreads,
          type: createJobDto.type || 'ENCODE',
          sourceContainer: createJobDto.sourceContainer,
          targetContainer: createJobDto.targetContainer,
        },
      });

      this.logger.log(`Job created: ${job.id} (${job.fileLabel})`);
      return job;
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002' &&
        'meta' in error &&
        error.meta &&
        typeof error.meta === 'object' &&
        'target' in error.meta &&
        Array.isArray(error.meta.target) &&
        error.meta.target.includes('unique_active_job_per_file')
      ) {
        const existingJob = await this.prisma.job.findFirst({
          where: {
            filePath: createJobDto.filePath,
            libraryId: createJobDto.libraryId,
            stage: {
              notIn: [JobStage.COMPLETED, JobStage.FAILED, JobStage.CANCELLED],
            },
          },
        });

        if (existingJob) {
          this.logger.log(
            `Job already exists for file: ${createJobDto.filePath} (stage: ${existingJob.stage}, id: ${existingJob.id})`
          );
          throw new BadRequestException(
            `Job already exists for this file (stage: ${existingJob.stage}). Cannot create duplicate.`
          );
        }
      }

      this.logger.error('Failed to create job', error);
      throw error;
    }
  }

  /**
   * Get all jobs with optional filtering
   */
  async findAll(
    stage?: JobStage,
    nodeId?: string,
    search?: string,
    libraryId?: string,
    page?: number,
    limit?: number
  ): Promise<{ jobs: Job[]; total: number; page: number; limit: number; totalPages: number }> {
    const currentPage = page && page > 0 ? page : 1;
    const pageSize = limit && limit > 0 ? limit : 20;
    const skip = (currentPage - 1) * pageSize;

    this.logger.log(
      `Fetching jobs (stage: ${stage || 'all'}, node: ${nodeId || 'all'}, library: ${libraryId || 'all'}, search: ${search || 'none'}, page: ${currentPage}, limit: ${pageSize})`
    );

    const where: Record<string, unknown> = {};
    if (stage) {
      where.stage = stage;
    }
    if (nodeId) {
      where.nodeId = nodeId;
    }
    if (libraryId) {
      where.libraryId = libraryId;
    }
    if (search) {
      where.OR = [{ filePath: { contains: search } }, { fileLabel: { contains: search } }];
    }

    const includeClause = {
      node: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
      library: {
        select: {
          id: true,
          name: true,
          mediaType: true,
        },
      },
      policy: {
        select: {
          id: true,
          name: true,
          preset: true,
        },
      },
    };

    const orderByClause =
      stage === 'FAILED' ? { failedAt: 'desc' as const } : { createdAt: 'asc' as const };

    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        include: includeClause,
        orderBy: orderByClause,
        skip,
        take: pageSize,
      }),
      this.prisma.job.count({ where }),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    return {
      jobs,
      total,
      page: currentPage,
      limit: pageSize,
      totalPages,
    };
  }

  /**
   * Get a single job by ID
   */
  async findOne(id: string): Promise<Job> {
    this.logger.log(`Fetching job: ${id}`);

    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        node: {
          select: {
            id: true,
            name: true,
            status: true,
            acceleration: true,
          },
        },
        library: {
          select: {
            id: true,
            name: true,
            path: true,
            mediaType: true,
          },
        },
        policy: {
          select: {
            id: true,
            name: true,
            preset: true,
            targetCodec: true,
            targetQuality: true,
            advancedSettings: true,
          },
        },
      },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    return job;
  }

  /**
   * Get job status for pause/cancel checks
   */
  async getJobStatus(jobId: string): Promise<{
    pauseRequestedAt: Date | null;
    pauseProcessedAt: Date | null;
    cancelRequestedAt: Date | null;
    cancelProcessedAt: Date | null;
  } | null> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        pauseRequestedAt: true,
        pauseProcessedAt: true,
        cancelRequestedAt: true,
        cancelProcessedAt: true,
      },
    });

    return job;
  }

  /**
   * Raw job update for internal system operations
   */
  async updateJobRaw(jobId: string, data: Record<string, any>): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data,
    });
  }

  /**
   * Update job progress
   */
  async updateProgress(id: string, updateJobDto: UpdateJobDto): Promise<Job> {
    this.logger.debug(`Updating progress for job: ${id}`);

    if (!this.nodeConfig.getMainApiUrl()) {
      await this.validateJobOwnership(id, 'update progress');
    }

    const mainApiUrl = this.nodeConfig.getMainApiUrl();
    if (mainApiUrl) {
      const url = `${mainApiUrl}/api/v1/queue/${id}`;
      this.logger.debug(`🔍 MULTI-NODE: LINKED node proxying progress update to MAIN: ${url}`);

      try {
        const response = await firstValueFrom(
          this.httpService.patch(url, updateJobDto, {
            timeout: 30000,
          })
        );

        this.logger.debug(`✅ MULTI-NODE: Progress update successful for ${id}`);
        return response.data;
      } catch (error) {
        this.logger.error(`❌ MULTI-NODE: Failed to proxy progress update to MAIN:`, error);
        if (error instanceof Error) {
          this.logger.error(`❌ MULTI-NODE: Error: ${error.message}`);
        }
        throw error;
      }
    }

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (updateJobDto.progress !== undefined) {
      if (updateJobDto.progress < 0 || updateJobDto.progress > 100) {
        throw new BadRequestException('Progress must be between 0 and 100');
      }
    }

    if (updateJobDto.etaSeconds !== undefined && updateJobDto.etaSeconds < 0) {
      throw new BadRequestException('ETA cannot be negative');
    }

    if (updateJobDto.stage === JobStage.HEALTH_CHECK) {
      throw new BadRequestException(
        'Cannot manually set HEALTH_CHECK stage. This is an internal stage managed by the health check worker. ' +
          'To prioritize a job, use the force-start endpoint instead.'
      );
    }

    try {
      const updateData: Record<string, unknown> = { ...updateJobDto };

      if (updateJobDto.resumeTimestamp) {
        updateData.resumeTimestamp = updateJobDto.resumeTimestamp;
        updateData.lastProgressUpdate = new Date();
      }
      if (updateJobDto.tempFilePath) {
        const fs = await import('fs');
        if (fs.existsSync(updateJobDto.tempFilePath)) {
          updateData.tempFilePath = updateJobDto.tempFilePath;
        } else {
          this.logger.warn(
            `Temp file not found: ${updateJobDto.tempFilePath}, ignoring resume state`
          );
        }
      }

      if (existingJob.stage === 'ENCODING') {
        updateData.lastHeartbeat = new Date();
        updateData.heartbeatNodeId = existingJob.nodeId;
      }

      const job = await this.prisma.job.update({
        where: { id },
        data: updateData,
      });

      this.logger.debug(`Job ${id} progress updated: ${job.progress}%`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to update job progress: ${id}`, error);
      throw error;
    }
  }

  /**
   * Update job preview image paths
   */
  async updateJobPreview(id: string, previewPaths: string[]): Promise<Job> {
    this.logger.debug(`Updating preview paths for job: ${id}`);

    try {
      const job = await this.prisma.job.update({
        where: { id },
        data: {
          previewImagePaths: JSON.stringify(previewPaths),
        },
      });

      this.logger.debug(`Job ${id} preview paths updated: ${previewPaths.length} images`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to update job preview paths: ${id}`, error);
      throw error;
    }
  }

  /**
   * Update a job with arbitrary data
   */
  async update(id: string, data: Prisma.JobUpdateInput): Promise<Job> {
    const mainApiUrl = this.nodeConfig.getMainApiUrl();
    if (mainApiUrl) {
      const url = `${mainApiUrl}/api/v1/queue/${id}`;
      this.logger.log(`🔍 MULTI-NODE: LINKED node proxying job update to MAIN: ${url}`);

      try {
        const response = await firstValueFrom(
          this.httpService.patch(url, data, {
            timeout: 30000,
          })
        );

        this.logger.log(`✅ MULTI-NODE: Job update successful for ${id}`);
        return response.data;
      } catch (error) {
        this.logger.error(`❌ MULTI-NODE: Failed to proxy job update to MAIN:`, error);
        if (error instanceof Error) {
          this.logger.error(`❌ MULTI-NODE: Error: ${error.message}`);
        }
        throw error;
      }
    }

    const ownership = await this.validateJobOwnership(id, 'update');

    const updateData = { ...data };
    if (data.stage !== undefined) {
      updateData.lastStageChangeAt = new Date();
    }

    const result = await this.prisma.job.updateMany({
      where: {
        id,
        updatedAt: ownership.updatedAt,
      },
      data: updateData,
    });

    if (result.count === 0) {
      throw new ConflictException(`Job ${id} was modified by another process - update failed`);
    }

    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException(`Job ${id} not found after update`);
    return job;
  }

  /**
   * Delete a job
   */
  async remove(id: string): Promise<void> {
    this.logger.log(`Deleting job: ${id}`);

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    try {
      await this.prisma.job.delete({
        where: { id },
      });

      this.logger.log(`Job deleted: ${id}`);
    } catch (error) {
      this.logger.error(`Failed to delete job: ${id}`, error);
      throw error;
    }
  }

  /**
   * Clear all jobs or jobs matching specific statuses
   */
  async clearJobs(stages?: JobStage[]): Promise<number> {
    const where = stages && stages.length > 0 ? { stage: { in: stages } } : {};

    const logMessage =
      stages && stages.length > 0
        ? `Clearing jobs with stages: ${stages.join(', ')}`
        : 'Clearing ALL jobs';

    this.logger.warn(logMessage);

    try {
      const result = await this.prisma.job.deleteMany({
        where,
      });

      this.logger.warn(`Deleted ${result.count} job(s)`);
      return result.count;
    } catch (error) {
      this.logger.error('Failed to clear jobs', error);
      throw error;
    }
  }

  /**
   * Get job statistics
   */
  async getJobStats(nodeId?: string): Promise<JobStatsDto> {
    this.logger.log(`Fetching job stats (node: ${nodeId || 'all'})`);

    const where = nodeId ? { nodeId } : {};

    const [
      detected,
      healthCheck,
      needsDecision,
      needsDecisionJobs,
      queued,
      transferring,
      encoding,
      verifying,
      completed,
      failed,
      cancelled,
      totalSaved,
    ] = await Promise.all([
      this.prisma.job.count({
        where: { ...where, stage: JobStage.DETECTED },
      }),
      this.prisma.job.count({
        where: { ...where, stage: JobStage.HEALTH_CHECK },
      }),
      this.prisma.job.count({
        where: { ...where, stage: JobStage.NEEDS_DECISION },
      }),
      this.prisma.job.findMany({
        where: {
          ...where,
          stage: JobStage.NEEDS_DECISION,
        },
        select: {
          sourceCodec: true,
          targetCodec: true,
        },
      }),
      this.prisma.job.count({
        where: { ...where, stage: JobStage.QUEUED },
      }),
      this.prisma.job.count({
        where: { ...where, stage: JobStage.TRANSFERRING },
      }),
      this.prisma.job.count({
        where: { ...where, stage: JobStage.ENCODING },
      }),
      this.prisma.job.count({
        where: { ...where, stage: JobStage.VERIFYING },
      }),
      this.prisma.job.count({
        where: { ...where, stage: JobStage.COMPLETED },
      }),
      this.prisma.job.count({
        where: { ...where, stage: JobStage.FAILED },
      }),
      this.prisma.job.count({
        where: { ...where, stage: JobStage.CANCELLED },
      }),
      this.prisma.job.aggregate({
        where: { ...where, stage: JobStage.COMPLETED },
        _sum: { savedBytes: true },
      }),
    ]);

    const codecMatchCount = needsDecisionJobs.filter((job) => {
      const normalizedSource = normalizeCodec(job.sourceCodec);
      const normalizedTarget = normalizeCodec(job.targetCodec);
      return normalizedSource === normalizedTarget;
    }).length;

    return {
      detected,
      healthCheck,
      needsDecision,
      codecMatchCount,
      queued,
      transferring,
      encoding,
      verifying,
      completed,
      failed,
      cancelled,
      totalSavedBytes: (totalSaved._sum.savedBytes || BigInt(0)).toString(),
      nodeId,
    };
  }
}
