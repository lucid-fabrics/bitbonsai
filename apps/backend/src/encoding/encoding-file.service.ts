import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { Job, Policy } from '@prisma/client';
import { FileRelocatorService } from '../core/services/file-relocator.service';
import { LibrariesService } from '../libraries/libraries.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { FfmpegService } from './ffmpeg.service';
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
  private readonly logger = new Logger(EncodingFileService.name);

  constructor(
    readonly _prisma: PrismaService,
    private readonly ffmpegService: FfmpegService,
    private readonly librariesService: LibrariesService,
    readonly _fileRelocatorService: FileRelocatorService,
    private readonly systemResourceService: SystemResourceService,
    private readonly queueService: QueueService
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
      } catch (error) {
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
        } catch (error) {
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
        } catch (error) {
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
        await this.verifyEncodedFile(tmpPath);
      }

      // CRITICAL FIX: Validate output duration matches original to prevent truncated files
      // This prevents catastrophic data loss from incomplete/interrupted encodings
      await this.validateOutputDuration(tmpPath, originalDuration, job.filePath);

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
      await this.verifyDiskSpaceForReplacement(
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

      // Replace original file with encoded version (with Keep Original support)
      await this.replaceFile(job, tmpPath, policy.atomicReplace);

      return {
        beforeSizeBytes,
        afterSizeBytes,
        savedBytes,
        savedPercent,
      };
    } catch (error) {
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
          } catch (cleanupError) {
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
   * Verify encoded file is playable WITH ROCK SOLID RETRIES
   */
  async verifyEncodedFile(tmpPath: string): Promise<void> {
    this.logger.log(
      `ROCK SOLID: Waiting 5 seconds for filesystem flush after FFmpeg completion...`
    );
    await this.sleep(5000);

    // ROCK SOLID: Retry verification with exponential backoff (max 10 attempts)
    const maxRetries = 10;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.ffmpegService.verifyFile(tmpPath);

      if (result.isValid) {
        if (attempt > 1) {
          this.logger.log(`✓ ROCK SOLID: File verified successfully after ${attempt} attempt(s)`);
        }
        return; // Success!
      }

      // File verification failed
      if (attempt < maxRetries) {
        const backoffMs = Math.min(2000 * 2 ** (attempt - 1), 32000);
        this.logger.warn(
          `ROCK SOLID: Verification attempt ${attempt}/${maxRetries} failed: ${result.error}. ` +
            `Retrying in ${backoffMs}ms...`
        );
        await this.sleep(backoffMs);
      } else {
        // Final attempt failed
        throw new Error(
          `ROCK SOLID: Verification failed after ${maxRetries} attempts. Last error: ${result.error || 'File is not playable'}`
        );
      }
    }
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
   * CRITICAL FIX: Validate output duration matches original to prevent truncated files
   *
   * This is a critical safety check that prevents catastrophic data loss from:
   * - Interrupted encodings (OOM, crash, node failure)
   * - FFmpeg errors that produce partial output
   * - NFS/filesystem issues during encoding
   *
   * @param outputPath - Path to the encoded output file
   * @param originalDuration - Duration of the original file in seconds
   * @param originalPath - Path to original file (for error messages)
   * @throws Error if duration mismatch exceeds tolerance
   */
  async validateOutputDuration(
    outputPath: string,
    originalDuration: number,
    originalPath: string
  ): Promise<void> {
    // AUDIT FIX: Reject if original duration is the 3600s fallback value
    // This indicates ffprobe failed - we can't safely validate
    if (originalDuration === 3600) {
      this.logger.warn(
        `Original duration is exactly 3600s (ffprobe fallback value). ` +
          `This may indicate ffprobe failed. Proceeding with caution.`
      );
      // Don't skip - still validate, but log the warning
    }

    // P2 FIX: Lowered threshold from 5s to 1s with absolute tolerance
    // Very short clips (<1s) skip validation - can't reliably measure
    // Clips 1-60s use absolute tolerance (±1s) instead of percentage
    if (originalDuration < 1) {
      this.logger.log(
        `Skipping duration validation for sub-second clip (${originalDuration.toFixed(2)}s)`
      );
      return;
    }

    // AUDIT FIX: Add NFS flush delay before reading output duration
    // NFS cache could return stale data for recently written files
    await this.sleep(2000);

    const outputDuration = await this.ffmpegService.getVideoDuration(outputPath);

    // AUDIT FIX: Reject if output duration is the 3600s fallback value
    // This indicates ffprobe failed on output - file may be corrupt
    if (outputDuration === 3600 && originalDuration !== 3600) {
      throw new Error(
        `CRITICAL: Cannot determine output file duration (ffprobe returned fallback value).\n` +
          `This usually means the output file is corrupt or incomplete.\n` +
          `The original file will NOT be replaced to prevent data loss.\n\n` +
          `File: ${originalPath}`
      );
    }

    // Calculate duration difference
    const durationDiff = Math.abs(outputDuration - originalDuration);
    const durationDiffPercent = (durationDiff / originalDuration) * 100;

    // P2 FIX: Use absolute tolerance for short files (1-60s), percentage for longer
    // Short files: ±1s absolute (keyframe alignment can shift by ~1s)
    // Longer files: adaptive percentage (prevents losing content)
    const useAbsoluteTolerance = originalDuration <= 60;
    const absoluteToleranceSeconds = 1.0; // ±1 second for short clips
    const tolerancePercent = this.getAdaptiveDurationTolerance(originalDuration);

    const toleranceExceeded = useAbsoluteTolerance
      ? durationDiff > absoluteToleranceSeconds
      : durationDiffPercent > tolerancePercent;

    if (toleranceExceeded) {
      // Format durations for human-readable error message
      const formatDuration = (seconds: number): string => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
      };

      // P2 FIX: Show correct tolerance in error message (absolute vs percentage)
      const toleranceStr = useAbsoluteTolerance
        ? `${durationDiff.toFixed(2)}s (tolerance: ±${absoluteToleranceSeconds}s)`
        : `${durationDiffPercent.toFixed(1)}% (tolerance: ${tolerancePercent}%)`;

      const errorMsg =
        `CRITICAL: Output file duration mismatch - encoding appears truncated!\n\n` +
        `Original: ${formatDuration(originalDuration)} (${originalDuration.toFixed(2)}s)\n` +
        `Output: ${formatDuration(outputDuration)} (${outputDuration.toFixed(2)}s)\n` +
        `Difference: ${toleranceStr}\n\n` +
        `This usually means the encoding was interrupted or failed partway through.\n` +
        `The original file will NOT be replaced to prevent data loss.\n\n` +
        `File: ${originalPath}`;

      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // P2 FIX: Show correct tolerance in success log
    const toleranceLogStr = useAbsoluteTolerance
      ? `diff=${durationDiff.toFixed(2)}s (tolerance=±${absoluteToleranceSeconds}s)`
      : `diff=${durationDiffPercent.toFixed(1)}% (tolerance=${tolerancePercent}%)`;

    this.logger.log(
      `✓ Duration validation passed: output=${outputDuration.toFixed(2)}s, ` +
        `original=${originalDuration.toFixed(2)}s, ${toleranceLogStr}`
    );
  }

  /**
   * AUDIT FIX: Get adaptive duration tolerance based on file length
   *
   * Shorter files can have more variance due to keyframe alignment.
   * Longer files should have tighter tolerance to prevent losing content.
   *
   * @param durationSeconds - Video duration in seconds
   * @returns Tolerance percentage
   */
  getAdaptiveDurationTolerance(durationSeconds: number): number {
    if (durationSeconds < 300) return 5.0; // <5 min: 5% (up to 15s variance)
    if (durationSeconds < 1800) return 3.0; // <30 min: 3% (up to 54s variance)
    if (durationSeconds < 3600) return 2.0; // <1 hr: 2% (up to 72s variance)
    if (durationSeconds < 7200) return 1.5; // <2 hr: 1.5% (up to 108s variance)
    return 1.0; // ≥2 hr: 1% (up to 72s for 2hr, 108s for 3hr)
  }

  /**
   * CRITICAL FIX: Validate output file size is not suspiciously small
   *
   * This is a secondary safety check that catches edge cases where:
   * - Duration validation might pass (e.g., corrupted metadata)
   * - But the file is clearly incomplete based on size
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

  /**
   * HIGH PRIORITY FIX: Verify disk space before atomic replacement
   *
   * During atomic replacement, we temporarily have BOTH files:
   * 1. Original file renamed to .backup
   * 2. Temp file renamed to original location
   * 3. Backup deleted
   *
   * We need enough space for both original + temp file simultaneously.
   */
  async verifyDiskSpaceForReplacement(
    originalPath: string,
    tmpPath: string,
    originalSize: bigint,
    tmpSize: bigint
  ): Promise<void> {
    const outputDir = path.dirname(originalPath);

    try {
      const stats = await fs.promises.statfs(outputDir);
      const availableBytes = stats.bavail * stats.bsize;
      const availableGB = availableBytes / 1024 ** 3;

      // Calculate space needed for atomic replacement
      // We need space for BOTH files temporarily (during rename operations)
      const spaceNeededBytes = Number(originalSize) + Number(tmpSize);

      // Add 1GB safety buffer
      const requiredBytes = spaceNeededBytes + 1024 ** 3;
      const requiredGB = requiredBytes / 1024 ** 3;

      if (availableBytes < requiredBytes) {
        throw new Error(
          `Insufficient disk space for atomic file replacement on ${outputDir}\n\n` +
            `Available: ${availableGB.toFixed(2)} GB\n` +
            `Required: ${requiredGB.toFixed(2)} GB (original + encoded + 1GB safety buffer)\n` +
            `Original file: ${(Number(originalSize) / 1024 ** 3).toFixed(2)} GB\n` +
            `Encoded file: ${(Number(tmpSize) / 1024 ** 3).toFixed(2)} GB\n\n` +
            `During atomic replacement, both files exist temporarily.\n` +
            `Please free up disk space before retrying this job.`
        );
      }

      this.logger.log(
        `Disk space check passed: ${availableGB.toFixed(2)}GB available, ` +
          `${requiredGB.toFixed(2)}GB needed for atomic replacement`
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('Insufficient disk space')) {
        throw error; // Re-throw our custom error
      }
      // If statfs fails, log warning but don't fail the job
      this.logger.warn(`Could not check disk space for replacement on ${outputDir}: ${error}`);
    }
  }

  /**
   * Replace original file with encoded version
   *
   * KEEP ORIGINAL FEATURE: If user requested to keep original via "Keep Original" button,
   * rename original to .original instead of deleting it
   */
  async replaceFile(job: JobWithPolicy, tmpPath: string, atomicReplace: boolean): Promise<void> {
    const originalPath = job.filePath;

    // KEEP ORIGINAL FEATURE: Check if user requested to keep the original file
    if (job.keepOriginalRequested) {
      // User clicked "Keep Original" - rename original to .original and keep both files
      const originalBackupPath = `${originalPath}.original`;

      this.logger.log(`KEEP ORIGINAL: Renaming original to ${originalBackupPath}`);
      this.crossFsSafeRenameSync(originalPath, originalBackupPath);
      this.crossFsSafeRenameSync(tmpPath, originalPath);

      // AUDIT FIX: Post-replacement smoke test - verify the new file is playable
      // If verification fails, rollback to original
      // AUDIT FIX: Add NFS flush delay to ensure we read actual disk data, not cached
      await this.sleep(2000);
      const smokeTest = await this.ffmpegService.verifyFile(originalPath);
      if (!smokeTest.isValid) {
        this.logger.error(
          `KEEP ORIGINAL: Post-replacement verification FAILED! Rolling back. Error: ${smokeTest.error}`
        );

        // Rollback: restore original from backup
        try {
          if (fs.existsSync(originalPath)) {
            fs.unlinkSync(originalPath); // Delete failed encoded file
          }
          this.crossFsSafeRenameSync(originalBackupPath, originalPath);
          this.logger.log(`KEEP ORIGINAL: Successfully rolled back to original`);
        } catch (_rollbackError) {
          this.logger.error(`KEEP ORIGINAL: Rollback failed! Backup at: ${originalBackupPath}`);
        }

        throw new Error(
          `Post-replacement verification failed: ${smokeTest.error}. Original restored from backup.`
        );
      }

      // Update job with backup info
      await this.queueService.update(job.id, {
        originalBackupPath,
        originalSizeBytes: job.beforeSizeBytes,
        replacementAction: 'KEPT_BOTH',
      });

      this.logger.log(`KEEP ORIGINAL: Successfully kept original as backup (verified playable)`);
    } else {
      // Default behavior: replace original file (delete it)
      if (atomicReplace) {
        // atomicReplaceFile keeps a .backup until verified
        await this.atomicReplaceFileWithVerification(originalPath, tmpPath);
      } else {
        // AUDIT FIX: Non-atomic mode is dangerous - log warning
        this.logger.warn(
          `⚠️  Using non-atomic replace mode - original will be deleted before verification!\n` +
            `If smoke test fails, data loss is possible. Consider enabling atomic replace.\n` +
            `File: ${originalPath}`
        );

        this.crossFsSafeRenameSync(tmpPath, originalPath);

        // AUDIT FIX: Post-replacement smoke test for non-atomic replace
        // Note: original is gone, so we can only warn - can't rollback
        // AUDIT FIX: Add NFS flush delay to ensure we read actual disk data
        await this.sleep(2000);
        const smokeTest = await this.ffmpegService.verifyFile(originalPath);
        if (!smokeTest.isValid) {
          this.logger.error(
            `⚠️  CRITICAL: Post-replacement verification FAILED (non-atomic mode)!\n` +
              `Original file is GONE. Encoded file may be corrupt.\n` +
              `Error: ${smokeTest.error}\n` +
              `File: ${originalPath}`
          );
          // Don't throw - file is already replaced, nothing to rollback to
          // User will see the error in job status
        }
      }

      // Mark as replaced
      await this.queueService.update(job.id, {
        replacementAction: 'REPLACED',
      });

      this.logger.log('Original file replaced with encoded version');
    }
  }

  /**
   * Cross-filesystem-safe rename operation
   *
   * CRITICAL FIX: Handle EXDEV error when renaming across different filesystems
   *
   * Node.js fs.rename() uses the POSIX rename() system call which only works
   * within the same filesystem. When source and dest are on different filesystems
   * (e.g., /cache SSD and /unraid-media array), rename() fails with EXDEV error.
   *
   * This helper automatically falls back to copy+delete when rename fails with EXDEV.
   *
   * @param sourcePath - Source file path
   * @param destPath - Destination file path
   */
  crossFsSafeRenameSync(sourcePath: string, destPath: string): void {
    try {
      // Attempt fast rename (works if same filesystem)
      fs.renameSync(sourcePath, destPath);
    } catch (error) {
      // Check if error is EXDEV (cross-device link not permitted)
      if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
        this.logger.warn(
          `Cross-filesystem rename detected (${sourcePath} -> ${destPath}), ` +
            `falling back to copy+delete`
        );

        try {
          // AUDIT FIX: Get source size BEFORE copy for verification
          const sourceStats = fs.statSync(sourcePath);
          const sourceSize = sourceStats.size;

          // Fallback: Copy file to destination
          fs.copyFileSync(sourcePath, destPath);

          // AUDIT FIX: Verify copy succeeded by checking BOTH existence AND size
          // This catches partial copies from disk-full or interrupted operations
          if (!fs.existsSync(destPath)) {
            throw new Error('Copy verification failed - destination file does not exist');
          }

          const destStats = fs.statSync(destPath);
          if (destStats.size !== sourceSize) {
            // Clean up partial copy
            try {
              fs.unlinkSync(destPath);
            } catch {
              // Ignore cleanup error
            }
            throw new Error(
              `Copy verification failed - size mismatch!\n` +
                `Source: ${sourceSize} bytes\n` +
                `Dest: ${destStats.size} bytes\n` +
                `This usually indicates disk full or interrupted copy.`
            );
          }

          // Delete source file only after successful verified copy
          fs.unlinkSync(sourcePath);

          this.logger.log(
            `Successfully moved file across filesystems: ${sourcePath} -> ${destPath} (${sourceSize} bytes verified)`
          );
        } catch (fallbackError) {
          // Clean up partial copy if it exists
          if (fs.existsSync(destPath)) {
            try {
              fs.unlinkSync(destPath);
            } catch (cleanupError) {
              this.logger.error(`Failed to cleanup partial copy: ${cleanupError}`);
            }
          }

          throw new Error(
            `Cross-filesystem move failed: ${fallbackError}. Source: ${sourcePath}, Dest: ${destPath}`
          );
        }
      } else {
        // Re-throw non-EXDEV errors
        throw error;
      }
    }
  }

  /**
   * AUDIT FIX: Atomically replace file with verification and rollback on failure
   *
   * This enhanced version keeps the backup UNTIL the new file is verified playable.
   * If verification fails, it automatically rolls back to the original.
   */
  async atomicReplaceFileWithVerification(originalPath: string, tmpPath: string): Promise<void> {
    const backupPath = `${originalPath}.backup`;

    try {
      // Step 1: Create backup of original file
      this.crossFsSafeRenameSync(originalPath, backupPath);

      // Step 2: Move temp file to original location
      this.crossFsSafeRenameSync(tmpPath, originalPath);

      // Step 3: AUDIT FIX - Verify the new file is playable BEFORE deleting backup
      // AUDIT FIX: Add NFS flush delay to ensure we read actual disk data, not cached
      await this.sleep(2000);
      const smokeTest = await this.ffmpegService.verifyFile(originalPath);
      if (!smokeTest.isValid) {
        this.logger.error(
          `Post-replacement verification FAILED! Rolling back. Error: ${smokeTest.error}`
        );

        // Rollback: restore backup
        try {
          if (fs.existsSync(originalPath)) {
            fs.unlinkSync(originalPath); // Delete failed encoded file
          }
          this.crossFsSafeRenameSync(backupPath, originalPath);
          this.logger.log(`Successfully rolled back to backup for ${originalPath}`);
        } catch (rollbackError) {
          this.logger.error(`CRITICAL: Rollback failed! Backup at: ${backupPath}`);
          throw new Error(
            `Post-replacement verification failed AND rollback failed.\n` +
              `Verification error: ${smokeTest.error}\n` +
              `Rollback error: ${rollbackError}\n` +
              `Backup may still exist at: ${backupPath}`
          );
        }

        throw new Error(
          `Post-replacement verification failed: ${smokeTest.error}. Original restored from backup.`
        );
      }

      // Step 4: Delete backup only after successful verification
      try {
        fs.unlinkSync(backupPath);
      } catch (cleanupError) {
        // Non-fatal: Log warning but don't fail the operation
        this.logger.warn(`Failed to cleanup backup file ${backupPath}: ${cleanupError}`);
      }

      this.logger.log(`Atomic replacement complete with verification for ${originalPath}`);
    } catch (error) {
      // If backup exists and original doesn't, try to restore
      if (fs.existsSync(backupPath) && !fs.existsSync(originalPath)) {
        try {
          this.crossFsSafeRenameSync(backupPath, originalPath);
          this.logger.log(`Restored backup after error for ${originalPath}`);
        } catch (restoreError) {
          this.logger.error(`Failed to restore backup after error: ${restoreError}`);
        }
      }
      throw error;
    }
  }

  /**
   * Update library statistics after job completion
   *
   * @param libraryId - Library ID to update
   * @param savedBytes - Bytes saved by encoding
   */
  async updateLibraryStats(libraryId: string, savedBytes: bigint): Promise<void> {
    try {
      const library = await this.librariesService.findOne(libraryId);

      // Calculate new total size
      const newTotalSize = library.totalSizeBytes - savedBytes;

      await this.librariesService.update(libraryId, {
        totalSizeBytes: newTotalSize,
      });
    } catch (error) {
      this.logger.error(`Failed to update library stats for ${libraryId}:`, error);
      // Don't throw - library stats update failure shouldn't fail job
    }
  }
}
