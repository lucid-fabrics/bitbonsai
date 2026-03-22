import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { Job, Policy } from '@prisma/client';
import { JobRepository } from '../common/repositories/job.repository';
import { SettingsRepository } from '../common/repositories/settings.repository';
import { FileRelocatorService } from '../core/services/file-relocator.service';
import { LibrariesService } from '../libraries/libraries.service';
import { QueueService } from '../queue/queue.service';
import { EncodingFileReplacementService } from './encoding-file-replacement.service';
import { EncodingOutputVerificationService } from './encoding-output-verification.service';
import { FfmpegService } from './ffmpeg.service';
import { QualityMetricsService } from './quality-metrics.service';
import { SystemResourceService } from './system-resource.service';

export interface JobWithPolicy extends Job {
  policy?: Policy;
}

export interface JobResult {
  beforeSizeBytes: bigint;
  afterSizeBytes: bigint;
  savedBytes: bigint;
  savedPercent: number;
}

// Constants
const TEMP_FILE_CHECK_DELAY_MS = 2000;
const TEMP_FILE_MAX_RETRIES = 10;

/**
 * EncodingFileService
 *
 * Handles file-level encoding operations: encoding, verification,
 * validation, atomic replacement, and library stats updates.
 * Extracted from EncodingProcessorService to separate concerns.
 */
@Injectable()
export class EncodingFileService {
  public readonly logger = new Logger(EncodingFileService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly settingsRepository: SettingsRepository,
    private readonly ffmpegService: FfmpegService,
    private readonly librariesService: LibrariesService,
    readonly _fileRelocatorService: FileRelocatorService,
    private readonly systemResourceService: SystemResourceService,
    private readonly queueService: QueueService,
    private readonly qualityMetricsService: QualityMetricsService,
    readonly fileReplacement: EncodingFileReplacementService,
    readonly outputVerification: EncodingOutputVerificationService
  ) {}

  /**
   * Check if temp file exists with retry logic for NFS mount recovery
   */
  async checkTempFileWithRetry(tempFilePath: string | null): Promise<boolean> {
    if (!tempFilePath) {
      this.logger.log('  ℹ️  TRUE RESUME: No temp file path provided, skipping check');
      return false;
    }

    this.logger.log(`  🔍 TRUE RESUME: Checking if temp file exists: ${tempFilePath}`);

    for (let attempt = 1; attempt <= TEMP_FILE_MAX_RETRIES; attempt++) {
      try {
        if (fs.existsSync(tempFilePath)) {
          this.logger.log(
            `  ✅ TRUE RESUME: Temp file found on attempt ${attempt}/${TEMP_FILE_MAX_RETRIES}`
          );
          return true;
        }
        this.logger.log(
          `  ⏳ TRUE RESUME: Temp file not found (attempt ${attempt}/${TEMP_FILE_MAX_RETRIES}), retrying...`
        );
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `  ⚠️  TRUE RESUME: Error checking temp file (attempt ${attempt}/${TEMP_FILE_MAX_RETRIES}): ${errorMsg}`
        );
      }

      if (attempt < TEMP_FILE_MAX_RETRIES) {
        await this.sleep(TEMP_FILE_CHECK_DELAY_MS);
      }
    }

    this.logger.warn(
      `  ❌ TRUE RESUME: Temp file not found after ${TEMP_FILE_MAX_RETRIES} attempts - will restart from 0%`
    );
    return false;
  }

  /**
   * Encode a file according to its job policy
   */
  async encodeFile(job: JobWithPolicy): Promise<JobResult> {
    const beforeSizeBytes = BigInt(fs.statSync(job.filePath).size);

    // Create temporary output path
    // CRITICAL: Use stable temp filename (job.id only) so TRUE RESUME works across restarts
    const outputName = path.basename(job.filePath);

    // PERF: Use cache pool (SSD) for temp files if available, otherwise use source directory
    const tempBase = this.systemResourceService.getEncodingTempPath();
    const tmpPath = tempBase
      ? path.join(tempBase, `.${outputName}.tmp-${job.id}`)
      : path.join(path.dirname(job.filePath), `.${outputName}.tmp-${job.id}`);

    try {
      const policy = job.policy;
      if (!policy) {
        throw new Error('Job policy not loaded');
      }

      // TRUE RESUME: Save temp file path to database BEFORE encoding starts
      // This allows auto-heal to find the temp file after restart
      // MULTI-NODE: Use QueueService proxy to support LINKED nodes
      await this.queueService.update(job.id, { tempFilePath: tmpPath });

      // BULLETPROOF FIX: Validate temp file state BEFORE attempting resume
      // If tempFilePath is set but file doesn't exist, clear resume state and start fresh
      if (job.tempFilePath && !fs.existsSync(job.tempFilePath)) {
        this.logger.warn(
          `⚠️  TEMP FILE LOST: Job ${job.id} has tempFilePath="${job.tempFilePath}" but file doesn't exist. Clearing resume state and starting fresh.`
        );

        // Reset job to fresh QUEUED state
        // MULTI-NODE: Use QueueService proxy to support LINKED nodes
        await this.queueService.update(job.id, {
          tempFilePath: tmpPath, // Set new temp path
          resumeTimestamp: null,
          progress: 0,
          autoHealedAt: null,
          autoHealedProgress: null,
        });

        // Reload job with cleared state
        job.tempFilePath = tmpPath;
        job.resumeTimestamp = null;
        job.progress = 0;
      }

      // TRUE RESUME: Check if job has resume state from auto-heal
      let startedFromSeconds: number | undefined;

      if (job.progress > 0 && fs.existsSync(tmpPath) && job.resumeTimestamp) {
        this.logger.log(
          `  🔄 TRUE RESUME: Job has ${job.progress.toFixed(1)}% progress and resumeTimestamp=${job.resumeTimestamp}`
        );

        try {
          // Parse the HH:MM:SS format resumeTimestamp to seconds
          const parts = job.resumeTimestamp.split(':');
          if (parts.length === 3) {
            const hours = Number.parseInt(parts[0], 10);
            const minutes = Number.parseInt(parts[1], 10);
            const seconds = Number.parseFloat(parts[2]);
            startedFromSeconds = Math.floor(hours * 3600 + minutes * 60 + seconds);

            this.logger.log(
              `  ✅ TRUE RESUME: Using resumeTimestamp from auto-heal: ${job.resumeTimestamp} (${startedFromSeconds}s = ${job.progress.toFixed(1)}%)`
            );
          } else {
            this.logger.warn(
              `  ⚠️  TRUE RESUME: Invalid resumeTimestamp format: ${job.resumeTimestamp}`
            );
          }
        } catch (error: unknown) {
          this.logger.warn(`  ⚠️  TRUE RESUME: Error parsing resumeTimestamp:`, error);
          // Continue without resume - will restart from 0%
        }
      } else if (job.progress > 0 && fs.existsSync(tmpPath) && !job.resumeTimestamp) {
        // Fallback: Calculate resume position if temp file exists but no resumeTimestamp
        this.logger.log(
          `  🔄 TRUE RESUME: Job has ${job.progress.toFixed(1)}% progress but no resumeTimestamp, calculating...`
        );

        try {
          // Get video duration to calculate exact resume position
          const durationSeconds = await this.ffmpegService.getVideoDuration(job.filePath);

          if (durationSeconds > 0) {
            startedFromSeconds = Math.floor((job.progress / 100) * durationSeconds);

            // Convert seconds to HH:MM:SS format for resumeTimestamp field
            const hours = Math.floor(startedFromSeconds / 3600);
            const minutes = Math.floor((startedFromSeconds % 3600) / 60);
            const seconds = startedFromSeconds % 60;
            const resumeTimestamp = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

            // Update database with resume position (using existing resumeTimestamp field)
            // MULTI-NODE: Use QueueService proxy to support LINKED nodes
            await this.queueService.update(job.id, { resumeTimestamp });

            this.logger.log(
              `  ✅ TRUE RESUME: Calculated resumeTimestamp: ${resumeTimestamp} (${startedFromSeconds}s = ${job.progress.toFixed(1)}% of ${durationSeconds}s total)`
            );
          } else {
            this.logger.warn(
              `  ⚠️  TRUE RESUME: Could not determine video duration, starting from beginning`
            );
          }
        } catch (error: unknown) {
          this.logger.warn(`  ⚠️  TRUE RESUME: Error calculating resume position:`, error);
          // Continue without resume - will restart from 0%
        }
      }

      // CRITICAL: Get original duration BEFORE encoding for validation
      const originalDuration = await this.ffmpegService.getVideoDuration(job.filePath);
      this.logger.log(`Original file duration: ${originalDuration.toFixed(2)}s`);

      // Perform encoding
      await this.performEncoding(job, tmpPath, policy, startedFromSeconds);

      // Verify output if enabled
      if (policy.verifyOutput) {
        await this.outputVerification.verifyEncodedFile(tmpPath);
      }

      // CRITICAL FIX: Validate output duration matches original to prevent truncated files
      // This prevents catastrophic data loss from incomplete/interrupted encodings
      await this.outputVerification.validateOutputDuration(tmpPath, originalDuration, job.filePath);

      // Calculate file size changes
      const afterSizeBytes = BigInt(fs.statSync(tmpPath).size);
      const { savedBytes, savedPercent } = this.calculateSavings(beforeSizeBytes, afterSizeBytes);

      // CRITICAL FIX: Size sanity check - encoded file shouldn't be suspiciously small
      // This catches edge cases where duration might pass but file is clearly incomplete
      this.validateOutputSize(beforeSizeBytes, afterSizeBytes, originalDuration, job.filePath);

      // AUDIT FIX: Capture file stats for integrity check before replacement
      // This detects if file was modified between validation and replacement (race condition)
      const preReplaceStats = fs.statSync(tmpPath);
      const preReplaceMtime = preReplaceStats.mtimeMs;
      const preReplaceSize = preReplaceStats.size;

      // HIGH PRIORITY FIX: Verify disk space before atomic replacement
      // During atomic replacement, we temporarily have BOTH original + encoded file
      // So we need space for both files simultaneously
      await this.fileReplacement.verifyDiskSpaceForReplacement(
        job.filePath,
        tmpPath,
        beforeSizeBytes,
        afterSizeBytes
      );

      // AUDIT FIX: Verify file wasn't modified during disk space check (race condition protection)
      const postCheckStats = fs.statSync(tmpPath);
      if (postCheckStats.mtimeMs !== preReplaceMtime || postCheckStats.size !== preReplaceSize) {
        throw new Error(
          `CRITICAL: Temp file was modified between validation and replacement!\n` +
            `Before: mtime=${preReplaceMtime}, size=${preReplaceSize}\n` +
            `After: mtime=${postCheckStats.mtimeMs}, size=${postCheckStats.size}\n` +
            `This could indicate file corruption or a race condition.\n` +
            `The original file will NOT be replaced to prevent data loss.`
        );
      }

      // Calculate quality metrics if enabled (before replacement, while both files exist)
      await this.calculateQualityMetricsIfEnabled(job, job.filePath, tmpPath);

      // Replace original file with encoded version (with Keep Original support)
      await this.fileReplacement.replaceFile(job, tmpPath, policy.atomicReplace);

      return {
        beforeSizeBytes,
        afterSizeBytes,
        savedBytes,
        savedPercent,
      };
    } catch (error: unknown) {
      // TRUE RESUME: Only delete temp file on validation/corruption errors
      // Keep temp file for resumable errors (interrupts, crashes, EXDEV, etc.)
      const errorMessage = error instanceof Error ? error.message : String(error);
      // AUDIT FIX: Added validation error patterns to ensure temp files are cleaned up
      const isCorruptionError =
        errorMessage.includes('verification failed') ||
        errorMessage.includes('corrupted') ||
        errorMessage.includes('not playable') ||
        errorMessage.includes('invalid') ||
        errorMessage.includes('duration mismatch') ||
        errorMessage.includes('appears truncated') ||
        errorMessage.includes('suspiciously small') ||
        errorMessage.includes('Cannot determine output file duration');

      if (isCorruptionError) {
        this.logger.warn(`Temp file corrupted or invalid, deleting for fresh restart: ${tmpPath}`);
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } else {
        this.logger.log(`Keeping temp file for auto-heal resume capability: ${tmpPath}`);
      }
      throw error;
    } finally {
      // MEMORY LEAK FIX: Always clean up temp files that aren't needed for resume
      // Only skip cleanup if this is a resumable error AND temp file should be preserved
      // This prevents disk space leaks from failed encodings
      if (tmpPath && fs.existsSync(tmpPath)) {
        // Check if temp file should be preserved for resume (only for encoding failures)
        const shouldPreserve = job.tempFilePath === tmpPath && job.progress > 0;

        if (!shouldPreserve) {
          try {
            fs.unlinkSync(tmpPath);
            this.logger.debug(`Cleaned up temp file: ${tmpPath}`);
          } catch (cleanupError: unknown) {
            this.logger.warn(`Failed to clean temp file ${tmpPath}:`, cleanupError);
          }
        }
      }
    }
  }

  /**
   * Perform FFmpeg encoding on a file
   */
  async performEncoding(
    job: JobWithPolicy,
    tmpPath: string,
    policy: JobWithPolicy['policy'],
    startedFromSeconds?: number
  ): Promise<void> {
    if (!policy) {
      throw new Error('Policy is required for encoding');
    }

    const advancedSettings = policy.advancedSettings as Record<string, unknown> | null;
    const hwaccel =
      advancedSettings && typeof advancedSettings === 'object' && 'hwaccel' in advancedSettings
        ? String(advancedSettings.hwaccel)
        : 'auto';

    await this.ffmpegService.encode(job.id, {
      inputPath: job.filePath,
      outputPath: tmpPath,
      targetCodec: policy.targetCodec,
      targetQuality: policy.targetQuality,
      hwAccel: hwaccel,
      advancedSettings: advancedSettings ?? undefined,
      startedFromSeconds, // TRUE RESUME: Pass resume position to FFmpeg
    });
  }

  /**
   * Sleep helper for retries and delays
   */
  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculate space savings from encoding
   */
  calculateSavings(
    beforeSizeBytes: bigint,
    afterSizeBytes: bigint
  ): { savedBytes: bigint; savedPercent: number } {
    const savedBytes = beforeSizeBytes - afterSizeBytes;
    const savedPercent = Number((savedBytes * BigInt(10000)) / beforeSizeBytes) / 100;
    return { savedBytes, savedPercent };
  }

  /**
   * AUDIT FIX: Get adaptive duration tolerance based on file length
   */
  getAdaptiveDurationTolerance(durationSeconds: number): number {
    return this.outputVerification.getAdaptiveDurationTolerance(durationSeconds);
  }

  // ── Delegations to extracted services (kept for backward-compat with callers/tests) ──

  async verifyEncodedFile(tmpPath: string): Promise<void> {
    return this.outputVerification.verifyEncodedFile(tmpPath);
  }

  async validateOutputDuration(
    outputPath: string,
    originalDuration: number,
    originalPath: string
  ): Promise<void> {
    return this.outputVerification.validateOutputDuration(
      outputPath,
      originalDuration,
      originalPath
    );
  }

  async verifyDiskSpaceForReplacement(
    originalPath: string,
    tmpPath: string,
    originalSize: bigint,
    tmpSize: bigint
  ): Promise<void> {
    return this.fileReplacement.verifyDiskSpaceForReplacement(
      originalPath,
      tmpPath,
      originalSize,
      tmpSize
    );
  }

  crossFsSafeRenameSync(sourcePath: string, destPath: string): void {
    this.fileReplacement.crossFsSafeRenameSync(sourcePath, destPath);
  }

  async atomicReplaceFileWithVerification(originalPath: string, tmpPath: string): Promise<void> {
    return this.fileReplacement.atomicReplaceFileWithVerification(originalPath, tmpPath);
  }

  async replaceFile(job: JobWithPolicy, tmpPath: string, atomicReplace: boolean): Promise<void> {
    return this.fileReplacement.replaceFile(job, tmpPath, atomicReplace);
  }

  /**
   * CRITICAL FIX: Validate output file size is not suspiciously small
   *
   * @param beforeSizeBytes - Original file size
   * @param afterSizeBytes - Encoded file size
   * @param durationSeconds - Video duration in seconds
   * @param filePath - Path to file (for error messages)
   * @throws Error if file size is suspiciously small
   */
  validateOutputSize(
    beforeSizeBytes: bigint,
    afterSizeBytes: bigint,
    durationSeconds: number,
    filePath: string
  ): void {
    // AUDIT FIX: Use bigint throughout to prevent precision loss on huge files (>9PB)
    // Calculate minimum reasonable size based on duration
    // Minimum bitrate: 200kbps (absolute floor for any watchable video)
    // Formula: size_bytes = bitrate_bps * duration_seconds / 8
    const minBitrateKbps = 200n;
    const durationBigInt = BigInt(Math.floor(durationSeconds));
    const minReasonableBytes = (minBitrateKbps * 1000n * durationBigInt) / 8n;

    if (afterSizeBytes < minReasonableBytes) {
      // Convert to Number only for display formatting (safe for display purposes)
      const afterSizeMB = Number(afterSizeBytes / 1024n / 1024n);
      const minSizeMB = Number(minReasonableBytes / 1024n / 1024n);
      const beforeSizeMB = Number(beforeSizeBytes / 1024n / 1024n);

      const errorMsg =
        `CRITICAL: Output file size is suspiciously small!\n\n` +
        `Original size: ${beforeSizeMB.toFixed(2)} MB\n` +
        `Output size: ${afterSizeMB.toFixed(2)} MB\n` +
        `Minimum expected: ${minSizeMB.toFixed(2)} MB (for ${durationSeconds.toFixed(0)}s @ ${minBitrateKbps}kbps)\n\n` +
        `The output file is smaller than any reasonable encoding could produce.\n` +
        `This usually indicates a corrupted or incomplete file.\n` +
        `The original file will NOT be replaced to prevent data loss.\n\n` +
        `File: ${filePath}`;

      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Also check for extreme compression (>95% reduction is suspicious for video)
    // Normal HEVC encoding typically saves 30-70%, not 95%+
    // AUDIT FIX: Use bigint for all comparisons to prevent precision loss
    const savedBytes = beforeSizeBytes - afterSizeBytes;
    const reductionPercent =
      beforeSizeBytes > 0n ? Number((savedBytes * 100n) / beforeSizeBytes) : 0;
    const hundredMB = 100n * 1024n * 1024n;
    const oneGB = 1024n * 1024n * 1024n;

    // AUDIT FIX: Block extreme compression (was just warning before)
    // 95%+ reduction with output <100MB and original >1GB is almost always corruption
    if (reductionPercent > 95 && afterSizeBytes < hundredMB && beforeSizeBytes > oneGB) {
      const afterSizeMB = Number(afterSizeBytes / 1024n / 1024n);
      const beforeSizeMB = Number(beforeSizeBytes / 1024n / 1024n);

      const errorMsg =
        `CRITICAL: Extreme compression detected - likely corruption!\n\n` +
        `Original size: ${beforeSizeMB.toFixed(2)} MB\n` +
        `Output size: ${afterSizeMB.toFixed(2)} MB\n` +
        `Reduction: ${reductionPercent.toFixed(1)}%\n\n` +
        `A ${reductionPercent.toFixed(0)}% reduction from ${beforeSizeMB.toFixed(0)}MB to ${afterSizeMB.toFixed(0)}MB ` +
        `is not possible with legitimate encoding.\n` +
        `This usually indicates the output file is corrupted or incomplete.\n` +
        `The original file will NOT be replaced to prevent data loss.\n\n` +
        `File: ${filePath}`;

      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Warn (but allow) for edge cases: small files or moderate compression
    if (reductionPercent > 90 && afterSizeBytes < hundredMB) {
      const afterSizeMB = Number(afterSizeBytes / 1024n / 1024n);
      const beforeSizeMB = Number(beforeSizeBytes / 1024n / 1024n);

      this.logger.warn(
        `⚠️  High compression detected: ${beforeSizeMB.toFixed(2)}MB → ${afterSizeMB.toFixed(2)}MB ` +
          `(${reductionPercent.toFixed(1)}% reduction). File: ${filePath}`
      );
    }
  }

  private async calculateQualityMetricsIfEnabled(
    job: JobWithPolicy,
    originalPath: string,
    encodedPath: string
  ): Promise<void> {
    try {
      const settings = await this.settingsRepository.findFirst();
      if (!settings?.qualityMetricsEnabled) return;

      this.logger.log(`Calculating quality metrics for job ${job.id}...`);
      const metrics = await this.qualityMetricsService.calculateAllQualityMetrics(
        originalPath,
        encodedPath
      );

      await this.jobRepository.updateById(job.id, {
        qualityMetrics: {
          vmaf: metrics.vmaf,
          psnr: metrics.psnr,
          ssim: metrics.ssim,
        },
        qualityMetricsAt: metrics.calculatedAt,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Quality metrics calculation failed for job ${job.id}, continuing: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async updateLibraryStats(libraryId: string, savedBytes: bigint): Promise<void> {
    try {
      const library = await this.librariesService.findOne(libraryId);

      // Calculate new total size
      const newTotalSize = library.totalSizeBytes - savedBytes;

      await this.librariesService.update(libraryId, {
        totalSizeBytes: newTotalSize,
      });
    } catch (error: unknown) {
      this.logger.error(`Failed to update library stats for ${libraryId}:`, error);
      // Don't throw - library stats update failure shouldn't fail job
    }
  }
}
