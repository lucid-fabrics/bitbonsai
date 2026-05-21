import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ContentFingerprintService } from '../../core/services/content-fingerprint.service';
import { PreflightService } from '../../encoding/services/preflight.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateJobDto } from '../dto/create-job.dto';
import { FileFailureTrackingService } from './file-failure-tracking.service';

/**
 * JobCreationValidatorService
 *
 * Runs the pre-creation validation pipeline before a new job is inserted:
 * 1. Pre-flight file integrity check (ffprobe)
 * 2. Content fingerprint deduplication (already-processed files)
 * 3. Failure / blacklist history check
 *
 * Returns the computed fingerprint so the caller can persist it on the job row.
 */
@Injectable()
export class JobCreationValidatorService {
  private readonly logger = new Logger(JobCreationValidatorService.name);

  constructor(
    private readonly preflight: PreflightService,
    private readonly contentFingerprint: ContentFingerprintService,
    private readonly fileFailureTracking: FileFailureTrackingService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Validate a file before a job is created.
   *
   * @throws BadRequestException if any check fails
   * @returns the content fingerprint (or null if fingerprinting is unavailable)
   */
  async validate(
    dto: Pick<CreateJobDto, 'filePath' | 'fileLabel' | 'libraryId'>
  ): Promise<{ fingerprint: string | null }> {
    const { filePath, fileLabel, libraryId } = dto;

    // Pre-flight: validate file integrity before queuing
    const preflightResult = await this.preflight.runPreflight(filePath);
    if (!preflightResult.ok) {
      this.logger.warn(`Pre-flight failed for ${filePath}: ${preflightResult.reason}`);
      await this.fileFailureTracking.recordFailure(filePath, libraryId, preflightResult.reason);
      throw new BadRequestException(`File failed pre-flight validation: ${preflightResult.reason}`);
    }

    // Compute content fingerprint and check for already-processed / blacklisted files
    let fingerprint: string | null = null;
    try {
      fingerprint = await this.contentFingerprint.computeFingerprint(filePath);

      if (fingerprint) {
        const alreadyProcessed = await this.prisma.processedFileRecord.findUnique({
          where: { contentFingerprint: fingerprint },
        });

        if (alreadyProcessed) {
          this.logger.log(
            `Skipping already-processed file (fingerprint match): ${fileLabel} ` +
              `(previously completed as ${alreadyProcessed.filePath})`
          );
          throw new BadRequestException(
            `File content already encoded (previously processed as "${alreadyProcessed.filePath}"). Skipping duplicate.`
          );
        }

        const isBlacklistedByHash = await this.fileFailureTracking.isBlacklisted(
          filePath,
          libraryId,
          fingerprint
        );

        if (isBlacklistedByHash) {
          this.logger.debug(`Skipping auto-blacklisted file (fingerprint match): ${fileLabel}`);
          throw new BadRequestException(
            'File content is auto-blacklisted due to repeated failures across jobs.'
          );
        }
      }
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Non-critical: fingerprinting failure should not block job creation
      this.logger.warn(
        `Fingerprint computation failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return { fingerprint };
  }
}
