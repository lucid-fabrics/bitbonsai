import { existsSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import { FfprobeService } from './ffprobe.service';

/**
 * FfmpegFileVerificationService
 *
 * Provides retry-based file existence and integrity verification utilities.
 * Used by FfmpegService after encoding completes to validate output before
 * atomic file replacement.
 *
 * Responsibilities:
 * - Waiting for files to appear on (potentially slow NFS) mounts
 * - Verifying encoded files are valid/playable with exponential backoff
 * - Sleep utility for retry loops
 */
@Injectable()
export class FfmpegFileVerificationService {
  private readonly logger = new Logger(FfmpegFileVerificationService.name);

  constructor(private readonly ffprobe: FfprobeService) {}

  /**
   * Sleep for specified milliseconds.
   */
  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Wait for file to exist with retries.
   * Handles NFS mount delays where files may not be immediately visible.
   *
   * @param filePath - Path to file
   * @param maxRetries - Maximum number of retries (default: 10)
   * @param delayMs - Delay between retries in milliseconds (default: 2000)
   * @returns true if file exists, false if all retries exhausted
   */
  async waitForFileExists(filePath: string, maxRetries = 10, delayMs = 2000): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (existsSync(filePath)) {
          if (attempt > 1) {
            this.logger.log(`✓ File exists after ${attempt} attempt(s): ${filePath}`);
          }
          return true;
        }

        if (attempt < maxRetries) {
          this.logger.warn(
            `File not found (attempt ${attempt}/${maxRetries}), waiting ${delayMs}ms before retry: ${filePath}`
          );
          await this.sleep(delayMs);
        }
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Error checking file existence (attempt ${attempt}/${maxRetries}): ${errorMsg}`
        );
        if (attempt < maxRetries) {
          await this.sleep(delayMs);
        }
      }
    }

    this.logger.error(
      `File does not exist after ${maxRetries} attempts (${(maxRetries * delayMs) / 1000}s total): ${filePath}`
    );
    return false;
  }

  /**
   * Verify file with retries using exponential backoff.
   *
   * @param filePath - Path to file to verify
   * @param maxRetries - Maximum number of retries (default: 10)
   * @returns Verification result with attempt count
   */
  async verifyFileWithRetries(
    filePath: string,
    maxRetries = 10
  ): Promise<{ isValid: boolean; error?: string; attempts: number }> {
    let lastError = '';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // First check: Does file exist?
        if (!existsSync(filePath)) {
          lastError = `File does not exist`;
          if (attempt < maxRetries) {
            this.logger.warn(
              `Verification attempt ${attempt}/${maxRetries}: File missing, waiting 2s before retry`
            );
            await this.sleep(2000);
            continue;
          }
          break;
        }

        // Second check: Run ffprobe verification
        const result = await this.ffprobe.verifyFile(filePath);

        if (result.isValid) {
          return {
            isValid: true,
            attempts: attempt,
          };
        }

        lastError = result.error || 'Unknown verification error';

        if (attempt < maxRetries) {
          // Exponential backoff: 2s, 4s, 8s, 16s, 32s (max 32s)
          const backoffMs = Math.min(2000 * 2 ** (attempt - 1), 32000);
          this.logger.warn(
            `Verification attempt ${attempt}/${maxRetries} failed: ${lastError}\n` +
              `Waiting ${backoffMs}ms before retry...`
          );
          await this.sleep(backoffMs);
        }
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : 'Exception during verification';
        this.logger.error(
          `Exception in verification attempt ${attempt}/${maxRetries}: ${lastError}`
        );

        if (attempt < maxRetries) {
          await this.sleep(2000);
        }
      }
    }

    return {
      isValid: false,
      error: lastError || 'Verification failed after all retries',
      attempts: maxRetries,
    };
  }
}
