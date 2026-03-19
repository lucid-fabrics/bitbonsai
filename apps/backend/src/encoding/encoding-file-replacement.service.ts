import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import type { JobWithPolicy } from './encoding-file.service';
import { FfmpegService } from './ffmpeg.service';

/**
 * EncodingFileReplacementService
 *
 * Handles file replacement operations: disk space verification, atomic replacement,
 * cross-filesystem rename, and Keep Original support.
 * Extracted from EncodingFileService to separate concerns.
 */
@Injectable()
export class EncodingFileReplacementService {
  private readonly logger = new Logger(EncodingFileReplacementService.name);

  constructor(
    private readonly ffmpegService: FfmpegService,
    private readonly queueService: QueueService
  ) {}

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
    } catch (error: unknown) {
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
        } catch (_rollbackError: unknown) {
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
    } catch (error: unknown) {
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
        } catch (fallbackError: unknown) {
          // Clean up partial copy if it exists
          if (fs.existsSync(destPath)) {
            try {
              fs.unlinkSync(destPath);
            } catch (cleanupError: unknown) {
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
        } catch (rollbackError: unknown) {
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
      } catch (cleanupError: unknown) {
        // Non-fatal: Log warning but don't fail the operation
        this.logger.warn(`Failed to cleanup backup file ${backupPath}: ${cleanupError}`);
      }

      this.logger.log(`Atomic replacement complete with verification for ${originalPath}`);
    } catch (error: unknown) {
      // If backup exists and original doesn't, try to restore
      if (fs.existsSync(backupPath) && !fs.existsSync(originalPath)) {
        try {
          this.crossFsSafeRenameSync(backupPath, originalPath);
          this.logger.log(`Restored backup after error for ${originalPath}`);
        } catch (restoreError: unknown) {
          this.logger.error(`Failed to restore backup after error: ${restoreError}`);
        }
      }
      throw error;
    }
  }

  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
