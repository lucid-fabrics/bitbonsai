import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { type Job, JobStage } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { CreateJobDto } from './dto/create-job.dto';
import type { UpdateJobDto } from './dto/update-job.dto';
import type { CompleteJobDto } from './dto/complete-job.dto';
import type { JobStatsDto } from './dto/job-stats.dto';

/**
 * QueueService
 *
 * Handles job queue management and encoding job lifecycle.
 * Based on the Prisma integration example (lines 239-446).
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create a new encoding job
   *
   * @param createJobDto - Job creation data
   * @returns The created job in QUEUED stage
   * @throws NotFoundException if node, library, or policy does not exist
   */
  async create(createJobDto: CreateJobDto): Promise<Job> {
    this.logger.log(`Creating job for: ${createJobDto.fileLabel}`);

    // Validate that node exists
    const node = await this.prisma.node.findUnique({
      where: { id: createJobDto.nodeId },
    });
    if (!node) {
      throw new NotFoundException(`Node with ID "${createJobDto.nodeId}" not found`);
    }

    // Validate that library exists
    const library = await this.prisma.library.findUnique({
      where: { id: createJobDto.libraryId },
    });
    if (!library) {
      throw new NotFoundException(`Library with ID "${createJobDto.libraryId}" not found`);
    }

    // Validate that policy exists
    const policy = await this.prisma.policy.findUnique({
      where: { id: createJobDto.policyId },
    });
    if (!policy) {
      throw new NotFoundException(`Policy with ID "${createJobDto.policyId}" not found`);
    }

    try {
      const job = await this.prisma.job.create({
        data: {
          filePath: createJobDto.filePath,
          fileLabel: createJobDto.fileLabel,
          sourceCodec: createJobDto.sourceCodec,
          targetCodec: createJobDto.targetCodec,
          beforeSizeBytes: BigInt(createJobDto.beforeSizeBytes),
          stage: JobStage.QUEUED,
          nodeId: createJobDto.nodeId,
          libraryId: createJobDto.libraryId,
          policyId: createJobDto.policyId,
        },
      });

      this.logger.log(`Job created: ${job.id} (${job.fileLabel})`);
      return job;
    } catch (error) {
      this.logger.error('Failed to create job', error);
      throw error;
    }
  }

  /**
   * Get all jobs with optional filtering
   *
   * @param stage - Optional filter by job stage
   * @param nodeId - Optional filter by node ID
   * @returns Array of jobs matching the filters
   */
  async findAll(stage?: JobStage, nodeId?: string): Promise<Job[]> {
    this.logger.log(`Fetching jobs (stage: ${stage || 'all'}, node: ${nodeId || 'all'})`);

    const where: any = {};
    if (stage) {
      where.stage = stage;
    }
    if (nodeId) {
      where.nodeId = nodeId;
    }

    return this.prisma.job.findMany({
      where,
      include: {
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
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  /**
   * Get a single job by ID
   *
   * @param id - Job unique identifier
   * @returns Job with related node, library, and policy
   * @throws NotFoundException if job does not exist
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
   * Get next available job for a node
   *
   * This method:
   * 1. Checks if node exists
   * 2. Verifies node hasn't exceeded concurrent job limit
   * 3. Finds the oldest QUEUED job for the node
   * 4. Updates job to ENCODING stage and sets startedAt timestamp
   *
   * @param nodeId - Node unique identifier
   * @returns Next job to process, or null if none available or node at capacity
   * @throws NotFoundException if node does not exist
   */
  async getNextJob(nodeId: string): Promise<Job | null> {
    this.logger.log(`Getting next job for node: ${nodeId}`);

    // Get node with license info and current active job count
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

    // Check if node is at capacity
    if (node._count.jobs >= node.license.maxConcurrentJobs) {
      this.logger.log(
        `Node ${nodeId} at capacity (${node._count.jobs}/${node.license.maxConcurrentJobs})`
      );
      return null;
    }

    // Get next queued job for this node
    const job = await this.prisma.job.findFirst({
      where: {
        nodeId,
        stage: JobStage.QUEUED,
      },
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        policy: true,
        library: true,
      },
    });

    if (job) {
      // Update job to ENCODING stage
      const updatedJob = await this.prisma.job.update({
        where: { id: job.id },
        data: {
          stage: JobStage.ENCODING,
          startedAt: new Date(),
        },
        include: {
          policy: true,
          library: true,
        },
      });

      this.logger.log(`Assigned job ${job.id} to node ${nodeId}`);
      return updatedJob;
    }

    this.logger.log(`No queued jobs available for node ${nodeId}`);
    return null;
  }

  /**
   * Update job progress
   *
   * @param id - Job unique identifier
   * @param updateJobDto - Progress update data
   * @returns Updated job
   * @throws NotFoundException if job does not exist
   */
  async updateProgress(id: string, updateJobDto: UpdateJobDto): Promise<Job> {
    this.logger.log(`Updating progress for job: ${id}`);

    // Check if job exists
    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    try {
      const job = await this.prisma.job.update({
        where: { id },
        data: updateJobDto,
      });

      this.logger.log(`Job ${id} progress updated: ${job.progress}%`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to update job progress: ${id}`, error);
      throw error;
    }
  }

  /**
   * Complete a job successfully
   *
   * This method:
   * 1. Updates job to COMPLETED stage
   * 2. Sets final size and savings metrics
   * 3. Updates metrics for the node and license
   *
   * @param id - Job unique identifier
   * @param completeJobDto - Completion data with file sizes
   * @returns Completed job
   * @throws NotFoundException if job does not exist
   */
  async completeJob(id: string, completeJobDto: CompleteJobDto): Promise<Job> {
    this.logger.log(`Completing job: ${id}`);

    const job = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.COMPLETED,
        progress: 100,
        afterSizeBytes: BigInt(completeJobDto.afterSizeBytes),
        savedBytes: BigInt(completeJobDto.savedBytes),
        savedPercent: completeJobDto.savedPercent,
        completedAt: new Date(),
      },
      include: {
        node: {
          include: {
            license: true,
          },
        },
      },
    });

    // Update metrics asynchronously
    await this.updateMetrics(job);

    this.logger.log(`Job completed: ${id} (saved ${completeJobDto.savedPercent}%)`);
    return job;
  }

  /**
   * Mark a job as failed
   *
   * @param id - Job unique identifier
   * @param error - Error message
   * @returns Failed job
   * @throws NotFoundException if job does not exist
   */
  async failJob(id: string, error: string): Promise<Job> {
    this.logger.log(`Failing job: ${id}`);

    const job = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.FAILED,
        completedAt: new Date(),
        error,
      },
    });

    this.logger.log(`Job failed: ${id} (${error})`);
    return job;
  }

  /**
   * Cancel a job
   *
   * @param id - Job unique identifier
   * @returns Cancelled job
   * @throws NotFoundException if job does not exist
   * @throws BadRequestException if job is already completed
   */
  async cancelJob(id: string): Promise<Job> {
    this.logger.log(`Cancelling job: ${id}`);

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage === JobStage.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed job');
    }

    const job = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.CANCELLED,
        completedAt: new Date(),
      },
    });

    this.logger.log(`Job cancelled: ${id}`);
    return job;
  }

  /**
   * Delete a job
   *
   * @param id - Job unique identifier
   * @returns void
   * @throws NotFoundException if job does not exist
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
   * Get job statistics
   *
   * @param nodeId - Optional node ID to filter statistics
   * @returns Job statistics including counts by stage and total savings
   */
  async getJobStats(nodeId?: string): Promise<JobStatsDto> {
    this.logger.log(`Fetching job stats (node: ${nodeId || 'all'})`);

    const where = nodeId ? { nodeId } : {};

    const [completed, failed, encoding, queued, totalSaved] = await Promise.all([
      this.prisma.job.count({
        where: { ...where, stage: JobStage.COMPLETED },
      }),
      this.prisma.job.count({
        where: { ...where, stage: JobStage.FAILED },
      }),
      this.prisma.job.count({
        where: { ...where, stage: JobStage.ENCODING },
      }),
      this.prisma.job.count({
        where: { ...where, stage: JobStage.QUEUED },
      }),
      this.prisma.job.aggregate({
        where: { ...where, stage: JobStage.COMPLETED },
        _sum: { savedBytes: true },
      }),
    ]);

    return {
      completed,
      failed,
      encoding,
      queued,
      totalSavedBytes: (totalSaved._sum.savedBytes || BigInt(0)).toString(),
      nodeId,
    };
  }

  /**
   * Update metrics after job completion
   *
   * This method:
   * 1. Creates or updates node-specific daily metrics
   * 2. Creates or updates license-wide daily metrics
   *
   * @param job - Completed job with node and license info
   * @private
   */
  private async updateMetrics(job: any): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      // Node-specific metric
      await this.prisma.metric.upsert({
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

      // License-wide metric (nodeId: null for system-wide metrics)
      // @ts-expect-error - Prisma allows null for nodeId but TypeScript doesn't know this
      await this.prisma.metric.upsert({
        where: {
          date_nodeId_licenseId: {
            date: today,
            nodeId: null,
            licenseId: job.node.licenseId,
          },
        },
        create: {
          date: today,
          nodeId: null,
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

      this.logger.log(`Metrics updated for job: ${job.id}`);
    } catch (error) {
      this.logger.error(`Failed to update metrics for job: ${job.id}`, error);
      // Don't throw - metrics update failure shouldn't fail the job completion
    }
  }
}
