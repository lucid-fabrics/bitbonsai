import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Job, JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';

/**
 * JobDecisionService
 *
 * Resolves user decisions for jobs in NEEDS_DECISION stage.
 */
@Injectable()
export class JobDecisionService {
  private readonly logger = new Logger(JobDecisionService.name);

  constructor(private readonly jobRepository: JobRepository) {}

  /**
   * Resolve a user decision for a job in NEEDS_DECISION stage
   */
  async resolveDecision(id: string, decisionData?: Record<string, unknown>): Promise<Job> {
    this.logger.log(`Resolving decision for job: ${id}`);

    const existingJob = await this.jobRepository.findById(id);

    if (!existingJob) {
      throw new NotFoundException(`Job with ID "${id}" not found`);
    }

    if (existingJob.stage !== JobStage.NEEDS_DECISION) {
      throw new BadRequestException(
        `Can only resolve decisions for jobs in NEEDS_DECISION stage (current stage: ${existingJob.stage})`
      );
    }

    if (decisionData?.actionConfig) {
      const config = decisionData.actionConfig as Record<string, unknown>;

      if (config.action === 'skip') {
        const job = await this.jobRepository.updateById(id, {
          stage: JobStage.COMPLETED,
          decisionRequired: false,
          decisionIssues: null,
          decisionMadeAt: new Date(),
          decisionData: JSON.stringify(decisionData),
          completedAt: new Date(),
          afterSizeBytes: existingJob.beforeSizeBytes,
          progress: 100,
          healthMessage: '✅ Skipped - file already in target codec',
        });
        this.logger.log(`Decision resolved for job ${id} - SKIPPED (codec already matches target)`);
        return job;
      }

      if (config.action === 'cancel') {
        const job = await this.jobRepository.updateById(id, {
          stage: JobStage.CANCELLED,
          decisionRequired: false,
          decisionIssues: null,
          decisionMadeAt: new Date(),
          decisionData: JSON.stringify(decisionData),
        });
        this.logger.log(
          `Decision resolved for job ${id} - CANCELLED by user (reason: ${config.reason || 'user_requested'})`
        );
        return job;
      }
    }

    const updateData: Record<string, unknown> = {
      stage: JobStage.QUEUED,
      decisionRequired: false,
      decisionIssues: null,
      decisionMadeAt: new Date(),
      decisionData: decisionData ? JSON.stringify(decisionData) : null,
    };

    if (decisionData?.actionConfig) {
      const config = decisionData.actionConfig as Record<string, unknown>;

      if (config.targetContainer) {
        updateData.targetContainer = config.targetContainer;
        this.logger.log(`Applying target container: ${config.targetContainer}`);
      }

      if (config.audioAction === 'copy') {
        updateData.type = 'REMUX';
        this.logger.log(`Setting job type to REMUX (audio copy)`);
      } else if (config.audioAction === 'transcode_aac') {
        updateData.type = 'ENCODE';
        this.logger.log(`Setting job type to ENCODE (audio transcode)`);
      }

      if (config.action === 'force_encode') {
        updateData.type = 'ENCODE';
        this.logger.log(`Setting job type to ENCODE (force re-encode same codec)`);
      }
    }

    const job = await this.jobRepository.updateRaw(id, updateData);

    this.logger.log(
      `Decision resolved for job ${id} - moved to QUEUED stage (container: ${job.targetContainer}, type: ${job.type})`
    );
    return job;
  }
}
