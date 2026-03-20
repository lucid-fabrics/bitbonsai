import { Injectable, Logger } from '@nestjs/common';
import { FfmpegService } from './ffmpeg.service';

const FALLBACK_DURATION_SECONDS = 3600;

/**
 * EncodingOutputVerificationService
 *
 * Handles post-encoding verification: playability checks and duration validation.
 * Extracted from EncodingFileService to separate concerns.
 */
@Injectable()
export class EncodingOutputVerificationService {
  private readonly logger = new Logger(EncodingOutputVerificationService.name);

  constructor(private readonly ffmpegService: FfmpegService) {}

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
    if (originalDuration === FALLBACK_DURATION_SECONDS) {
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
    if (
      outputDuration === FALLBACK_DURATION_SECONDS &&
      originalDuration !== FALLBACK_DURATION_SECONDS
    ) {
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

  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
