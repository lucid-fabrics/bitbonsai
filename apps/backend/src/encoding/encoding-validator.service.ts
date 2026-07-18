import { Injectable, Logger } from '@nestjs/common';
import type { Library, Policy } from '@prisma/client';
import { JobRepository } from '../common/repositories/job.repository';
import { LibraryRepository } from '../common/repositories/library.repository';
import { PolicyRepository } from '../common/repositories/policy.repository';
import { QueueService } from '../queue/queue.service';
import { CompletionOutboxService } from '../queue/services/completion-outbox.service';
import { FileFailureTrackingService } from '../queue/services/file-failure-tracking.service';
import { EncodingFileService, type JobResult, type JobWithPolicy } from './encoding-file.service';
import { JobRetryStrategyService } from './job-retry-strategy.service';
import { CodecFallbackService } from './services/codec-fallback.service';

/**
 * EncodingValidatorService
 *
 * Handles job completion, failure, and policy validation/healing concerns
 * extracted from EncodingProcessorService.
 */
@Injectable()
export class EncodingValidatorService {
  private readonly logger = new Logger(EncodingValidatorService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly policyRepository: PolicyRepository,
    private readonly libraryRepository: LibraryRepository,
    private readonly queueService: QueueService,
    private readonly codecFallbackService: CodecFallbackService,
    private readonly completionOutbox: CompletionOutboxService,
    private readonly encodingFileService: EncodingFileService,
    private readonly jobRetryStrategyService: JobRetryStrategyService,
    private readonly fileFailureTracking: FileFailureTrackingService
  ) {}

  /**
   * Handle job completion
   *
   * Updates job statistics, metrics, and library totals.
   *
   * @param job - Completed job
   * @param result - Job result with file sizes
   */
  async handleJobCompletion(job: JobWithPolicy, result: JobResult): Promise<void> {
    this.logger.log(`Job ${job.id} completed successfully`);

    try {
      // GPU→CPU FALLBACK: clear any codec override now that encoding succeeded
      if (job.codecOverride) {
        await this.codecFallbackService.clearFallback(job.id);
      }

      // PER-FILE SUCCESS MEMORY: remember the codec that worked so a re-scan
      // of this same file routes straight to it instead of relearning a GPU
      // failure the hard way. Only meaningful when a fallback actually fired:
      // job.targetCodec is the abstract policy family (e.g. "HEVC"), not a
      // concrete ffmpeg encoder id, so it must never be recorded here - only
      // job.codecOverride is a real, capability-checked encoder name.
      // Non-critical: never block completion on it.
      if (job.codecOverride) {
        try {
          await this.fileFailureTracking.recordSuccess(
            job.filePath,
            job.libraryId,
            job.codecOverride,
            job.contentFingerprint ?? undefined
          );
        } catch (trackingError: unknown) {
          this.logger.warn(`Failed to record success-path memory for ${job.id}:`, trackingError);
        }
      }

      // OUTBOX: Persist completion data before the final DB update so a crash
      // between ffmpeg success and job.update(COMPLETED) can be replayed on restart.
      await this.completionOutbox.writeOutbox(job.id, {
        outputPath: job.filePath,
        outputSizeBytes: Number(result.afterSizeBytes),
        savedBytes: Number(result.savedBytes),
        savedPercent: result.savedPercent,
        codec: job.codecOverride ?? job.targetCodec,
      });

      // Update job to completed status
      await this.queueService.completeJob(job.id, {
        afterSizeBytes: result.afterSizeBytes.toString(),
        savedBytes: result.savedBytes.toString(),
        savedPercent: result.savedPercent,
      });

      // OUTBOX: Clear the entry now that the DB update succeeded.
      await this.completionOutbox.clearOutbox(job.id);

      // Update library statistics
      await this.encodingFileService.updateLibraryStats(job.libraryId, result.savedBytes);

      this.logger.log(`Job ${job.id} saved ${result.savedPercent.toFixed(2)}%`);
    } catch (error: unknown) {
      this.logger.error(`Error completing job ${job.id}:`, error);
      throw error;
    }
  }

  /**
   * Handle job failure - delegates retry logic to JobRetryStrategyService.
   *
   * @param job - Failed job
   * @param error - Error that caused failure
   */
  async handleJobFailure(job: JobWithPolicy, error: unknown): Promise<void> {
    return this.jobRetryStrategyService.handleJobFailure(job, error);
  }

  /**
   * SELF-HEALING: Validate and heal job's policy assignment
   *
   * Handles cases where:
   * - Policy was deleted after job was queued
   * - targetCodec doesn't match policy's targetCodec (orphaned setting)
   *
   * Resolution priority:
   * 1. Library's default policy
   * 2. Any policy assigned to the library
   * 3. First available policy in the system
   *
   * UX Philosophy: Auto-heal silently - user shouldn't need to know or intervene
   *
   * @param job - Job to validate and potentially heal
   * @returns Updated job with valid policy, or original if no changes needed
   */
  async validateAndHealJobPolicy(job: JobWithPolicy): Promise<JobWithPolicy> {
    // Fetch current policy from database
    const currentPolicy = job.policyId ? await this.policyRepository.findById(job.policyId) : null;

    // Case 1: Policy exists and codec matches - no healing needed
    if (currentPolicy && job.targetCodec === currentPolicy.targetCodec) {
      return job;
    }

    // Case 2: Policy exists but codec mismatches - update job's codec
    if (currentPolicy && job.targetCodec !== currentPolicy.targetCodec) {
      this.logger.warn(
        `[${job.id}] POLICY HEAL: targetCodec mismatch (job: ${job.targetCodec}, policy: ${currentPolicy.targetCodec}) - updating job`
      );

      const updatedJob = await this.jobRepository.updateByIdWithInclude<JobWithPolicy>(
        job.id,
        { targetCodec: currentPolicy.targetCodec },
        { policy: true }
      );

      return updatedJob;
    }

    // Case 3: Policy is missing - need to find alternative
    this.logger.warn(
      `[${job.id}] POLICY HEAL: Policy ${job.policyId} not found - finding alternative`
    );

    // Get library for this job to find appropriate policy
    const library = (await this.libraryRepository.findUniqueWithInclude(
      { id: job.libraryId },
      { defaultPolicy: true, policies: true }
    )) as (Library & { defaultPolicy: Policy | null; policies: Policy[] }) | null;

    // Find replacement policy in priority order
    let newPolicy = null;

    // Priority 1: Library's default policy
    if (library?.defaultPolicy) {
      newPolicy = library.defaultPolicy;
      this.logger.log(`[${job.id}] POLICY HEAL: Using library default policy: ${newPolicy.name}`);
    }
    // Priority 2: Any policy assigned to this library
    else if (library?.policies && library.policies.length > 0) {
      newPolicy = library.policies[0];
      this.logger.log(`[${job.id}] POLICY HEAL: Using library's first policy: ${newPolicy.name}`);
    }
    // Priority 3: First available policy in system
    else {
      const allPolicies = await this.policyRepository.findAll();
      newPolicy = allPolicies[0] ?? null;
      if (newPolicy) {
        this.logger.log(`[${job.id}] POLICY HEAL: Using system's first policy: ${newPolicy.name}`);
      }
    }

    // If no policy found anywhere, this is a critical configuration issue
    if (!newPolicy) {
      throw new Error(
        `No policies available to assign to job ${job.id}. ` +
          `Please create at least one encoding policy.`
      );
    }

    // Update job with new policy and matching targetCodec
    const updatedJob = await this.jobRepository.updateByIdWithInclude<JobWithPolicy>(
      job.id,
      { policyId: newPolicy.id, targetCodec: newPolicy.targetCodec },
      { policy: true }
    );

    this.logger.log(
      `[${job.id}] POLICY HEAL: Job updated - policy: ${newPolicy.name}, codec: ${newPolicy.targetCodec}`
    );

    return updatedJob as JobWithPolicy;
  }
}
