import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/**
 * EncodingPreviewService
 *
 * Generates preview screenshots from encoding temp files.
 * Designed to minimize performance impact on encoding process.
 *
 * Strategy:
 * - Extract 9 frames at 10%, 20%, 30%, 40%, 50%, 60%, 70%, 80%, 90%
 * - Use FFmpeg's fast seeking to avoid decoding entire file
 * - Run extraction asynchronously in separate process
 * - Store in `/cache/bitbonsai-previews/{jobId}/` (shared NFS storage)
 * - Clean up automatically when job completes/fails
 */
@Injectable()
export class EncodingPreviewService {
  private readonly logger = new Logger(EncodingPreviewService.name);
  // MULTI-NODE FIX: Use dedicated NFS share for previews
  // Mounted at /previews on all nodes (Unraid share: bitbonsai-previews)
  private readonly PREVIEW_DIR = process.env.PREVIEW_DIR || '/previews';
  private readonly PREVIEW_WIDTH = 640; // Small size for fast loading

  /**
   * Generate preview screenshots from temp file
   *
   * @param jobId - Job ID
   * @param tempFilePath - Path to temp encoded file
   * @param durationSeconds - Total video duration
   * @param currentProgress - Current encoding progress (0-100)
   * @returns Array of preview image paths
   */
  async generatePreviews(
    jobId: string,
    tempFilePath: string,
    durationSeconds: number,
    currentProgress: number
  ): Promise<string[]> {
    try {
      // Create preview directory for this job
      const jobPreviewDir = path.join(this.PREVIEW_DIR, jobId);
      await fs.mkdir(jobPreviewDir, { recursive: true });

      // Calculate timestamps for preview extraction
      // Extract at 10%, 20%, 30%, 40%, 50%, 60%, 70%, 80%, 90%
      const timestamps = [
        durationSeconds * 0.1,
        durationSeconds * 0.2,
        durationSeconds * 0.3,
        durationSeconds * 0.4,
        durationSeconds * 0.5,
        durationSeconds * 0.6,
        durationSeconds * 0.7,
        durationSeconds * 0.8,
        durationSeconds * 0.9,
      ];

      const previewPaths: string[] = [];

      // Extract screenshots in parallel
      await Promise.all(
        timestamps.map(async (timestamp, index) => {
          const outputPath = path.join(jobPreviewDir, `preview-${index + 1}.jpg`);

          try {
            // Use FFmpeg with fast seeking
            // -ss before -i for input seeking (faster)
            // -frames:v 1 to extract single frame
            // -vf scale to resize for fast transfer
            await new Promise<void>((resolve, reject) => {
              const ffmpeg = spawn('ffmpeg', [
                '-y', // Overwrite existing
                '-ss',
                timestamp.toString(),
                '-i',
                tempFilePath,
                '-frames:v',
                '1',
                '-vf',
                `scale=${this.PREVIEW_WIDTH}:-1`, // Maintain aspect ratio
                '-q:v',
                '2', // High quality JPEG
                outputPath,
              ]);

              const timeoutId = setTimeout(() => {
                ffmpeg.kill('SIGKILL');
                reject(new Error('FFmpeg preview extraction timeout'));
              }, 10000);

              ffmpeg.on('close', (code) => {
                clearTimeout(timeoutId);
                ffmpeg.stdout?.destroy();
                ffmpeg.stderr?.destroy();

                if (code === 0) {
                  resolve();
                } else {
                  reject(new Error(`FFmpeg exited with code ${code}`));
                }
              });

              ffmpeg.on('error', (error) => {
                clearTimeout(timeoutId);
                ffmpeg.stdout?.destroy();
                ffmpeg.stderr?.destroy();
                reject(error);
              });
            });

            // BUGFIX: Verify file exists before adding to preview paths
            // This prevents saving paths to non-existent files which causes
            // empty placeholders to appear in the UI
            if (existsSync(outputPath)) {
              previewPaths.push(outputPath);
              this.logger.debug(
                `Generated preview ${index + 1}/9 for job ${jobId} at ${timestamp.toFixed(1)}s`
              );
            } else {
              this.logger.warn(
                `Preview ${index + 1} file not found after extraction for job ${jobId}`
              );
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Failed to generate preview ${index + 1} for job ${jobId}: ${message}`
            );
            // Continue with other previews even if one fails
          }
        })
      );

      return previewPaths.sort(); // Ensure correct order
    } catch (error) {
      this.logger.error(`Failed to generate previews for job ${jobId}:`, error);
      return [];
    }
  }

  /**
   * Capture a manual preview frame from source file at the given progress percentage.
   *
   * Uses ffprobe to get duration, then ffmpeg to extract a frame at the calculated timestamp.
   *
   * @param jobId - Job ID
   * @param filePath - Source file path
   * @param progress - Current encoding progress (0-100)
   * @returns Path to the captured preview image
   * @throws Error if ffprobe or ffmpeg fails
   */
  async captureManualPreview(jobId: string, filePath: string, progress: number): Promise<string> {
    // Get duration from source file using ffprobe
    let durationSeconds: number;
    try {
      const { stdout } = await execFileAsync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          filePath,
        ],
        {
          timeout: 5000,
        }
      );
      durationSeconds = parseFloat(stdout.trim());

      if (Number.isNaN(durationSeconds) || durationSeconds <= 0) {
        throw new Error('Invalid duration');
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to get file duration', {
        jobId,
        filePath,
        error: errorMessage,
      });
      throw new Error('Failed to get file duration for preview capture');
    }

    // Calculate timestamp based on current encoding progress
    const timestampSeconds = (progress / 100) * durationSeconds;

    // Generate manual preview path
    const manualPreviewPath = `/tmp/bitbonsai-previews/${jobId}/manual-${Date.now()}.jpg`;

    // Create job preview directory if it doesn't exist
    const jobPreviewDir = `/tmp/bitbonsai-previews/${jobId}`;
    await fs.mkdir(jobPreviewDir, { recursive: true });

    // Extract a frame from the source file at current encoding progress
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-y', // Overwrite existing
          '-ss',
          timestampSeconds.toString(), // Seek to current progress position
          '-i',
          filePath, // Use original source file
          '-vf',
          `scale=${this.PREVIEW_WIDTH}:-1`, // Scale down for fast loading
          '-frames:v',
          '1',
          '-q:v',
          '2', // High quality JPEG
          manualPreviewPath,
        ],
        {
          timeout: 10000, // 10 second timeout (seeking can take time on large files)
        }
      );

      // Verify file exists before returning path
      if (!existsSync(manualPreviewPath)) {
        this.logger.error('Manual preview file not found after FFmpeg extraction', {
          jobId,
          manualPreviewPath,
          timestampSeconds,
        });
        throw new Error('Preview file not created. FFmpeg may have failed silently.');
      }

      this.logger.log(
        `Preview captured successfully for job ${jobId} at ${timestampSeconds.toFixed(1)}s (${progress}%)`
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const execError = error as { stderr?: string; stdout?: string; code?: number };
      this.logger.error('Failed to capture preview frame', {
        jobId,
        sourceFilePath: filePath,
        timestampSeconds,
        progress,
        duration: durationSeconds,
        manualPreviewPath,
        errorMessage,
        errorStderr: execError.stderr,
        errorStdout: execError.stdout,
        errorCode: execError.code,
        fullError: error,
      });

      throw new Error(`Failed to capture preview: ${errorMessage}`);
    }

    return manualPreviewPath;
  }

  /**
   * Clean up preview images for a job
   *
   * @param jobId - Job ID
   */
  async cleanupPreviews(jobId: string): Promise<void> {
    try {
      const jobPreviewDir = path.join(this.PREVIEW_DIR, jobId);
      await fs.rm(jobPreviewDir, { recursive: true, force: true });
      this.logger.debug(`Cleaned up previews for job ${jobId}`);
    } catch (error) {
      this.logger.warn(`Failed to cleanup previews for job ${jobId}:`, error);
    }
  }

  /**
   * Get preview image paths for a job
   *
   * @param jobId - Job ID
   * @returns Array of preview image paths (empty if none exist)
   */
  async getPreviewPaths(jobId: string): Promise<string[]> {
    try {
      const jobPreviewDir = path.join(this.PREVIEW_DIR, jobId);
      const files = await fs.readdir(jobPreviewDir);
      return files
        .filter((f) => f.startsWith('preview-') && f.endsWith('.jpg'))
        .sort() // Ensure correct order
        .map((f) => path.join(jobPreviewDir, f));
    } catch {
      return []; // Directory doesn't exist or is empty
    }
  }
}
