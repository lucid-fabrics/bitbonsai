import { existsSync, promises as fs } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job, Policy } from '@prisma/client';
import { EncodingFailedEvent } from '../../common/events';
import { EncodingPreviewService } from '../encoding-preview.service';
import { FfmpegFileVerificationService } from '../ffmpeg-file-verification.service';
import { FfprobeService } from '../ffprobe.service';

/**
 * FfmpegHealthMonitor
 *
 * Owns file verification, disk-space guard coordination, NFS health,
 * and temp file guard interactions.
 */
@Injectable()
export class FfmpegHealthMonitor {
  readonly logger = new Logger(FfmpegHealthMonitor.name);

  constructor(
    private readonly fileVerification: FfmpegFileVerificationService,
    private readonly ffprobe: FfprobeService,
    private readonly previewService: EncodingPreviewService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  /**
   * SECURITY: Validate file path to prevent directory traversal attacks
   */
  validateFilePath(filePath: string, libraryPath: string): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsSync = require('node:fs');

    if (
      filePath.includes('..') ||
      filePath.includes('%2e') ||
      filePath.includes('%2E') ||
      filePath.includes('․')
    ) {
      throw new Error('File path contains directory traversal attempt');
    }

    const resolvedFile = path.resolve(filePath);
    const resolvedLibrary = path.resolve(libraryPath);

    try {
      const realFile = fsSync.realpathSync(resolvedFile);
      const realLibrary = fsSync.realpathSync(resolvedLibrary);

      if (!realFile.startsWith(realLibrary + path.sep)) {
        throw new Error(`File path '${filePath}' is outside library boundary`);
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        const parent = path.dirname(resolvedFile);
        try {
          const realParent = fsSync.realpathSync(parent);
          const realLibrary = fsSync.realpathSync(resolvedLibrary);

          if (!realParent.startsWith(realLibrary + path.sep)) {
            throw new Error(`File path '${filePath}' is outside library boundary`);
          }
        } catch (parentErr: unknown) {
          const message = parentErr instanceof Error ? parentErr.message : 'Unknown error';
          throw new Error(`Invalid file path: ${message}`);
        }
      } else {
        throw err;
      }
    }
  }

  async verifyPartialEncode(filePath: string): Promise<boolean> {
    try {
      const result = await this.ffprobe.verifyFile(filePath);
      return result.isValid;
    } catch {
      return false;
    }
  }

  async verifyFile(filePath: string): Promise<{ isValid: boolean; error?: string }> {
    return this.ffprobe.verifyFile(filePath);
  }

  /**
   * Handle successful encoding completion — verifies temp file before handing off
   */
  async handleEncodingSuccess(
    job: Job,
    policy: Policy,
    tempOutput: string,
    lastPreviewGeneration: Map<string, number>
  ): Promise<void> {
    this.logger.log(`Waiting 5 seconds for filesystem flush after FFmpeg completion...`);
    await this.fileVerification.sleep(5000);

    const fileExists = await this.fileVerification.waitForFileExists(tempOutput, 10, 2000);
    if (!fileExists) {
      throw new Error(
        `Temp file missing after 20 seconds: ${tempOutput}\n` +
          `FFmpeg reported success but file was not written to disk.`
      );
    }

    if (policy.verifyOutput) {
      this.logger.log(`Verifying temp file with retries: ${tempOutput}`);
      const verifyResult = await this.fileVerification.verifyFileWithRetries(tempOutput, 10);
      if (!verifyResult.isValid) {
        throw new Error(
          `Temp file verification failed after retries: ${verifyResult.error || 'File is not playable'}`
        );
      }
      this.logger.log(
        `✓ Temp file verified successfully after ${verifyResult.attempts || 1} attempt(s)`
      );
    }

    lastPreviewGeneration.delete(job.id);

    this.logger.log(`Encoding completed successfully for job ${job.id}`);
  }

  /**
   * Handle encoding failure — optionally deletes temp file and cleans up previews
   */
  async handleEncodingFailure(
    job: Job,
    tempOutput: string,
    errorMessage: string,
    deleteTemp: boolean,
    lastPreviewGeneration: Map<string, number>
  ): Promise<void> {
    this.logger.error(`Encoding failed for job ${job.id}: ${errorMessage}`);

    if (deleteTemp) {
      this.logger.warn(`Deleting corrupted temp file: ${tempOutput}`);
      try {
        if (existsSync(tempOutput)) {
          await fs.unlink(tempOutput);
        }
      } catch {
        // Ignore cleanup errors
      }

      await this.previewService.cleanupPreviews(job.id);
      lastPreviewGeneration.delete(job.id);
    } else {
      this.logger.log(`Keeping temp file for resume: ${tempOutput}`);
    }

    this.eventEmitter.emit(
      EncodingFailedEvent.event,
      new EncodingFailedEvent(job.id, errorMessage)
    );
  }
}
