import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { type Job, JobStage, Prisma } from '@prisma/client';
import { FfmpegService } from '../encoding/ffmpeg.service';
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
    private mediaAnalysis: MediaAnalysisService,
    @Inject(forwardRef(() => FfmpegService))
    private ffmpegService: FfmpegService
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

    // Check if job already exists for this file path (active stages only)
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

    // Delete any old FAILED/CANCELLED jobs for this file to prevent duplicates across tabs
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
          stage: JobStage.DETECTED, // Start with DETECTED, health check worker will validate
          nodeId: createJobDto.nodeId,
          libraryId: createJobDto.libraryId,
          policyId: createJobDto.policyId,
          // AV1 THROTTLING: Include throttling fields if provided
          warning: createJobDto.warning,
          resourceThrottled: createJobDto.resourceThrottled ?? false,
          resourceThrottleReason: createJobDto.resourceThrottleReason,
          ffmpegThreads: createJobDto.ffmpegThreads,
        },
      });

      this.logger.log(`Job created: ${job.id} (${job.fileLabel})`);
      return job;
    } catch (error) {
      // ISSUE #9 FIX: Catch unique constraint violation (race condition)
      // If another request created a job for this file while we were checking,
      // the database unique index will prevent duplicate creation
      const err = error as any;
      if (err?.code === 'P2002' && err?.meta?.target?.includes('unique_active_job_per_file')) {
        // Unique constraint violated - another job exists for this file
        // Return the existing job
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

      // AV1 THROTTLING: Detect AV1 source codec and set warning + resource limits
      let warning: string | undefined;
      let resourceThrottled = false;
      let resourceThrottleReason: string | undefined;
      let ffmpegThreads: number | undefined;

      if (videoInfo.codec.toLowerCase() === 'av1') {
        const durationHours = videoInfo.duration / 3600;
        const estimatedHours = Math.round(durationHours * 150); // AV1 is ~150x slower

        warning =
          `⚠️ WARNING: AV1 → HEVC TRANSCODING\n\n` +
          `This is an extremely resource-intensive task:\n` +
          `• Expected encoding time: ${estimatedHours}+ hours (for ${Math.round(durationHours)}h video)\n` +
          `• CPU usage will be limited to 8 threads to prevent system instability\n` +
          `• Output file may be LARGER than source (AV1 is more efficient than HEVC)\n\n` +
          `⚠️ RECOMMENDATION: Skip this file or reconsider target codec`;

        resourceThrottled = true;
        resourceThrottleReason = 'AV1 source codec requires reduced CPU usage';
        ffmpegThreads = 8; // Limit to 8 threads

        this.logger.warn(
          `AV1 source detected for ${payload.fileName} - will throttle to ${ffmpegThreads} threads`
        );
      }

      // Create job (with AV1 throttling fields if applicable)
      await this.create({
        filePath: payload.filePath,
        fileLabel: payload.fileName,
        sourceCodec: videoInfo.codec,
        targetCodec: library.defaultPolicy.targetCodec,
        beforeSizeBytes: videoInfo.sizeBytes.toString(),
        nodeId: library.nodeId,
        libraryId: library.id,
        policyId: library.defaultPolicyId,
        warning,
        resourceThrottled,
        resourceThrottleReason,
        ffmpegThreads,
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
  async findAll(
    stage?: JobStage,
    nodeId?: string,
    search?: string,
    libraryId?: string
  ): Promise<Job[]> {
    this.logger.log(
      `Fetching jobs (stage: ${stage || 'all'}, node: ${nodeId || 'all'}, library: ${libraryId || 'all'}, search: ${search || 'none'})`
    );

    // Build where clause
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
      orderBy:
        stage === 'FAILED'
          ? { failedAt: 'desc' } // Most recent failures first
          : { createdAt: 'asc' }, // Default: oldest first
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

    // CRITICAL FIX: ATOMIC JOB CLAIMING WITH RACE CONDITION PREVENTION
    // Use transaction + updateMany + count check to ensure only ONE worker claims a job
    // This prevents race conditions where multiple workers grab the same job
    const claimedJob = await this.prisma.$transaction(async (tx) => {
      // Find next queued job (prioritize by: priority DESC, healthScore DESC, createdAt ASC)
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
          { priority: 'desc' }, // Top priority (2) first, then high (1), then normal (0)
          { healthScore: 'desc' }, // Healthy files first (90-100 score) within same priority
          { createdAt: 'asc' }, // Then FIFO within same priority+health tier
        ],
      });

      if (!job) {
        return null;
      }

      // CRITICAL FIX: Use updateMany with WHERE clause to atomically claim the job
      // This ensures only ONE worker can successfully claim the job
      // If another worker already claimed it between findFirst and update,
      // the WHERE stage=QUEUED condition will fail and count will be 0
      const updateResult = await tx.job.updateMany({
        where: {
          id: job.id,
          stage: JobStage.QUEUED, // CRITICAL: Ensure it's still QUEUED (prevents double-claiming)
        },
        data: {
          stage: JobStage.ENCODING,
          startedAt: new Date(),
        },
      });

      // Check if update was successful (count === 1 means we claimed it)
      if (updateResult.count === 0) {
        // Another worker claimed this job between our findFirst and updateMany
        this.logger.debug(`Job ${job.id} was claimed by another worker, trying next job`);
        return null;
      }

      // We successfully claimed the job - now fetch it with relations
      return await tx.job.findUnique({
        where: { id: job.id },
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
   * @param updateJobDto - Progress update data (with optional resume state)
   * @returns Updated job
   * @throws NotFoundException if job does not exist
   * @throws BadRequestException if attempting to manually set HEALTH_CHECK stage
   */
  async updateProgress(
    id: string,
    updateJobDto: UpdateJobDto & {
      resumeTimestamp?: string;
      tempFilePath?: string;
    }
  ): Promise<Job> {
    this.logger.debug(`Updating progress for job: ${id}`);

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
      // TRUE RESUME: Save resume state for crash recovery
      const updateData: any = { ...updateJobDto };

      // If resume state is provided, save it along with progress
      if (updateJobDto.resumeTimestamp) {
        updateData.resumeTimestamp = updateJobDto.resumeTimestamp;
        updateData.lastProgressUpdate = new Date();
      }
      if (updateJobDto.tempFilePath) {
        updateData.tempFilePath = updateJobDto.tempFilePath;
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

    // CRITICAL FIX #1: Use transaction to ensure atomic completion + metrics update
    // This prevents race conditions where job shows COMPLETED via API but disappears after restart
    const job = await this.prisma.$transaction(async (tx) => {
      // Step 1: Update job to COMPLETED
      const completedJob = await tx.job.update({
        where: { id },
        data: {
          stage: JobStage.COMPLETED,
          progress: 100,
          afterSizeBytes: BigInt(completeJobDto.afterSizeBytes),
          savedBytes: BigInt(completeJobDto.savedBytes),
          savedPercent: completeJobDto.savedPercent,
          completedAt: new Date(),
          priority: 0, // Auto-reset priority to normal on completion
          prioritySetAt: null, // Clear priority timestamp
        },
        include: {
          node: {
            include: {
              license: true,
            },
          },
        },
      });

      // Step 2: Update metrics INSIDE transaction (not outside)
      await this.updateMetrics(completedJob, tx);

      return completedJob;
    });

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
        failedAt: new Date(),
        error,
        priority: 0, // Auto-reset priority to normal on failure
        prioritySetAt: null, // Clear priority timestamp
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

    // If job is currently encoding, kill the FFmpeg process first
    if (existingJob.stage === JobStage.ENCODING) {
      this.logger.log(`Job ${id} is encoding - killing FFmpeg process`);
      try {
        const killed = await this.ffmpegService.killProcess(id);
        if (killed) {
          // Wait for process to fully terminate (killProcess already has 2s grace period)
          await new Promise((resolve) => setTimeout(resolve, 500));
          this.logger.log(`Successfully killed FFmpeg process for job ${id}`);
        } else {
          this.logger.warn(`FFmpeg process not found for job ${id}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to kill FFmpeg for job ${id}: ${error}`);
        // Continue with cancellation even if kill fails
      }
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
   * Cancel all jobs (including encoding)
   *
   * Cancels all jobs except COMPLETED:
   * - DETECTED: Waiting for health check
   * - QUEUED: Waiting to start encoding
   * - PAUSED: Manually paused during encoding
   * - HEALTH_CHECK: Being validated
   * - ENCODING: Actively processing (kills FFmpeg process)
   *
   * @returns Object with count of cancelled jobs
   */
  async cancelAllQueued(): Promise<{ cancelledCount: number }> {
    this.logger.log('Cancelling all jobs (including encoding)');

    try {
      // STEP 1: Get all ENCODING jobs and kill their FFmpeg processes
      const encodingJobs = await this.prisma.job.findMany({
        where: { stage: JobStage.ENCODING },
        select: { id: true, fileLabel: true },
      });

      if (encodingJobs.length > 0) {
        this.logger.log(`Killing ${encodingJobs.length} FFmpeg process(es) in parallel...`);

        // LOW PRIORITY FIX #16: Parallelize FFmpeg kills for faster cancellation
        const killPromises = encodingJobs.map(async (job) => {
          try {
            await this.ffmpegService.killProcess(job.id);
            this.logger.log(`  ✓ Killed FFmpeg for: ${job.fileLabel}`);
          } catch (error) {
            this.logger.warn(`  ✗ Failed to kill FFmpeg for ${job.id}: ${error}`);
          }
        });

        // Wait for all kills to complete (or fail)
        await Promise.allSettled(killPromises);
        this.logger.log(`Finished killing ${encodingJobs.length} FFmpeg process(es)`);
      }

      // STEP 2: Cancel all non-completed jobs in database
      const result = await this.prisma.job.updateMany({
        where: {
          stage: {
            in: [
              JobStage.DETECTED,
              JobStage.QUEUED,
              JobStage.PAUSED,
              JobStage.HEALTH_CHECK,
              JobStage.ENCODING,
            ],
          },
        },
        data: {
          stage: JobStage.CANCELLED,
          completedAt: new Date(),
        },
      });

      this.logger.log(`Cancelled ${result.count} job(s) (all stages including encoding)`);
      return { cancelledCount: result.count };
    } catch (error) {
      this.logger.error('Failed to cancel all jobs', error);
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

    // Pause the FFmpeg process
    const paused = await this.ffmpegService.pauseEncoding(id);
    if (!paused) {
      throw new BadRequestException('Failed to pause encoding process');
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

    // Try to resume the FFmpeg process
    const resumed = await this.ffmpegService.resumeEncoding(id);

    if (!resumed) {
      // Process not found (likely backend restart) - reset to QUEUED to restart from beginning
      this.logger.warn(
        `FFmpeg process not found for job ${id} - resetting to QUEUED to restart encoding`
      );

      const job = await this.prisma.job.update({
        where: { id },
        data: {
          stage: JobStage.QUEUED,
          progress: 0,
          etaSeconds: null,
          startedAt: null,
          error: 'Restarted from paused state (process was lost)',
        },
      });

      this.logger.log(`Job reset to QUEUED: ${id}`);
      return job;
    }

    // Process resumed successfully
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
    // Set createdAt to epoch (oldest possible date) to prioritize it first in queue
    // Queue sorts by createdAt ASC, so epoch = highest priority
    const job = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.DETECTED,
        createdAt: new Date(0), // Epoch time (1970) = highest priority
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
   * Clear all jobs or jobs matching specific statuses
   * @param stages Optional array of job stages to delete (if not provided, deletes ALL jobs)
   * @returns Number of jobs deleted
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
   * Update job priority
   *
   * This method:
   * 1. Validates priority level (0-2)
   * 2. Enforces max 3 top priority (2) jobs limit
   * 3. Updates job priority and timestamp
   * 4. Supports live priority changes for running jobs (renice via FFmpeg service)
   *
   * @param id - Job unique identifier
   * @param priority - New priority level (0=normal, 1=high, 2=top)
   * @returns Updated job
   * @throws NotFoundException if job does not exist
   * @throws BadRequestException if priority validation fails
   */
  async updateJobPriority(id: string, priority: number): Promise<Job> {
    this.logger.log(`Updating priority for job ${id} to ${priority}`);

    // Validate job exists
    const existingJob = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    // Validate priority is 0-2
    if (priority < 0 || priority > 2) {
      throw new BadRequestException('Priority must be between 0 and 2');
    }

    // If setting to top priority (2), enforce max 3 limit
    if (priority === 2) {
      const topPriorityCount = await this.prisma.job.count({
        where: {
          priority: 2,
          stage: {
            in: [JobStage.DETECTED, JobStage.HEALTH_CHECK, JobStage.QUEUED, JobStage.ENCODING],
          },
          id: { not: id }, // Exclude current job from count
        },
      });

      if (topPriorityCount >= 3) {
        throw new BadRequestException(
          'Maximum 3 jobs can have top priority at once. Please lower priority of another job first.'
        );
      }
    }

    // Update job priority
    const job = await this.prisma.job.update({
      where: { id },
      data: {
        priority,
        prioritySetAt: new Date(),
      },
    });

    // If job is currently encoding, renice the FFmpeg process
    if (existingJob.stage === JobStage.ENCODING) {
      try {
        await this.ffmpegService.reniceProcess(id, priority);
        this.logger.log(`Reniced FFmpeg process for job ${id} to priority ${priority}`);
      } catch (error) {
        this.logger.warn(
          `Failed to renice FFmpeg process for job ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        // Don't throw - priority is still updated in database, renice is best-effort
      }
    }

    this.logger.log(`Job ${id} priority updated to ${priority}`);
    return job;
  }

  /**
   * Request to keep original file after encoding
   *
   * This method sets a flag on an encoding job to preserve the original file
   * when encoding completes. The original will be renamed to .original extension.
   *
   * @param id - Job unique identifier
   * @returns Updated job with keepOriginalRequested=true
   * @throws NotFoundException if job does not exist
   * @throws BadRequestException if job is not in ENCODING stage
   */
  async requestKeepOriginal(id: string): Promise<Job> {
    this.logger.log(`Requesting keep original for job: ${id}`);

    const job = await this.findOne(id);

    if (job.stage !== JobStage.ENCODING) {
      throw new BadRequestException('Can only request keep-original for ENCODING jobs');
    }

    const updatedJob = await this.prisma.job.update({
      where: { id },
      data: {
        keepOriginalRequested: true,
        originalSizeBytes: job.beforeSizeBytes, // Capture original size
      },
    });

    this.logger.log(`Keep original requested for job: ${id}`);
    return updatedJob;
  }

  /**
   * Delete original backup file
   *
   * This method deletes the .original backup file and frees disk space.
   * This action cannot be undone.
   *
   * @param id - Job unique identifier
   * @returns Object with freed space in bytes
   * @throws NotFoundException if job does not exist
   * @throws BadRequestException if no original backup exists
   */
  async deleteOriginalBackup(id: string): Promise<{ freedSpace: bigint }> {
    this.logger.log(`Deleting original backup for job: ${id}`);

    const job = await this.findOne(id);

    if (!job.originalBackupPath) {
      throw new BadRequestException('No original backup exists for this job');
    }

    const size = job.originalSizeBytes || BigInt(0);

    // Delete the original backup file
    const fs = await import('fs/promises');
    try {
      await fs.unlink(job.originalBackupPath);
    } catch (error) {
      this.logger.error(`Failed to delete original backup file: ${job.originalBackupPath}`, error);
      throw new BadRequestException(
        `Failed to delete original backup file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Update job to clear backup info
    await this.prisma.job.update({
      where: { id },
      data: {
        originalBackupPath: null,
        originalSizeBytes: null,
      },
    });

    this.logger.log(`Original backup deleted for job: ${id} (freed ${size} bytes)`);
    return { freedSpace: size };
  }

  /**
   * Restore original file
   *
   * This method swaps the encoded file with the original backup.
   * The original becomes the active file, and the encoded version becomes the backup.
   *
   * @param id - Job unique identifier
   * @returns Updated job
   * @throws NotFoundException if job does not exist
   * @throws BadRequestException if no original backup exists
   */
  async restoreOriginal(id: string): Promise<Job> {
    this.logger.log(`Restoring original for job: ${id}`);

    const job = await this.findOne(id);

    if (!job.originalBackupPath) {
      throw new BadRequestException('No original backup to restore');
    }

    // Swap files back
    const fs = await import('fs/promises');
    const encodedPath = `${job.filePath}.encoded`;

    try {
      await fs.rename(job.filePath, encodedPath); // Save encoded version
      await fs.rename(job.originalBackupPath, job.filePath); // Restore original
    } catch (error) {
      this.logger.error(`Failed to restore original file for job: ${id}`, error);
      throw new BadRequestException(
        `Failed to restore original file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Update job - now .encoded is the backup
    const updatedJob = await this.prisma.job.update({
      where: { id },
      data: {
        originalBackupPath: encodedPath, // Now .encoded is the backup
        replacementAction: 'KEPT_BOTH', // Still keeping both
      },
    });

    this.logger.log(`Original restored for job: ${id}`);
    return updatedJob;
  }

  /**
   * Recheck a failed job to validate if it's truly failed or completed
   *
   * This method re-validates a FAILED job by checking file existence and health.
   * Useful for jobs incorrectly marked as FAILED due to race conditions.
   *
   * Actions performed:
   * 1. Validates job is in FAILED stage
   * 2. Checks if encoded file exists at original path
   * 3. Runs health check using ffprobe
   * 4. If file is healthy, recalculates file sizes and moves to COMPLETED
   * 5. If file is invalid or missing, updates error message with recheck results
   *
   * @param id - Job unique identifier
   * @returns Updated job (COMPLETED if file is valid, FAILED with updated error if not)
   * @throws NotFoundException if job does not exist
   * @throws BadRequestException if job is not in FAILED stage
   */
  async recheckFailedJob(id: string): Promise<Job> {
    this.logger.log(`Rechecking failed job: ${id}`);

    // Step 1: Validate job exists and is in FAILED stage
    const job = await this.findOne(id);

    if (job.stage !== JobStage.FAILED) {
      throw new BadRequestException(`Can only recheck FAILED jobs (current stage: ${job.stage})`);
    }

    // Step 2: Check if encoded file exists at original path
    const fs = await import('fs/promises');
    let fileExists = false;
    let fileSize = BigInt(0);

    try {
      const stats = await fs.stat(job.filePath);
      fileExists = stats.isFile();
      fileSize = BigInt(stats.size);
      this.logger.log(`File exists at ${job.filePath} (${fileSize} bytes)`);
    } catch (error) {
      this.logger.warn(
        `File not found at ${job.filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    if (!fileExists) {
      // File doesn't exist - update error message and keep in FAILED
      const updatedJob = await this.prisma.job.update({
        where: { id },
        data: {
          error: `RECHECK FAILED: File does not exist at expected path: ${job.filePath}\n\nOriginal error:\n${job.error}`,
        },
      });

      this.logger.log(`Recheck failed: File not found for job ${id}`);
      return updatedJob;
    }

    // Step 3: Run health check using ffprobe
    const verifyResult = await this.ffmpegService.verifyFile(job.filePath);

    if (!verifyResult.isValid) {
      // File exists but is corrupted - update error message and keep in FAILED
      const updatedJob = await this.prisma.job.update({
        where: { id },
        data: {
          error: `RECHECK FAILED: File exists but failed health check: ${verifyResult.error}\n\nOriginal error:\n${job.error}`,
        },
      });

      this.logger.log(`Recheck failed: File is corrupted for job ${id}`);
      return updatedJob;
    }

    // Step 4: File is valid! Calculate metrics and check if encoding actually compressed
    this.logger.log(`Recheck passed! File is valid for job ${id}`);

    // Calculate savings
    const afterSizeBytes = fileSize;
    const beforeSizeBytes = BigInt(job.beforeSizeBytes);
    const savedBytes = beforeSizeBytes - afterSizeBytes;
    const savedPercent = (Number(savedBytes) / Number(beforeSizeBytes)) * 100;
    const savedPercentRounded = Math.round(savedPercent * 100) / 100;

    // VALIDATION: Check if encoding actually compressed the file
    // If file is same size or larger, encoding failed to compress - reject recheck
    if (savedBytes <= BigInt(0)) {
      const updatedJob = await this.prisma.job.update({
        where: { id },
        data: {
          error: `RECHECK FAILED: Encoding did not compress the file.\n\nBefore: ${Number(beforeSizeBytes).toLocaleString()} bytes\nAfter: ${Number(afterSizeBytes).toLocaleString()} bytes\nDifference: ${savedBytes >= BigInt(0) ? 'NO COMPRESSION' : 'FILE GREW'}\n\nThis suggests encoding settings were not applied correctly. The job should be retried.\n\nOriginal error:\n${job.error}`,
        },
      });

      this.logger.log(
        `Recheck rejected: File did not compress (before: ${beforeSizeBytes}, after: ${afterSizeBytes})`
      );
      return updatedJob;
    }

    // Use transaction to ensure atomic completion + metrics update (same pattern as completeJob)
    const completedJob = await this.prisma.$transaction(async (tx) => {
      // Update job to COMPLETED
      const updated = await tx.job.update({
        where: { id },
        data: {
          stage: JobStage.COMPLETED,
          progress: 100,
          afterSizeBytes,
          savedBytes,
          savedPercent: savedPercentRounded,
          completedAt: new Date(),
          failedAt: null,
          error: null, // Clear error
          priority: 0, // Auto-reset priority to normal on completion
          prioritySetAt: null, // Clear priority timestamp
        },
        include: {
          node: {
            include: {
              license: true,
            },
          },
        },
      });

      // Update metrics INSIDE transaction (same as completeJob)
      await this.updateMetrics(updated, tx);

      return updated;
    });

    this.logger.log(`Job ${id} rechecked and moved to COMPLETED (saved ${savedPercentRounded}%)`);
    return completedJob;
  }

  /**
   * Detect if a completed job actually compressed the file, and requeue if not
   *
   * This method checks if a COMPLETED job has savedBytes <= 0, indicating that
   * the encoding did not actually compress the file. If so, it moves the job
   * back to QUEUED stage to retry with different settings.
   *
   * @param id - Job unique identifier
   * @returns Updated job
   */
  async detectAndRequeueIfUncompressed(id: string): Promise<Job> {
    this.logger.log(`Detecting compression for completed job: ${id}`);

    // Step 1: Validate job exists and is in COMPLETED stage
    const job = await this.findOne(id);

    if (job.stage !== JobStage.COMPLETED) {
      throw new BadRequestException(
        `Can only detect compression for COMPLETED jobs (current stage: ${job.stage})`
      );
    }

    // Step 2: Check if encoding actually compressed the file
    const savedBytes = BigInt(job.savedBytes || 0);

    if (savedBytes > BigInt(0)) {
      // Compression was successful - do not requeue
      throw new BadRequestException(
        `Job successfully compressed the file by ${Number(savedBytes).toLocaleString()} bytes (${job.savedPercent}%). Cannot requeue.`
      );
    }

    // Step 3: No compression detected - requeue the job
    this.logger.log(`No compression detected (savedBytes: ${savedBytes}). Requeuing job ${id}...`);

    const requeuedJob = await this.prisma.job.update({
      where: { id },
      data: {
        stage: JobStage.QUEUED,
        progress: 0,
        completedAt: null,
        savedBytes: BigInt(0),
        savedPercent: 0,
        afterSizeBytes: null,
        error: null,
        priority: 0,
        prioritySetAt: null,
      },
      include: {
        node: {
          include: {
            license: true,
          },
        },
      },
    });

    this.logger.log(
      `Job ${id} requeued (no compression detected - before: ${Number(job.beforeSizeBytes).toLocaleString()} bytes, after: ${Number(job.afterSizeBytes).toLocaleString()} bytes)`
    );

    return requeuedJob;
  }

  /**
   * Update a job with arbitrary data
   *
   * This is a generic update method used internally by other methods.
   *
   * @param id - Job unique identifier
   * @param data - Update data
   * @returns Updated job
   * @private
   */
  async update(id: string, data: Partial<Job>): Promise<Job> {
    return this.prisma.job.update({
      where: { id },
      data,
    });
  }

  /**
   * Update metrics after job completion
   *
   * This method:
   * 1. Creates or updates node-specific daily metrics
   * 2. Creates or updates license-wide daily metrics
   *
   * @param job - Completed job with node and license info
   * @param tx - Optional Prisma transaction client (for atomic operations)
   * @private
   */
  private async updateMetrics(
    job: Job & { node: { licenseId: string } },
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Use transaction if provided, otherwise use regular prisma client
    const prisma = tx || this.prisma;

    try {
      // Node-specific metric only (removed license-wide metric that caused null nodeId errors)
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

      this.logger.log(`Metrics updated for job: ${job.id}`);
    } catch (error) {
      this.logger.error(`Failed to update metrics for job: ${job.id}`, error);
      // If we're in a transaction, throw to rollback everything
      // Otherwise, don't throw - metrics update failure shouldn't fail the job completion
      if (tx) {
        throw error;
      }
    }
  }
}
