import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job, Policy } from '@prisma/client';
import {
  EncodingCancelledEvent,
  EncodingFailedEvent,
  EncodingPreviewUpdateEvent,
  EncodingProcessMarkedEvent,
  EncodingProgressUpdateEvent,
} from '../common/events';
import { JobRepository } from '../common/repositories/job.repository';
import { normalizeCodec as normalizeCodecUtil } from '../common/utils/codec.util';
import type { EncodingProgressDto } from './dto/encoding-progress.dto';
import { EncodingPreviewService } from './encoding-preview.service';
import { FfmpegFileVerificationService } from './ffmpeg-file-verification.service';
import { FfmpegFlagBuilderService } from './ffmpeg-flag-builder.service';
import { FfmpegProcessCleanupService } from './ffmpeg-process-cleanup.service';
import { FfmpegProgressParserService } from './ffmpeg-progress-parser.service';
import { FfprobeService } from './ffprobe.service';
import {
  type HardwareAccelConfig,
  HardwareAccelerationService,
} from './hardware-acceleration.service';

/**
 * Active encoding process tracking
 */
interface ActiveEncoding {
  jobId: string;
  process: ChildProcess;
  startTime: Date;
  lastProgress: number;
  lastStderr: string; // Last 2000 chars of stderr for error reporting
  lastOutputTime: Date; // Last time FFmpeg produced ANY output (for stuck detection)
}

/**
 * Extended Job type with library relation
 */
type JobWithLibrary = Job & {
  library?: {
    id: string;
    name: string;
    path: string;
  };
};

/**
 * Extended Job type with resume capability fields
 */
type JobWithResumeFields = Job & {
  resumeTimestamp?: string | null;
};

/**
 * Composite Job type with all extended fields for the encode() method
 */
type JobWithAllFields = Job & JobWithResumeFields;

/**
 * FFmpeg progress information
 */
export interface FfmpegProgress {
  jobId: string;
  frame: number;
  fps: number;
  currentTime: string;
  progress: number;
  etaSeconds?: number;
}

/**
 * FfmpegService
 *
 * Comprehensive ffmpeg wrapper service for video encoding with:
 * - Hardware acceleration auto-detection (NVIDIA, Intel QSV, AMD, Apple M, CPU)
 * - Real-time progress tracking via stderr parsing
 * - Process management and cancellation
 * - Event-driven progress updates
 * - Atomic file replacement
 * - Error handling and recovery
 * - SECURITY: FFmpeg flag whitelisting to prevent command injection
 *
 * Progress Tracking:
 * - Parses ffmpeg stderr output using regex
 * - Calculates percentage based on video duration
 * - Emits 'encoding.progress' events via EventEmitter2
 * - Updates Job entity via QueueService
 *
 * Hardware Acceleration Support:
 * - NVIDIA: NVENC (H.264/HEVC GPU encoding)
 * - Intel QSV: Quick Sync Video
 * - AMD: VAAPI (Video Acceleration API)
 * - Apple M: VideoToolbox
 * - CPU: Software encoding fallback
 *
 * Sub-services:
 * - FfmpegProcessCleanupService: OS-level process scanning and PID-based kill
 * - FfmpegFileVerificationService: retry-based file existence and integrity checks
 */
@Injectable()
export class FfmpegService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FfmpegService.name);
  private readonly activeEncodings = new Map<string, ActiveEncoding>();

  // Cache stderr output for recently completed/failed jobs
  // This persists even after the job is removed from activeEncodings
  private readonly stderrCache = new Map<string, { stderr: string; timestamp: Date }>();
  private readonly STDERR_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private stderrCleanupInterval?: NodeJS.Timeout; // CRITICAL #2 FIX

  // Preview generation throttling (jobId -> last generation timestamp)
  private readonly lastPreviewGeneration = new Map<string, number>();
  private readonly PREVIEW_THROTTLE_MS = 30 * 1000; // 30 seconds

  private readonly CODEC_CACHE_CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  private codecCacheCleanupInterval?: NodeJS.Timeout; // CRITICAL #9 FIX

  /**
   * SECURITY: Whitelist of allowed FFmpeg flags — delegated to FfmpegFlagBuilderService
   */
  private get ALLOWED_FFMPEG_FLAGS(): Set<string> {
    return this.flagBuilder.ALLOWED_FFMPEG_FLAGS;
  }

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly previewService: EncodingPreviewService,
    private readonly hardwareAccelerationService: HardwareAccelerationService,
    private readonly flagBuilder: FfmpegFlagBuilderService,
    private readonly progressParser: FfmpegProgressParserService,
    private readonly ffprobe: FfprobeService,
    private readonly processCleanup: FfmpegProcessCleanupService,
    private readonly fileVerification: FfmpegFileVerificationService
  ) {}

  /**
   * CRITICAL #2 & #9 FIX: Start cache cleanup intervals
   */
  async onModuleInit() {
    // MEDIUM #13 FIX: Clean up orphaned temp files on startup
    await this.processCleanup.cleanupOrphanedTempFiles();

    // Start stderr cache cleanup every 15 minutes
    this.stderrCleanupInterval = setInterval(
      () => {
        this.cleanupStaleStderrCache();
      },
      15 * 60 * 1000
    );

    // Start codec cache cleanup every 15 minutes
    this.codecCacheCleanupInterval = setInterval(() => {
      this.ffprobe.cleanupCodecCache();
    }, this.CODEC_CACHE_CLEANUP_INTERVAL_MS);

    this.logger.log('✅ Cache cleanup intervals started');
  }

  /**
   * CRITICAL #2 & #9 FIX: Cleanup stale stderr cache entries
   * @private
   */
  private cleanupStaleStderrCache(): void {
    const now = Date.now();
    let removed = 0;

    for (const [jobId, entry] of this.stderrCache.entries()) {
      if (now - entry.timestamp.getTime() > this.STDERR_CACHE_TTL_MS) {
        this.stderrCache.delete(jobId);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug(`🧹 Cleaned up ${removed} stale stderr cache entries`);
    }
  }

  /**
   * HIGH PRIORITY FIX: OnModuleDestroy lifecycle hook to kill all FFmpeg processes
   * CRITICAL #2, #9, #10, #11 FIX: Clear all caches and cleanup intervals
   * Prevents zombie FFmpeg processes when backend shuts down or restarts
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('FfmpegService shutting down - killing all active FFmpeg processes');

    // CRITICAL #2 & #9 FIX: Clear cleanup intervals
    if (this.stderrCleanupInterval) {
      clearInterval(this.stderrCleanupInterval);
    }
    if (this.codecCacheCleanupInterval) {
      clearInterval(this.codecCacheCleanupInterval);
    }

    const activeJobIds = Array.from(this.activeEncodings.keys());

    if (activeJobIds.length === 0) {
      this.logger.log('No active FFmpeg processes to kill');
    } else {
      this.logger.log(`Killing ${activeJobIds.length} active FFmpeg process(es)...`);

      // Kill all active processes
      const killPromises = activeJobIds.map(async (jobId) => {
        const encoding = this.activeEncodings.get(jobId);
        if (!encoding) return;

        try {
          // Use process group kill to ensure all child processes are terminated
          if (encoding.process.pid) {
            // Kill entire process group (negative PID)
            process.kill(-encoding.process.pid, 'SIGTERM');
            this.logger.log(
              `Killed FFmpeg process group for job ${jobId} (PID: ${encoding.process.pid})`
            );
          }

          // Give it 2 seconds to gracefully shutdown
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Force kill if still alive
          if (!encoding.process.killed) {
            if (encoding.process.pid) {
              process.kill(-encoding.process.pid, 'SIGKILL');
              this.logger.log(`Force killed FFmpeg process group for job ${jobId}`);
            }
          }
        } catch (error: unknown) {
          // ESRCH error means process already dead - that's fine
          const err = error as NodeJS.ErrnoException;
          if (err.code !== 'ESRCH') {
            this.logger.warn(`Failed to kill FFmpeg for job ${jobId}: ${error}`);
          }
        }
      });

      await Promise.allSettled(killPromises);

      // CRITICAL #10 FIX: Clear all tracking maps
      this.activeEncodings.clear();

      this.logger.log('FFmpeg cleanup complete');
    }

    // CRITICAL #2, #9, #11 FIX: Clear all caches to prevent memory leaks
    this.stderrCache.clear();
    this.ffprobe.clearCache();
    this.lastPreviewGeneration.clear();
    this.logger.log('✅ All caches cleared');
  }

  /**
   * SECURITY: Validate and filter FFmpeg flags — delegates to FfmpegFlagBuilderService
   */
  private validateFfmpegFlags(flags: string[]): string[] {
    return this.flagBuilder.validateFfmpegFlags(flags);
  }

  /**
   * Select the appropriate FFmpeg codec based on policy target and available hardware
   * Delegates to FfmpegFlagBuilderService
   */
  private selectCodecForPolicy(targetCodec: string, hwType: string): string {
    return this.flagBuilder.selectCodecForPolicy(targetCodec, hwType);
  }

  /**
   * Detect available hardware acceleration
   *
   * Detection order:
   * 1. NVIDIA GPU (nvidia-smi)
   * 2. Intel QSV (/dev/dri/renderD128)
   * 3. AMD GPU (VAAPI)
   * 4. Apple M (macOS VideoToolbox)
   * 5. CPU (fallback)
   *
   * @returns Hardware acceleration configuration
   */
  async detectHardwareAcceleration(): Promise<HardwareAccelConfig> {
    return this.hardwareAccelerationService.detectHardwareAcceleration();
  }

  /**
   * Build ffmpeg command arguments
   *
   * TRUE RESUME: Supports input seeking (-ss before -i) to skip already-encoded portion
   * REMUX: Supports fast stream copy when job.type === 'REMUX'
   *
   * Command structure:
   * ENCODE: ffmpeg [-ss HH:MM:SS.MS] [hwaccel flags] -i [input] [video codec] -crf [quality] [audio] [output]
   * REMUX: ffmpeg -i [input] -c:v copy -c:a copy [output]
   *
   * @param job - Job entity with file info
   * @param policy - Policy entity with encoding settings
   * @param hwaccel - Hardware acceleration config
   * @param outputPath - Path to output file
   * @param resumeFromTimestamp - Optional timestamp to resume from (HH:MM:SS.MS format)
   * @returns Array of ffmpeg arguments
   */
  buildFfmpegCommand(
    job: Job,
    policy: Policy,
    hwaccel: HardwareAccelConfig,
    outputPath: string,
    resumeFromTimestamp?: string
  ): string[] {
    return this.flagBuilder.buildFfmpegCommand(
      job,
      policy,
      hwaccel,
      outputPath,
      resumeFromTimestamp
    );
  }

  /**
   * Parse ffmpeg progress line
   *
   * Extracts progress information from ffmpeg stderr output:
   * - frame: Current frame number
   * - fps: Processing speed
   * - time: Current time position (HH:MM:SS.MS)
   *
   * @param line - Single line from ffmpeg stderr
   * @returns Parsed progress data or null if not a progress line
   */
  parseProgress(line: string): Pick<EncodingProgressDto, 'frame' | 'fps' | 'currentTime'> | null {
    return this.progressParser.parseProgress(line);
  }

  /**
   * Calculate progress percentage
   *
   * Converts time position to percentage based on total duration.
   * Requires video duration to be known (from media info scan).
   *
   * @param currentTime - Current time position (HH:MM:SS.MS)
   * @param totalDurationSeconds - Total video duration in seconds
   * @returns Progress percentage (0-100)
   */
  private calculateProgressPercentage(currentTime: string, totalDurationSeconds: number): number {
    return this.progressParser.calculateProgressPercentage(currentTime, totalDurationSeconds);
  }

  /**
   * Handle progress data from ffmpeg stderr
   *
   * TRUE RESUME: Saves resume state (timestamp, temp file path) to DB every progress update
   * This allows encoding to resume from the last known position after backend crash/restart
   *
   * @param progressData - Parsed progress data
   * @param job - Job entity
   * @param activeEncoding - Active encoding state
   * @param estimatedDurationSeconds - Estimated video duration
   * @param tempOutput - Path to temporary output file
   * @param resumeFromPercent - Percentage we resumed from (0 if starting fresh)
   * @private
   */
  private async handleProgressUpdate(
    progressData: Pick<EncodingProgressDto, 'frame' | 'fps' | 'currentTime'>,
    job: Job,
    activeEncoding: ActiveEncoding,
    estimatedDurationSeconds: number,
    tempOutput: string,
    resumeFromPercent = 0
  ): Promise<void> {
    // CRITICAL #1 FIX: Check for pause/cancel requests before processing progress
    const jobStatus = await this.jobRepository.findStatusFields(job.id);
    if (jobStatus?.pauseRequestedAt && !jobStatus.pauseProcessedAt) {
      this.logger.warn(`[${job.id}] Pause requested, killing FFmpeg gracefully...`);
      await this.killProcess(job.id);
      return;
    }
    if (jobStatus?.cancelRequestedAt && !jobStatus.cancelProcessedAt) {
      this.logger.warn(`[${job.id}] Cancel requested, killing FFmpeg gracefully...`);
      await this.killProcess(job.id);
      return;
    }

    // Calculate current progress based on time position
    let currentProgress = this.calculateProgressPercentage(
      progressData.currentTime,
      estimatedDurationSeconds
    );

    // FALLBACK: Use frame-based progress when time-based returns 0 but frames ARE being encoded
    // This handles the case where out_time=N/A during FFmpeg's initial buffering/seeking phase
    // For large 4K files (80-90GB), FFmpeg can output frames before reporting valid out_time
    if (currentProgress === 0 && progressData.frame > 0 && estimatedDurationSeconds > 0) {
      // Estimate total frames using standard movie FPS (most are 23.976, 24, 25, or 29.97)
      // Using 24fps as conservative estimate - slightly overestimates progress which is acceptable
      const assumedSourceFps = 24;
      const estimatedTotalFrames = estimatedDurationSeconds * assumedSourceFps;

      if (estimatedTotalFrames > 0) {
        currentProgress = Math.min(100, (progressData.frame / estimatedTotalFrames) * 100);
        this.logger.debug(
          `[${job.id}] Frame-based progress fallback: ${currentProgress.toFixed(2)}% (${progressData.frame}/${Math.round(estimatedTotalFrames)} frames, out_time=${progressData.currentTime})`
        );
      }
    }

    // TRUE RESUME: Adjust progress to account for already-encoded portion
    // If we resumed from 60%, and current position is 70%, actual progress is 70% (not 10%)
    // FFmpeg -ss skips input frames, so progress is relative to full duration
    const adjustedProgress = Math.min(100, Math.max(resumeFromPercent, currentProgress));

    // Calculate ETA
    const elapsed = Date.now() - activeEncoding.startTime.getTime();
    const remainingPercent = 100 - adjustedProgress;
    const eta =
      adjustedProgress > resumeFromPercent
        ? Math.round(((elapsed / (adjustedProgress - resumeFromPercent)) * remainingPercent) / 1000)
        : 0;

    // Emit progress event
    const progressDto: EncodingProgressDto = {
      jobId: job.id,
      frame: progressData.frame,
      fps: progressData.fps,
      currentTime: progressData.currentTime,
      progress: adjustedProgress,
      eta,
    };

    this.eventEmitter.emit('encoding.progress', progressDto);

    // TRUE RESUME: Save resume state every 0.1% for crash recovery
    // Stores: progress, timestamp (for -ss seek), temp file path
    // CRITICAL FIX: Also update on first progress event to handle out_time=N/A at encoding start
    const isFirstProgressEvent = activeEncoding.lastProgress === 0 && progressData.frame > 0;
    if (adjustedProgress - activeEncoding.lastProgress >= 0.1 || isFirstProgressEvent) {
      this.logger.debug(
        `[${job.id}] Updating database: ${adjustedProgress.toFixed(2)}% @ ${progressData.currentTime} (ETA: ${eta}s)${isFirstProgressEvent ? ' [FIRST]' : ''}`
      );
      // Fire-and-forget: emit event for QueueService to persist progress
      this.eventEmitter.emit(
        EncodingProgressUpdateEvent.event,
        new EncodingProgressUpdateEvent(job.id, {
          progress: Math.round(adjustedProgress * 100) / 100,
          etaSeconds: eta,
          fps: progressData.fps,
          resumeTimestamp: progressData.currentTime,
          tempFilePath: tempOutput,
        })
      );
      activeEncoding.lastProgress = adjustedProgress;

      // ENCODING PREVIEW: Generate preview screenshots (throttled to 30 seconds)
      const now = Date.now();
      const lastGeneration = this.lastPreviewGeneration.get(job.id) || 0;
      if (
        now - lastGeneration >= this.PREVIEW_THROTTLE_MS &&
        tempOutput &&
        existsSync(tempOutput)
      ) {
        this.lastPreviewGeneration.set(job.id, now);
        this.logger.debug(
          `[${job.id}] Generating encoding previews at ${adjustedProgress.toFixed(2)}%`
        );

        // Generate previews asynchronously (don't block progress updates)
        this.previewService
          .generatePreviews(job.id, tempOutput, estimatedDurationSeconds, adjustedProgress)
          .then((previewPaths) => {
            if (previewPaths.length > 0) {
              // Fire-and-forget: emit event to update preview paths
              this.eventEmitter.emit(
                EncodingPreviewUpdateEvent.event,
                new EncodingPreviewUpdateEvent(job.id, previewPaths)
              );
              this.logger.debug(`[${job.id}] Generated ${previewPaths.length} preview screenshots`);
            }
          })
          .catch((error) => {
            this.logger.warn(`Failed to generate previews for job ${job.id}: ${error.message}`);
          });
      }
    }
  }

  /**
   * Handle successful encoding completion
   *
   * CRITICAL FIX: Verify temp file BEFORE rename to prevent race condition
   * TRUE RESUME: Clears resume state on success
   *
   * @param job - Job entity
   * @param policy - Policy entity
   * @param tempOutput - Temporary output file path
   * @private
   */
  private async handleEncodingSuccess(job: Job, policy: Policy, tempOutput: string): Promise<void> {
    // ROCK SOLID FIX: Wait for filesystem to flush (FFmpeg may not have fully closed the file)
    this.logger.log(`Waiting 5 seconds for filesystem flush after FFmpeg completion...`);
    await this.fileVerification.sleep(5000);

    // ROCK SOLID FIX: Verify temp file EXISTS with retries (filesystem may need time to sync)
    const fileExists = await this.fileVerification.waitForFileExists(tempOutput, 10, 2000);
    if (!fileExists) {
      throw new Error(
        `Temp file missing after 20 seconds: ${tempOutput}\n` +
          `FFmpeg reported success but file was not written to disk.`
      );
    }

    // ROCK SOLID FIX: Verify temp file is VALID before rename with retries
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

    // CRITICAL FIX: Do NOT move/replace files here!
    // File replacement is handled by encoding-processor.service.ts after verification
    // This method should only verify the temp file and mark the job as ready for completion
    // The temp file MUST remain at tempOutput location for encoding-processor to verify and replace

    // ENCODING PREVIEW: Keep preview screenshots on success so users can view them later
    // Preview images are small (~20-80KB each, 9 total = ~500KB max) and provide valuable feedback
    // Only clean up on failure to save space for corrupted encodes
    // await this.previewService.cleanupPreviews(job.id); // Disabled - keep previews for completed jobs
    this.lastPreviewGeneration.delete(job.id);

    this.logger.log(`Encoding completed successfully for job ${job.id}`);
  }

  /**
   * Handle encoding failure
   *
   * TRUE RESUME: Keep temp files on interrupt/crash for resume capability
   * Only delete temp files on explicit corruption/validation failures
   *
   * @param job - Job entity
   * @param tempOutput - Temporary output file path
   * @param errorMessage - Error message
   * @param deleteTemp - Whether to delete temp file (false for resume, true for corrupted files)
   * @private
   */
  private async handleEncodingFailure(
    job: Job,
    tempOutput: string,
    errorMessage: string,
    deleteTemp = false
  ): Promise<void> {
    this.logger.error(`Encoding failed for job ${job.id}: ${errorMessage}`);

    // TRUE RESUME: Only delete temp file if explicitly requested (corrupted/invalid)
    // For interrupts/crashes, KEEP the temp file so encoding can resume
    if (deleteTemp) {
      this.logger.warn(`Deleting corrupted temp file: ${tempOutput}`);
      try {
        if (existsSync(tempOutput)) {
          await fs.unlink(tempOutput);
        }
      } catch {
        // Ignore cleanup errors
      }

      // ENCODING PREVIEW: Clean up preview screenshots when deleting temp file
      await this.previewService.cleanupPreviews(job.id);
      this.lastPreviewGeneration.delete(job.id);
    } else {
      this.logger.log(`Keeping temp file for resume: ${tempOutput}`);
    }

    this.eventEmitter.emit(
      EncodingFailedEvent.event,
      new EncodingFailedEvent(job.id, errorMessage)
    );
  }

  /**
   * Get video duration from FFprobe before encoding.
   * Delegates to FfprobeService.
   *
   * @param filePath - Path to video file
   * @returns Duration in seconds, or 3600 if unable to determine
   */
  async getVideoDuration(filePath: string): Promise<number> {
    return this.ffprobe.getVideoDuration(filePath);
  }

  /**
   * Get video codec and container information using ffprobe.
   * Delegates to FfprobeService.
   *
   * @param filePath - Path to video file
   * @returns Object with codec name and container format
   */
  async getVideoInfo(filePath: string): Promise<{ codec: string; container: string }> {
    return this.ffprobe.getVideoInfo(filePath);
  }

  /**
   * Get video info with caching (1-hour TTL).
   * Delegates to FfprobeService.
   *
   * @param filePath - Path to video file
   * @returns Object with codec name and container format
   */
  async getVideoInfoCached(filePath: string): Promise<{ codec: string; container: string }> {
    return this.ffprobe.getVideoInfoCached(filePath);
  }

  /**
   * Normalize codec name to standard format
   * Delegates to shared utility for consistency across modules.
   */
  normalizeCodec(codec: string): string {
    return normalizeCodecUtil(codec);
  }

  /**
   * SECURITY: Validate file path to prevent directory traversal attacks
   * Ensures file path is within allowed library path
   *
   * @param filePath - File path to validate
   * @param libraryPath - Expected library base path
   * @throws Error if path contains traversal attempts or is outside library
   */
  validateFilePath(filePath: string, libraryPath: string): void {
    const path = require('node:path');
    const fs = require('node:fs');

    // Check for obvious traversal patterns (including URL-encoded and Unicode)
    if (
      filePath.includes('..') ||
      filePath.includes('%2e') ||
      filePath.includes('%2E') ||
      filePath.includes('\u2024')
    ) {
      throw new Error('File path contains directory traversal attempt');
    }

    // Resolve to absolute paths
    const resolvedFile = path.resolve(filePath);
    const resolvedLibrary = path.resolve(libraryPath);

    // Follow symlinks and validate (prevents symlink attacks)
    try {
      const realFile = fs.realpathSync(resolvedFile);
      const realLibrary = fs.realpathSync(resolvedLibrary);

      // Must start with library path + separator (prevents /lib vs /library confusion)
      if (!realFile.startsWith(realLibrary + path.sep)) {
        throw new Error(`File path '${filePath}' is outside library boundary`);
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        // File doesn't exist yet - validate parent directory
        const parent = path.dirname(resolvedFile);
        try {
          const realParent = fs.realpathSync(parent);
          const realLibrary = fs.realpathSync(resolvedLibrary);

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

  /**
   * Verify partial encoded file is valid (not corrupted).
   * Delegates to FfprobeService.
   */
  private async verifyPartialEncode(filePath: string): Promise<boolean> {
    try {
      const result = await this.ffprobe.verifyFile(filePath);
      return result.isValid;
    } catch {
      return false;
    }
  }

  /**
   * Parse HH:MM:SS.MS timestamp to seconds.
   * Delegates to FfmpegProgressParserService.
   */
  private parseTimestampToSeconds(timestamp: string): number {
    return this.progressParser.parseTimestampToSeconds(timestamp);
  }

  /**
   * Convert seconds to HH:MM:SS.MS timestamp format.
   * Delegates to FfmpegProgressParserService.
   */
  formatSecondsToTimestamp(totalSeconds: number): string {
    return this.progressParser.formatSecondsToTimestamp(totalSeconds);
  }

  /**
   * Get nice value for priority level
   *
   * @param priority - Job priority (0=normal, 1=high, 2=top)
   * @returns Nice value for spawn (negative = higher priority)
   */
  private getNiceValue(priority: number): number {
    switch (priority) {
      case 2: // Top priority
        return -10;
      case 1: // High priority
        return -5;
      default:
        return 0;
    }
  }

  /**
   * Renice an active FFmpeg process
   *
   * Changes CPU priority of a running encoding job.
   * Uses renice command on Unix/Linux/macOS.
   *
   * @param jobId - Job unique identifier
   * @param priority - New priority level (0=normal, 1=high, 2=top)
   * @returns True if successfully reniced, false if no active process
   * @throws Error if renice command fails
   */
  async reniceProcess(jobId: string, priority: number): Promise<boolean> {
    const activeEncoding = this.activeEncodings.get(jobId);
    if (!activeEncoding || !activeEncoding.process.pid) {
      this.logger.warn(`Cannot renice job ${jobId}: no active FFmpeg process`);
      return false;
    }

    const niceValue = this.getNiceValue(priority);
    const pid = activeEncoding.process.pid;

    this.logger.log(`Renicing FFmpeg process ${pid} (job ${jobId}) to nice ${niceValue}`);

    return new Promise((resolve, reject) => {
      // Use renice command to change priority of running process
      const renice = spawn('renice', ['-n', niceValue.toString(), '-p', pid.toString()]);

      renice.on('close', (code) => {
        if (code === 0) {
          this.logger.log(
            `Successfully reniced FFmpeg process ${pid} (job ${jobId}) to nice ${niceValue}`
          );
          resolve(true);
        } else {
          const error = `renice command failed with exit code ${code}`;
          this.logger.error(error);
          reject(new Error(error));
        }
      });

      renice.on('error', (err) => {
        this.logger.error(`Failed to execute renice: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * Encode file using ffmpeg
   *
   * TRUE RESUME Implementation:
   * 1. Check if job has resume state (tempFilePath + resumeTimestamp)
   * 2. If yes and temp file is valid, use FFmpeg -ss to skip already-encoded portion
   * 3. Continue encoding from where it left off
   * 4. If temp file is corrupted/missing, start from 0%
   *
   * Process:
   * 1. Get video duration from FFprobe (ISSUE #11 FIX)
   * 2. Check for resume state and validate temp file
   * 3. Detect hardware acceleration
   * 4. Build ffmpeg command (with -ss if resuming)
   * 5. Spawn ffmpeg process with nice (priority-based CPU scheduling)
   * 6. Parse stderr for progress
   * 7. Emit progress events
   * 8. Update job entity
   * 9. Handle completion/errors
   * 10. Atomic file replacement
   *
   * @param job - Job entity with full relations (policy, library)
   * @param policy - Policy entity with encoding settings
   * @returns Promise that resolves when encoding completes
   * @throws Error if ffmpeg fails or process error occurs
   */
  async encodeFile(job: Job, policy: Policy, customOutputPath?: string): Promise<void> {
    this.logger.log(`Starting encoding for job ${job.id}: ${job.fileLabel}`);
    this.logger.debug(`[${job.id}] encodeFile() called - setting up FFmpeg`);

    // SECURITY: Validate file path before any operations
    const jobWithLibrary = job as JobWithLibrary;
    if (jobWithLibrary.library?.path) {
      try {
        this.validateFilePath(job.filePath, jobWithLibrary.library.path);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[${job.id}] File path validation failed: ${message}`);
        throw new Error(`Security validation failed: ${message}`);
      }
    }

    // Validate file exists
    if (!existsSync(job.filePath)) {
      throw new Error(`File not found: ${job.filePath}`);
    }

    // ISSUE #11 FIX: Get actual video duration from FFprobe
    const estimatedDurationSeconds = await this.getVideoDuration(job.filePath);
    this.logger.log(
      `[${job.id}] Using duration: ${estimatedDurationSeconds.toFixed(2)}s for progress calculation`
    );

    // TRUE RESUME: Check if we can resume from previous encoding attempt
    const jobWithResume = job as JobWithResumeFields;

    let resumeFromSeconds = 0;
    let resumeFromPercent = 0;

    // APPROACH 1: Resume from auto-heal (temp file may not exist yet, but resumeTimestamp is set)
    if (jobWithResume.resumeTimestamp && job.progress > 0) {
      // Parse HH:MM:SS.MS to seconds
      resumeFromSeconds = this.parseTimestampToSeconds(jobWithResume.resumeTimestamp);
      resumeFromPercent = (resumeFromSeconds / estimatedDurationSeconds) * 100;

      this.logger.log(
        `🔄 TRUE RESUME: Job ${job.id} will resume from ${jobWithResume.resumeTimestamp} (${resumeFromPercent.toFixed(1)}%) - auto-healed from ${job.progress.toFixed(1)}%`
      );
    }
    // APPROACH 2: Resume from existing temp file (legacy approach)
    else if (jobWithResume.tempFilePath && existsSync(jobWithResume.tempFilePath)) {
      // Verify temp file is valid (not corrupted)
      const isValid = await this.verifyPartialEncode(jobWithResume.tempFilePath);

      if (isValid) {
        // Calculate resume position from temp file metadata
        // This is a fallback if resumeTimestamp wasn't set
        this.logger.log(
          `🔄 TRUE RESUME: Found existing temp file for job ${job.id}, but no resumeTimestamp - restarting from 0%`
        );
        // Note: We could add logic here to extract the last encoded timestamp from the temp file
        // using ffprobe, but for now we'll just restart from 0% if resumeTimestamp is missing
      } else {
        this.logger.warn(
          `Temp file corrupted for job ${job.id}, restarting from 0%: ${jobWithResume.tempFilePath}`
        );
        // Delete corrupted temp file
        try {
          await fs.unlink(jobWithResume.tempFilePath);
        } catch {
          // Ignore
        }
        // Clear resume state via event
        this.eventEmitter.emit(
          EncodingProgressUpdateEvent.event,
          new EncodingProgressUpdateEvent(job.id, {
            progress: 0,
            etaSeconds: 0,
            fps: 0,
          })
        );
      }
    }

    // Detect hardware acceleration
    const hwaccel = await this.detectHardwareAcceleration();

    // Use custom output path if provided, otherwise use existing temp path or create new
    const tempOutput = customOutputPath || jobWithResume.tempFilePath || `${job.filePath}.tmp.mp4`;
    this.logger.debug(`[${job.id}] Output path: ${tempOutput}`);

    // Build ffmpeg command (with resume timestamp if resuming)
    const resumeTimestampValue = jobWithResume.resumeTimestamp ?? undefined;
    const args = this.buildFfmpegCommand(
      job,
      policy,
      hwaccel,
      tempOutput,
      resumeFromSeconds > 0 ? resumeTimestampValue : undefined
    );

    // Get nice value based on job priority
    const niceValue = this.getNiceValue(job.priority);

    // Spawn ffmpeg process with nice for CPU priority
    // If priority is non-zero, wrap ffmpeg in nice command
    let ffmpegProcess: ChildProcess;
    if (niceValue !== 0) {
      this.logger.log(
        `[${job.id}] Spawning FFmpeg with nice ${niceValue} (priority ${job.priority})`
      );
      // Spawn with nice for CPU priority control
      ffmpegProcess = spawn('nice', ['-n', niceValue.toString(), 'ffmpeg', ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true, // CRITICAL: Prevent process leak - allows child to run independently
      });
    } else {
      // Spawn ffmpeg directly (no priority adjustment needed)
      ffmpegProcess = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true, // CRITICAL: Prevent process leak - allows child to run independently
      });
    }

    this.logger.debug(
      `[${job.id}] FFmpeg process spawned (PID: ${ffmpegProcess.pid}), attaching stderr listener...`
    );

    // Track active encoding
    const activeEncoding: ActiveEncoding = {
      jobId: job.id,
      process: ffmpegProcess,
      startTime: new Date(),
      lastProgress: 0,
      lastStderr: '',
      lastOutputTime: new Date(), // Initialize to now
    };
    this.activeEncodings.set(job.id, activeEncoding);

    return new Promise((resolve, reject) => {
      let stderrBuffer = '';
      let fullStderr = '';

      // Parse FFmpeg -progress pipe:2 output from stderr
      // Accumulate progress data from key=value pairs
      let currentFrame = 0;
      let currentFps = 0;
      let currentTime = '00:00:00.00';

      ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderrBuffer += chunk;
        fullStderr += chunk;

        // Keep last 2000 chars of stderr for error reporting
        if (fullStderr.length > 2000) {
          fullStderr = fullStderr.slice(-2000);
        }
        activeEncoding.lastStderr = fullStderr;

        // Split on newlines to process each line
        const lines = stderrBuffer.split('\n');
        // Keep the last incomplete line in the buffer
        stderrBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Parse -progress pipe:2 format (key=value)
          if (trimmed.includes('=')) {
            const [key, value] = trimmed.split('=');
            switch (key) {
              case 'frame':
                currentFrame = Number.parseInt(value, 10) || 0;
                break;
              case 'fps':
                currentFps = Number.parseFloat(value) || 0;
                break;
              case 'out_time':
                currentTime = value;
                break;
              case 'out_time_us':
                // Fallback: use microseconds if out_time is N/A
                if (!currentTime || currentTime === 'N/A') {
                  const us = Number.parseInt(value, 10);
                  if (!Number.isNaN(us) && us > 0) {
                    // Convert to HH:MM:SS.ms format for consistency
                    const totalSeconds = us / 1_000_000;
                    const hours = Math.floor(totalSeconds / 3600);
                    const minutes = Math.floor((totalSeconds % 3600) / 60);
                    const seconds = totalSeconds % 60;
                    currentTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toFixed(6).padStart(9, '0')}`;
                  }
                }
                break;
              case 'progress':
                // When we see 'progress=continue' or 'progress=end', we have a complete update
                if (currentFrame > 0 && currentFps >= 0) {
                  activeEncoding.lastOutputTime = new Date();

                  this.handleProgressUpdate(
                    { frame: currentFrame, fps: currentFps, currentTime },
                    job,
                    activeEncoding,
                    estimatedDurationSeconds,
                    tempOutput,
                    resumeFromPercent
                  ).catch((error) => {
                    this.logger.error(`[${job.id}] Progress update error: ${error.message}`);
                  });
                }
                break;
            }
          }
        }
      });

      // Handle process completion
      ffmpegProcess.on('close', async (code) => {
        const encoding = this.activeEncodings.get(job.id);

        // Cache stderr before removing from active encodings
        if (encoding?.lastStderr) {
          this.cacheStderr(job.id, encoding.lastStderr);
        }

        // CRITICAL #10 & #11 FIX: Cleanup all job-related maps on completion
        this.activeEncodings.delete(job.id);
        this.lastPreviewGeneration.delete(job.id);

        if (code === 0) {
          try {
            await this.handleEncodingSuccess(job, policy, tempOutput);
            resolve();
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await this.handleEncodingFailure(job, tempOutput, errorMessage);
            reject(error);
          }
        } else {
          // Get detailed error message with stderr context and job progress
          const stderr = encoding?.lastStderr || '';
          const progress = job.progress || 0;
          const retryCount = job.retryCount || 0;
          const errorMessage = this.interpretFfmpegExitCode(
            code as number,
            stderr,
            progress,
            retryCount
          );
          await this.handleEncodingFailure(job, tempOutput, errorMessage);
          reject(new Error(errorMessage));
        }
      });

      // Handle process errors
      ffmpegProcess.on('error', async (error) => {
        const encoding = this.activeEncodings.get(job.id);

        // Cache stderr before removing from active encodings
        if (encoding?.lastStderr) {
          this.cacheStderr(job.id, encoding.lastStderr);
        }

        // CRITICAL #10 & #11 FIX: Cleanup all job-related maps on error
        this.activeEncodings.delete(job.id);
        this.lastPreviewGeneration.delete(job.id);

        let errorMessage = `FFmpeg Process Error: ${error.message}`;

        // Add stderr context if available
        if (encoding?.lastStderr) {
          errorMessage += '\n\nLast output from ffmpeg:\n';
          const stderrLines = encoding.lastStderr.trim().split('\n');
          errorMessage += stderrLines.slice(-15).join('\n');
        }

        await this.handleEncodingFailure(job, tempOutput, errorMessage);
        reject(error);
      });
    });
  }

  /**
   * Kill FFmpeg process for a job without marking it as cancelled
   *
   * Used by watchdog to terminate stuck processes before failing the job.
   * CRITICAL #1 FIX: Also used for graceful pause/cancel handling
   *
   * @param jobId - Job unique identifier
   * @param markProcessed - If true, update pauseProcessedAt/cancelProcessedAt timestamps
   * @returns True if process was found and killed, false if no active process
   */
  async killProcess(jobId: string, markProcessed = true): Promise<boolean> {
    const activeEncoding = this.activeEncodings.get(jobId);
    if (!activeEncoding) {
      return false;
    }

    try {
      // CRITICAL #1 FIX: Mark pause/cancel as processed before killing
      if (markProcessed) {
        const jobStatus = await this.jobRepository.findStatusFields(jobId);
        const updateData: Record<string, Date> = {};
        if (jobStatus?.pauseRequestedAt && !jobStatus.pauseProcessedAt) {
          updateData.pauseProcessedAt = new Date();
        }
        if (jobStatus?.cancelRequestedAt && !jobStatus.cancelProcessedAt) {
          updateData.cancelProcessedAt = new Date();
        }
        if (Object.keys(updateData).length > 0) {
          this.eventEmitter.emit(
            EncodingProcessMarkedEvent.event,
            new EncodingProcessMarkedEvent(jobId, updateData)
          );
        }
      }

      // Kill ffmpeg process
      activeEncoding.process.kill('SIGTERM');

      // Wait for graceful shutdown (2 seconds)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Force kill if still running
      if (!activeEncoding.process.killed) {
        activeEncoding.process.kill('SIGKILL');
      }

      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to kill FFmpeg process for job ${jobId}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Check if a job has an active FFmpeg process
   *
   * @param jobId - Job unique identifier
   * @returns True if process is active, false otherwise
   */
  hasActiveProcess(jobId: string): boolean {
    return this.activeEncodings.has(jobId);
  }

  /**
   * Get detailed info about all tracked active encodings (for debug UI)
   */
  getActiveEncodingsDetails(): Array<{
    jobId: string;
    pid: number | undefined;
    startTime: Date;
    lastProgress: number;
    lastOutputTime: Date;
    runtimeSeconds: number;
  }> {
    const result: Array<{
      jobId: string;
      pid: number | undefined;
      startTime: Date;
      lastProgress: number;
      lastOutputTime: Date;
      runtimeSeconds: number;
    }> = [];

    for (const [jobId, encoding] of this.activeEncodings) {
      result.push({
        jobId,
        pid: encoding.process.pid,
        startTime: encoding.startTime,
        lastProgress: encoding.lastProgress,
        lastOutputTime: encoding.lastOutputTime,
        runtimeSeconds: Math.floor((Date.now() - encoding.startTime.getTime()) / 1000),
      });
    }

    return result;
  }

  /**
   * Find system FFmpeg processes using ps command.
   * Delegates to FfmpegProcessCleanupService.
   */
  async findSystemFfmpegProcesses(): Promise<
    Array<{
      pid: number;
      command: string;
      cpuPercent: number;
      memPercent: number;
      runtimeSeconds: number;
    }>
  > {
    return this.processCleanup.findSystemFfmpegProcesses();
  }

  /**
   * Detect zombie FFmpeg processes
   *
   * A zombie FFmpeg process is one that:
   * - Is running on the system
   * - Is NOT tracked by our activeEncodings map
   *
   * These typically occur when:
   * - Backend was restarted but FFmpeg processes weren't killed
   * - A crash left orphaned processes
   */
  async detectZombieFfmpegProcesses(): Promise<
    Array<{
      pid: number;
      command: string;
      cpuPercent: number;
      memPercent: number;
      runtimeSeconds: number;
      isZombie: boolean;
      trackedJobId: string | null;
    }>
  > {
    const systemProcesses = await this.processCleanup.findSystemFfmpegProcesses();
    const trackedPids = new Set<number>();

    // Build set of PIDs we're tracking
    for (const encoding of this.activeEncodings.values()) {
      if (encoding.process.pid) {
        trackedPids.add(encoding.process.pid);
      }
    }

    // Map PIDs to job IDs
    const pidToJobId = new Map<number, string>();
    for (const [jobId, encoding] of this.activeEncodings) {
      if (encoding.process.pid) {
        pidToJobId.set(encoding.process.pid, jobId);
      }
    }

    // Mark each system process as zombie or tracked
    return systemProcesses.map((proc) => ({
      ...proc,
      isZombie: !trackedPids.has(proc.pid),
      trackedJobId: pidToJobId.get(proc.pid) || null,
    }));
  }

  /**
   * Kill a specific FFmpeg process by PID.
   * Delegates to FfmpegProcessCleanupService with tracked PID safety guard.
   *
   * @param pid - Process ID to kill
   * @returns True if killed successfully, false otherwise
   */
  async killFfmpegByPid(pid: number): Promise<{ success: boolean; message: string }> {
    // Build tracked PID sets to pass as safety guards
    const trackedPids = new Set<number>();
    const trackedPidToJobId = new Map<number, string>();
    for (const [jobId, encoding] of this.activeEncodings) {
      if (encoding.process.pid) {
        trackedPids.add(encoding.process.pid);
        trackedPidToJobId.set(encoding.process.pid, jobId);
      }
    }
    return this.processCleanup.killFfmpegByPid(pid, trackedPids, trackedPidToJobId);
  }

  /**
   * Kill all zombie FFmpeg processes
   *
   * Finds and kills all FFmpeg processes that aren't tracked by activeEncodings
   *
   * @returns Summary of killed processes
   */
  async killAllZombieFfmpegProcesses(): Promise<{
    killed: number;
    failed: number;
    details: Array<{ pid: number; success: boolean; message: string }>;
  }> {
    const zombies = await this.detectZombieFfmpegProcesses();
    const zombieProcesses = zombies.filter((p) => p.isZombie);

    const details: Array<{ pid: number; success: boolean; message: string }> = [];
    let killed = 0;
    let failed = 0;

    for (const zombie of zombieProcesses) {
      const result = await this.killFfmpegByPid(zombie.pid);
      details.push({ pid: zombie.pid, ...result });
      if (result.success) {
        killed++;
      } else {
        failed++;
      }
    }

    this.logger.log(`Zombie cleanup complete: ${killed} killed, ${failed} failed`);
    return { killed, failed, details };
  }

  /**
   * HIGH #10 FIX: Kill ALL ffmpeg processes (not just zombies)
   * Used on startup to clean up orphaned processes from previous crashes/restarts
   *
   * @returns Number of processes killed
   */
  async killAllFfmpegProcesses(): Promise<{
    killed: number;
    failed: number;
    details: Array<{ pid: number; success: boolean; message: string }>;
  }> {
    const allProcesses = await this.detectZombieFfmpegProcesses();
    // Don't filter by isZombie - kill ALL ffmpeg processes

    const details: Array<{ pid: number; success: boolean; message: string }> = [];
    let killed = 0;
    let failed = 0;

    for (const proc of allProcesses) {
      const result = await this.killFfmpegByPid(proc.pid);
      details.push({ pid: proc.pid, ...result });
      if (result.success) {
        killed++;
      } else {
        failed++;
      }
    }

    this.logger.log(`All ffmpeg processes cleanup: ${killed} killed, ${failed} failed`);
    return { killed, failed, details };
  }

  /**
   * Get the last time FFmpeg produced output for a job
   *
   * @param jobId - Job unique identifier
   * @returns Last output timestamp, or undefined if not encoding
   */
  getLastOutputTime(jobId: string): Date | undefined {
    return this.activeEncodings.get(jobId)?.lastOutputTime;
  }

  /**
   * Check if a job's FFmpeg process is truly stuck (no output at all)
   *
   * Differentiates between:
   * - Truly stuck jobs: No FFmpeg output for X minutes (frozen, needs kill)
   * - Slow but active jobs: FFmpeg producing output, just slowly (let it run)
   *
   * @param jobId - Job unique identifier
   * @param timeoutMinutes - Minutes without output before considering stuck
   * @returns True if job has had no FFmpeg output for specified time
   */
  isProcessTrulyStuck(jobId: string, timeoutMinutes: number): boolean {
    const encoding = this.activeEncodings.get(jobId);
    if (!encoding) {
      return false; // No active process
    }

    const now = new Date();
    const minutesSinceOutput = (now.getTime() - encoding.lastOutputTime.getTime()) / 1000 / 60;
    return minutesSinceOutput >= timeoutMinutes;
  }

  /**
   * Cancel encoding job
   *
   * Kills the ffmpeg process and marks job as cancelled.
   * Cleans up temporary files.
   *
   * @param jobId - Job unique identifier
   * @returns True if cancelled, false if job not found or already completed
   */
  async cancelEncoding(jobId: string): Promise<boolean> {
    const activeEncoding = this.activeEncodings.get(jobId);
    if (!activeEncoding) {
      this.logger.warn(`Cannot cancel job ${jobId}: not currently encoding`);
      return false;
    }

    this.logger.log(`Cancelling encoding for job ${jobId}`);

    try {
      // Kill ffmpeg process
      activeEncoding.process.kill('SIGTERM');

      // Wait for graceful shutdown (2 seconds)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Force kill if still running
      if (!activeEncoding.process.killed) {
        activeEncoding.process.kill('SIGKILL');
      }

      // Mark job as cancelled via event
      this.eventEmitter.emit(EncodingCancelledEvent.event, new EncodingCancelledEvent(jobId));

      // Cache stderr before removing from active encodings
      if (activeEncoding.lastStderr) {
        this.cacheStderr(jobId, activeEncoding.lastStderr);
      }

      this.activeEncodings.delete(jobId);
      this.logger.log(`Encoding cancelled for job ${jobId}`);
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to cancel job ${jobId}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Pause encoding job
   *
   * Sends SIGSTOP signal to pause the ffmpeg process.
   *
   * @param jobId - Job unique identifier
   * @returns True if paused, false if job not found or not encoding
   */
  async pauseEncoding(jobId: string): Promise<boolean> {
    const activeEncoding = this.activeEncodings.get(jobId);
    if (!activeEncoding) {
      this.logger.warn(`Cannot pause job ${jobId}: not currently encoding`);
      return false;
    }

    this.logger.log(`Pausing encoding for job ${jobId}`);

    try {
      // Send SIGSTOP to pause the process
      activeEncoding.process.kill('SIGSTOP');
      this.logger.log(`Encoding paused for job ${jobId}`);
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to pause job ${jobId}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Resume encoding job
   *
   * Sends SIGCONT signal to resume the paused ffmpeg process.
   *
   * @param jobId - Job unique identifier
   * @returns True if resumed, false if job not found or not encoding
   */
  async resumeEncoding(jobId: string): Promise<boolean> {
    const activeEncoding = this.activeEncodings.get(jobId);
    if (!activeEncoding) {
      this.logger.warn(`Cannot resume job ${jobId}: not currently encoding`);
      return false;
    }

    this.logger.log(`Resuming encoding for job ${jobId}`);

    try {
      // Send SIGCONT to resume the process
      activeEncoding.process.kill('SIGCONT');
      this.logger.log(`Encoding resumed for job ${jobId}`);
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to resume job ${jobId}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Get last stderr output for a job
   *
   * Returns the last 2000 characters of ffmpeg stderr output for error reporting.
   * Useful for diagnosing stuck or failed jobs.
   *
   * @param jobId - Job unique identifier
   * @returns Last stderr output, or null if job not found
   */
  getLastStderr(jobId: string): string | null {
    // First check active encodings
    const activeEncoding = this.activeEncodings.get(jobId);
    if (activeEncoding?.lastStderr) {
      return activeEncoding.lastStderr;
    }

    // If not active, check the stderr cache for recently completed/failed jobs
    const cachedStderr = this.stderrCache.get(jobId);
    if (cachedStderr) {
      // Clean up old entries while we're here
      this.cleanupStderrCache();
      return cachedStderr.stderr;
    }

    return null;
  }

  /**
   * Clean up old stderr cache entries to prevent memory leaks
   */
  private cleanupStderrCache(): void {
    const now = Date.now();
    for (const [jobId, entry] of this.stderrCache.entries()) {
      if (now - entry.timestamp.getTime() > this.STDERR_CACHE_TTL_MS) {
        this.stderrCache.delete(jobId);
      }
    }
  }

  /**
   * Save stderr to cache before removing from active encodings
   */
  private cacheStderr(jobId: string, stderr: string): void {
    if (stderr) {
      this.stderrCache.set(jobId, {
        stderr,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Interpret ffmpeg exit code and return detailed error message
   *
   * ENHANCED: Uses FFmpeg Error Analyzer for human-readable explanations
   *
   * Common ffmpeg exit codes:
   * - 0: Success
   * - 1: Generic error (check stderr for decoder errors)
   * - 255/-1: Aborted/interrupted
   * - Other codes: Various specific errors
   *
   * @param code - FFmpeg exit code
   * @param stderr - Last stderr output for context
   * @param progress - Current job progress (0-100), defaults to 0
   * @param retryCount - Number of retry attempts, defaults to 0
   * @returns Detailed error message with explanation and recommendations
   */
  private interpretFfmpegExitCode(
    code: number,
    stderr: string,
    progress = 0,
    retryCount = 0
  ): string {
    // Use new error analyzer for human-readable explanations
    const {
      analyzeFfmpegError,
      formatErrorForDisplay,
    } = require('./utils/ffmpeg-error-analyzer.util');

    const analysis = analyzeFfmpegError(code, stderr, progress, retryCount);
    return formatErrorForDisplay(analysis);
  }

  /**
   * Get active encoding jobs
   *
   * @returns Array of job IDs currently being encoded
   */
  getActiveEncodings(): string[] {
    return Array.from(this.activeEncodings.keys());
  }

  /**
   * Get encoding status for a specific job
   *
   * @param jobId - Job unique identifier
   * @returns Encoding info or null if not active
   */
  getEncodingStatus(jobId: string): {
    jobId: string;
    startTime: Date;
    elapsedSeconds: number;
  } | null {
    const activeEncoding = this.activeEncodings.get(jobId);
    if (!activeEncoding) {
      return null;
    }

    const elapsedSeconds = Math.floor((Date.now() - activeEncoding.startTime.getTime()) / 1000);

    return {
      jobId: activeEncoding.jobId,
      startTime: activeEncoding.startTime,
      elapsedSeconds,
    };
  }

  /**
   * Encode a file with custom options (simplified interface)
   *
   * @param jobId - Job unique identifier
   * @param options - Encoding options
   */
  async encode(
    jobId: string,
    options: {
      inputPath: string;
      outputPath: string;
      targetCodec: string;
      targetQuality: number;
      hwAccel?: string;
      advancedSettings?: Record<string, unknown>;
      startedFromSeconds?: number; // TRUE RESUME: FFmpeg input seeking position
    }
  ): Promise<void> {
    // TRUE RESUME: Calculate progress and resumeTimestamp if startedFromSeconds is provided
    let progress = 0;
    let resumeTimestamp: string | undefined;
    let tempFilePath: string | undefined;

    if (options.startedFromSeconds && options.startedFromSeconds > 0) {
      // Get video duration to calculate progress percentage
      const durationSeconds = await this.getVideoDuration(options.inputPath);
      progress = (options.startedFromSeconds / durationSeconds) * 100;
      resumeTimestamp = this.formatSecondsToTimestamp(options.startedFromSeconds);
      tempFilePath = options.outputPath; // Temp file path is the output path

      this.logger.log(
        `TRUE RESUME: encode() called with startedFromSeconds=${options.startedFromSeconds}, progress=${progress.toFixed(1)}%, resumeTimestamp=${resumeTimestamp}`
      );
    }

    // Create a minimal job object for encodeFile
    const job: JobWithAllFields = {
      id: jobId,
      type: 'ENCODE',
      filePath: options.inputPath,
      fileLabel: '',
      sourceCodec: '',
      sourceContainer: null,
      targetCodec: options.targetCodec,
      targetContainer: null,
      stage: 'ENCODING' as const,
      progress,
      etaSeconds: null,
      fps: null,
      beforeSizeBytes: BigInt(0),
      afterSizeBytes: null,
      savedBytes: null,
      savedPercent: null,
      startedAt: new Date(),
      completedAt: null,
      failedAt: null,
      error: null,
      isBlacklisted: false,
      retryCount: 0,
      nextRetryAt: null,
      autoHealedAt: null,
      autoHealedProgress: null,
      healthStatus: 'UNKNOWN',
      healthScore: 0,
      healthMessage: null,
      healthCheckedAt: null,
      healthCheckStartedAt: null,
      healthCheckRetries: 0,
      decisionRequired: false,
      decisionIssues: null,
      decisionMadeAt: null,
      decisionData: null,
      priority: 0,
      prioritySetAt: null,
      pauseRequestedAt: null, // CRITICAL #5 FIX
      pauseProcessedAt: null, // CRITICAL #1 FIX
      cancelRequestedAt: null, // CRITICAL #5 FIX
      cancelProcessedAt: null, // CRITICAL #1 FIX
      tempFilePath: resumeTimestamp && tempFilePath ? tempFilePath : null,
      resumeTimestamp: resumeTimestamp || null,
      lastProgressUpdate: null,
      // CRITICAL FIX #2 & #4: Add new schema fields
      lastHeartbeat: null,
      heartbeatNodeId: null,
      lastStageChangeAt: null,
      previewImagePaths: null,
      keepOriginalRequested: false,
      originalBackupPath: null,
      originalSizeBytes: null,
      replacementAction: null,
      warning: null,
      resourceThrottled: false,
      resourceThrottleReason: null,
      ffmpegThreads: null,
      startedFromSeconds: null,
      healingPointSeconds: null,
      nodeId: '',
      libraryId: '',
      policyId: '',
      originalNodeId: null,
      manualAssignment: false,
      transferRequired: false,
      originalFilePath: null,
      transferProgress: 0,
      transferSpeedMBps: null,
      transferStartedAt: null,
      transferCompletedAt: null,
      transferLastProgressAt: null, // DEEP AUDIT P0
      transferError: null,
      remoteTempPath: null,
      transferRetryCount: 0,
      // Distribution v2 fields
      assignedAt: null,
      stickyUntil: null,
      migrationCount: 0,
      estimatedDuration: null,
      estimatedStartAt: null,
      estimatedCompleteAt: null,
      lastScoreBreakdown: null,
      assignmentReason: null,
      // DEEP AUDIT P2: Auto-heal claim fields
      autoHealClaimedAt: null,
      autoHealClaimedBy: null,
      // Resilience fields
      corruptedRequeueCount: 0,
      stuckRecoveryCount: 0,
      contentFingerprint: null,
      qualityMetrics: null,
      qualityMetricsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const policy = {
      id: '',
      name: '',
      preset: 'CUSTOM' as const,
      targetCodec: options.targetCodec,
      targetQuality: options.targetQuality,
      deviceProfiles: {},
      advancedSettings: options.advancedSettings || {},
      atomicReplace: false,
      verifyOutput: false,
      skipSeeding: false,
      libraryId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Policy;

    await this.encodeFile(job, policy, options.outputPath);
  }

  /**
   * Verify that an encoded file is valid and playable.
   * Delegates to FfprobeService.
   *
   * @param filePath - Path to file to verify
   * @returns Object with isValid flag and optional error details
   */
  async verifyFile(filePath: string): Promise<{ isValid: boolean; error?: string }> {
    return this.ffprobe.verifyFile(filePath);
  }
}
