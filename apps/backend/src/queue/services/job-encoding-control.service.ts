import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Job, JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { FfmpegService } from '../../encoding/ffmpeg.service';

/**
 * JobEncodingControlService
 *
 * Handles in-process encoding control: pause, resume, and priority updates.
 */
@Injectable()
export class JobEncodingControlService {
  private readonly logger = new Logger(JobEncodingControlService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly ffmpegService: FfmpegService
  ) {}

  /**
   * Pause an encoding job
   */
  async pauseJob(id: string): Promise<Job> {
    this.logger.log(`Pausing job: ${id}`);

    const existingJob = await this.jobRepository.findById(id);

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.ENCODING) {
      throw new BadRequestException('Only encoding jobs can be paused');
    }

    const paused = await this.ffmpegService.pauseEncoding(id);
    if (!paused) {
      throw new BadRequestException('Failed to pause encoding process');
    }

    const job = await this.jobRepository.updateById(id, {
      stage: JobStage.PAUSED,
    });

    this.logger.log(`Job paused: ${id}`);
    return job;
  }

  /**
   * Resume a paused job
   */
  async resumeJob(id: string): Promise<Job> {
    this.logger.log(`Resuming job: ${id}`);

    const existingJob = await this.jobRepository.findById(id);

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.PAUSED) {
      throw new BadRequestException('Only paused jobs can be resumed');
    }

    const resumed = await this.ffmpegService.resumeEncoding(id);

    if (!resumed) {
      this.logger.warn(
        `FFmpeg process not found for job ${id} - resetting to QUEUED to restart encoding`
      );

      const job = await this.jobRepository.updateById(id, {
        stage: JobStage.QUEUED,
        progress: 0,
        etaSeconds: null,
        startedAt: null,
        error: 'Restarted from paused state (process was lost)',
      });

      this.logger.log(`Job reset to QUEUED: ${id}`);
      return job;
    }

    const job = await this.jobRepository.updateById(id, {
      stage: JobStage.ENCODING,
    });

    this.logger.log(`Job resumed: ${id}`);
    return job;
  }

  /**
   * Update job priority
   */
  async updateJobPriority(id: string, priority: number): Promise<Job> {
    this.logger.log(`Updating priority for job ${id} to ${priority}`);

    const existingJob = await this.jobRepository.findById(id);

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (priority < 0 || priority > 2) {
      throw new BadRequestException('Priority must be between 0 and 2');
    }

    if (priority === 2) {
      const topPriorityCount = await this.jobRepository.countWhere({
        priority: 2,
        stage: {
          in: [JobStage.DETECTED, JobStage.HEALTH_CHECK, JobStage.QUEUED, JobStage.ENCODING],
        },
        id: { not: id },
      });

      if (topPriorityCount >= 3) {
        throw new BadRequestException(
          'Maximum 3 jobs can have top priority at once. Please lower priority of another job first.'
        );
      }
    }

    const job = await this.jobRepository.updateById(id, {
      priority,
      prioritySetAt: new Date(),
    });

    if (existingJob.stage === JobStage.ENCODING) {
      try {
        await this.ffmpegService.reniceProcess(id, priority);
        this.logger.log(`Reniced FFmpeg process for job ${id} to priority ${priority}`);
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to renice FFmpeg process for job ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    this.logger.log(`Job ${id} priority updated to ${priority}`);
    return job;
  }
}
