import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { type Job, JobStage } from '@prisma/client';
import { MediaAnalysisService } from '../libraries/services/media-analysis.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CompleteJobDto } from './dto/complete-job.dto';
import type { CreateJobDto } from './dto/create-job.dto';
import type { JobStatsDto } from './dto/job-stats.dto';
import type { UpdateJobDto } from './dto/update-job.dto';

/**
 * QueueService
 *
 * Handles job queue management and encoding job lifecycle.
 * Based on the Prisma integration example (lines 239-446).
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => MediaAnalysisService))
    private mediaAnalysis: MediaAnalysisService
  ) {}

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

    // Check if job already exists for this file path
    const existingJob = await this.prisma.job.findFirst({
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

    if (existingJob) {
      this.logger.log(
        `Job already exists for file: ${createJobDto.filePath} (stage: ${existingJob.stage}, id: ${existingJob.id})`
      );
      throw new BadRequestException(
        `Job already exists for this file (stage: ${existingJob.stage}). Cannot create duplicate.`
      );
    }

    try {
      const job = await this.prisma.job.create({
        data: {
          filePath: createJobDto.filePath,
          fileLabel: createJobDto.fileLabel,
          sourceCodec: createJobDto.sourceCodec,
          targetCodec: createJobDto.targetCodec,
          beforeSizeBytes: BigInt(createJobDto.beforeSizeBytes),
          stage: JobStage.DETECTED, // Start with DETECTED, health check worker will validate
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
   * Event handler for file.detected events from FileWatcherService
   *
   * Automatically creates encoding jobs when new video files are detected
   * in watched library directories.
   *
   * @param payload - Event payload with libraryId, filePath, and fileName
   */
  @OnEvent('file.detected')
  async handleFileDetected(payload: {
    libraryId: string;
    filePath: string;
    fileName: string;
  }): Promise<void> {
    this.logger.log(`Handling file.detected event for: ${payload.fileName}`);

    try {
      // Get library to access nodeId and defaultPolicyId
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

      // Probe the video file to get codec info
      const videoInfo = await this.mediaAnalysis.probeVideoFile(payload.filePath);

      if (!videoInfo) {
        this.logger.warn(`Failed to probe video file: ${payload.filePath}, skipping job creation`);
        return;
      }

      // Check if file needs encoding (codec doesn't match target)
      const needsEncoding = videoInfo.codec !== library.defaultPolicy.targetCodec;

      if (!needsEncoding) {
        this.logger.log(
          `File ${payload.fileName} already uses target codec ${library.defaultPolicy.targetCodec}, skipping`
        );
        return;
      }

      // Create job
      await this.create({
        filePath: payload.filePath,
        fileLabel: payload.fileName,
        sourceCodec: videoInfo.codec,
        targetCodec: library.defaultPolicy.targetCodec,
        beforeSizeBytes: videoInfo.sizeBytes.toString(),
        nodeId: library.nodeId,
        libraryId: library.id,
        policyId: library.defaultPolicyId,
      });

      this.logger.log(`Successfully created job for detected file: ${payload.fileName}`);
    } catch (error) {
      // Log error but don't throw - we don't want to crash the file watcher
      if (error instanceof BadRequestException && error.message.includes('already exists')) {
        this.logger.log(`Job already exists for ${payload.fileName}, skipping`);
      } else {
        this.logger.error(`Failed to create job for detected file ${payload.fileName}:`, error);
      }
    }
  }

  /**
   * Get all jobs with optional filtering
   *
   * @param stage - Optional filter by job stage
   * @param nodeId - Optional filter by node ID
   * @param search - Optional search term for file path or file label
   * @returns Array of jobs matching the filters
   */
  async findAll(stage?: JobStage, nodeId?: string, search?: string): Promise<Job[]> {
    this.logger.log(
      `Fetching jobs (stage: ${stage || 'all'}, node: ${nodeId || 'all'}, search: ${search || 'none'})`
    );

    // Build where clause
    const where: Record<string, unknown> = {};
    if (stage) {
      where.stage = stage;
    }
    if (nodeId) {
      where.nodeId = nodeId;
    }
    if (search) {
      // SQLite LIKE operator is case-insensitive by default for ASCII characters
      where.OR = [{ filePath: { contains: search } }, { fileLabel: { contains: search } }];
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

    // ATOMIC JOB CLAIMING:
    // Use a transaction to atomically find and claim a job
    // This prevents race conditions where multiple workers grab the same job
    const claimedJob = await this.prisma.$transaction(async (tx) => {
      // Find next queued job (prioritize healthy files)
      // Exclude jobs with future nextRetryAt (exponential backoff)
      const job = await tx.job.findFirst({
        where: {
          nodeId,
          stage: JobStage.QUEUED,
          OR: [
            { nextRetryAt: null }, // Jobs that have never failed
            { nextRetryAt: { lte: new Date() } }, // Jobs whose retry delay has passed
          ],
        },
        orderBy: [
          { healthScore: 'desc' }, // Healthy files first (90-100 score)
          { createdAt: 'asc' }, // Then FIFO within same health tier
        ],
      });

      if (!job) {
        return null;
      }

      // Atomically update to ENCODING to "claim" the job
      // If another worker already claimed it, this will fail
      return await tx.job.update({
        where: {
          id: job.id,
          stage: JobStage.QUEUED, // Ensure it's still QUEUED (prevents double-claiming)
        },
        data: {
          stage: JobStage.ENCODING,
          startedAt: new Date(),
        },
        include: {
          policy: true,
          library: true,
        },
      });
    });

    if (claimedJob) {
      this.logger.log(`Assigned job ${claimedJob.id} to node ${nodeId}`);
      return claimedJob;
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
   * @throws BadRequestException if attempting to manually set HEALTH_CHECK stage
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

    // SECURITY: Prevent manual HEALTH_CHECK stage assignment
    // HEALTH_CHECK is an internal stage only set by the health check worker
    // Jobs manually moved to HEALTH_CHECK will be orphaned (worker only processes DETECTED)
    if (updateJobDto.stage === JobStage.HEALTH_CHECK) {
      throw new BadRequestException(
        'Cannot manually set HEALTH_CHECK stage. This is an internal stage managed by the health check worker. ' +
          'To prioritize a job, use the force-start endpoint instead.'
      );
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
   * @param blacklist - If true, marks the job as blacklisted (never auto-encode again)
   * @returns Cancelled job
   * @throws NotFoundException if job does not exist
   * @throws BadRequestException if job is already completed
   */
  async cancelJob(id: string, blacklist = false): Promise<Job> {
    this.logger.log(`Cancelling job: ${id} (blacklist: ${blacklist})`);

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
        isBlacklisted: blacklist,
      },
    });

    this.logger.log(`Job cancelled: ${id} (blacklisted: ${blacklist})`);
    return job;
  }

  /**
   * Unblacklist a job to allow retry
   *
   * @param id - Job unique identifier
   * @returns Updated job with isBlacklisted set to false
   * @throws NotFoundException if job does not exist
   * @throws BadRequestException if job is not in CANCELLED stage or not blacklisted
   */
  async unblacklistJob(id: string): Promise<Job> {
    this.logger.log(`Unblacklisting job: ${id}`);

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.CANCELLED) {
      throw new BadRequestException('Only cancelled jobs can be unblacklisted');
    }

    if (!existingJob.isBlacklisted) {
      throw new BadRequestException('Job is not blacklisted');
    }

    const job = await this.prisma.job.update({
      where: { id },
      data: {
        isBlacklisted: false,
      },
    });

    this.logger.log(`Job unblacklisted: ${id}`);
    return job;
  }

  /**
   * Cancel all queued jobs
   *
   * @returns Object with count of cancelled jobs
   */
  async cancelAllQueued(): Promise<{ cancelledCount: number }> {
    this.logger.log('Cancelling all queued jobs');

    try {
      const result = await this.prisma.job.updateMany({
        where: {
          stage: JobStage.QUEUED,
        },
        data: {
          stage: JobStage.CANCELLED,
          completedAt: new Date(),
        },
      });

      this.logger.log(`Cancelled ${result.count} queued job(s)`);
      return { cancelledCount: result.count };
    } catch (error) {
      this.logger.error('Failed to cancel all queued jobs', error);
      throw error;
    }
  }

  /**
   * Pause an encoding job
   *
   * @param id - Job unique identifier
   * @returns Updated job in PAUSED stage
   * @throws NotFoundException if job does not exist
   * @throws BadRequestException if job is not in ENCODING stage
   */
  async pauseJob(id: string): Promise<Job> {
    this.logger.log(`Pausing job: ${id}`);

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.ENCODING) {
      throw new BadRequestException('Only encoding jobs can be paused');
    }

    const job = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.PAUSED,
      },
    });

    this.logger.log(`Job paused: ${id}`);
    return job;
  }

  /**
   * Resume a paused job
   *
   * @param id - Job unique identifier
   * @returns Updated job in ENCODING stage
   * @throws NotFoundException if job does not exist
   * @throws BadRequestException if job is not in PAUSED stage
   */
  async resumeJob(id: string): Promise<Job> {
    this.logger.log(`Resuming job: ${id}`);

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.PAUSED) {
      throw new BadRequestException('Only paused jobs can be resumed');
    }

    const job = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.ENCODING,
      },
    });

    this.logger.log(`Job resumed: ${id}`);
    return job;
  }

  /**
   * Retry a failed or cancelled job
   *
   * This method resets the job back to QUEUED stage, clearing any error state
   * and allowing it to be picked up by nodes again.
   *
   * @param id - Job unique identifier
   * @returns Updated job in QUEUED stage
   * @throws NotFoundException if job does not exist
   * @throws BadRequestException if job is not in FAILED or CANCELLED stage
   */
  async retryJob(id: string): Promise<Job> {
    this.logger.log(`Retrying job: ${id}`);

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.FAILED && existingJob.stage !== JobStage.CANCELLED) {
      throw new BadRequestException('Only failed or cancelled jobs can be retried');
    }

    const job = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.QUEUED,
        progress: 0,
        error: null,
        completedAt: null,
        startedAt: null,
      },
    });

    this.logger.log(`Job retried: ${id}`);
    return job;
  }

  /**
   * Force start a queued job immediately
   *
   * Moves a job from QUEUED or DETECTED stage to HEALTH_CHECK immediately,
   * bypassing the normal queue order. The health check worker will pick it up
   * and start encoding right away.
   *
   * @param id - Job unique identifier
   * @returns Updated job
   * @throws NotFoundException if job does not exist
   * @throws BadRequestException if job is not in QUEUED or DETECTED stage
   */
  async forceStartJob(id: string): Promise<Job> {
    this.logger.log(`Force starting job: ${id}`);

    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.QUEUED && existingJob.stage !== JobStage.DETECTED) {
      throw new BadRequestException(
        `Only queued or detected jobs can be force-started (current stage: ${existingJob.stage})`
      );
    }

    // Move to DETECTED stage so health check worker picks it up immediately
    // Update createdAt to prioritize it (worker processes oldest first)
    const job = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.DETECTED,
        createdAt: new Date(), // Update timestamp to make it first in queue
      },
    });

    this.logger.log(
      `Job force-started: ${id} - moved to DETECTED stage (will be picked up immediately)`
    );
    return job;
  }

  /**
   * Retry all cancelled jobs
   *
   * This method resets all CANCELLED jobs back to QUEUED stage,
   * allowing them to be processed again.
   *
   * @returns Object with count of retried jobs and aggregate data
   */
  async retryAllCancelled(): Promise<{
    retriedCount: number;
    totalSizeBytes: string;
    jobs: Array<{ id: string; fileLabel: string; beforeSizeBytes: bigint }>;
  }> {
    this.logger.log('Retrying all cancelled jobs');

    try {
      // First get all cancelled jobs for aggregate data
      const cancelledJobs = await this.prisma.job.findMany({
        where: {
          stage: JobStage.CANCELLED,
        },
        select: {
          id: true,
          fileLabel: true,
          beforeSizeBytes: true,
        },
      });

      // Calculate total size
      const totalSize = cancelledJobs.reduce(
        (sum, job) => sum + BigInt(job.beforeSizeBytes),
        BigInt(0)
      );

      // Update all cancelled jobs back to queued
      const result = await this.prisma.job.updateMany({
        where: {
          stage: JobStage.CANCELLED,
        },
        data: {
          stage: JobStage.QUEUED,
          progress: 0,
          error: null,
          completedAt: null,
          startedAt: null,
        },
      });

      this.logger.log(`Retried ${result.count} cancelled job(s)`);
      return {
        retriedCount: result.count,
        totalSizeBytes: totalSize.toString(),
        jobs: cancelledJobs,
      };
    } catch (error) {
      this.logger.error('Failed to retry all cancelled jobs', error);
      throw error;
    }
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

    const [
      detected,
      healthCheck,
      queued,
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
        where: { ...where, stage: JobStage.QUEUED },
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

    return {
      detected,
      healthCheck,
      queued,
      encoding,
      verifying,
      completed,
      failed,
      cancelled,
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
  private async updateMetrics(job: Job & { node: { licenseId: string } }): Promise<void> {
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
      await this.prisma.metric.upsert({
        where: {
          date_nodeId_licenseId: {
            date: today,
            nodeId: null as unknown as string,
            licenseId: job.node.licenseId,
          },
        },
        create: {
          date: today,
          nodeId: null as unknown as string,
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
