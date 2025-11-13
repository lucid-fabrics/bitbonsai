import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AccelerationType, Job, Policy } from '@prisma/client';
import { QueueService } from '../queue/queue.service';
import type { EncodingProgressDto } from './dto/encoding-progress.dto';
import { EncodingPreviewService } from './encoding-preview.service';

/**
 * Hardware acceleration configuration for different platforms
 */
interface HardwareAccelConfig {
  type: AccelerationType;
  flags: string[];
  videoCodec: string;
}

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
 */
@Injectable()
export class FfmpegService implements OnModuleDestroy {
  private readonly logger = new Logger(FfmpegService.name);
  private readonly activeEncodings = new Map<string, ActiveEncoding>();

  // Cache stderr output for recently completed/failed jobs
  // This persists even after the job is removed from activeEncodings
  private readonly stderrCache = new Map<string, { stderr: string; timestamp: Date }>();
  private readonly STDERR_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  // Preview generation throttling (jobId -> last generation timestamp)
  private readonly lastPreviewGeneration = new Map<string, number>();
  private readonly PREVIEW_THROTTLE_MS = 30 * 1000; // 30 seconds

  // PERFORMANCE: FFprobe result caching (filePath -> video info)
  private readonly codecCache = new Map<
    string,
    { codec: string; container: string; timestamp: Date }
  >();
  private readonly CODEC_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  private readonly CODEC_CACHE_MAX_SIZE = 5000; // ~500KB max
  private readonly CODEC_CACHE_CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  private lastCacheCleanup = 0;

  // Regex for parsing ffmpeg progress output
  // Example: frame= 2450 fps= 87 q=28.0 size=   12288kB time=00:01:42.50 bitrate=1234.5kbits/s speed=3.62x
  private readonly progressRegex = /frame=\s*(\d+).*fps=\s*([\d.]+).*time=\s*([\d:.]+)/;

  /**
   * SECURITY: Whitelist of allowed FFmpeg flags
   * Prevents command injection by only allowing safe, predefined flags
   * LOW PRIORITY FIX #18: Expanded whitelist for more encoding options
   */
  private readonly ALLOWED_FFMPEG_FLAGS = new Set([
    // Video encoding options
    '-preset',
    '-crf',
    '-maxrate',
    '-bufsize',
    '-pix_fmt',
    '-profile:v',
    '-level',
    '-g',
    '-keyint_min',
    '-sc_threshold',
    '-tune', // LOW PRIORITY FIX #18: Tune for film/animation/grain
    '-refs', // LOW PRIORITY FIX #18: Reference frames
    '-rc_lookahead', // LOW PRIORITY FIX #18: Rate control lookahead
    '-b:v', // LOW PRIORITY FIX #18: Video bitrate
    '-minrate', // LOW PRIORITY FIX #18: Minimum bitrate
    '-x265-params', // LOW PRIORITY FIX #18: x265 encoder params
    '-x264-params', // LOW PRIORITY FIX #18: x264 encoder params

    // Audio encoding options
    '-c:a',
    '-b:a',
    '-ar',
    '-ac',

    // Filtering options (safe filters only)
    '-vf',
    '-af',

    // Format options
    '-f',
    '-movflags',

    // Subtitle options
    '-c:s',
    '-scodec', // LOW PRIORITY FIX #18: Subtitle codec

    // Metadata options
    '-metadata',
    '-map_metadata',

    // Mapping options
    '-map', // LOW PRIORITY FIX #18: Stream mapping

    // Threading options
    '-threads',

    // Quality/compression options
    '-qmin',
    '-qmax',
    '-qdiff',
    '-qcomp', // LOW PRIORITY FIX #18: Quantizer compression
  ]);

  constructor(
    @Inject(forwardRef(() => QueueService))
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
    private readonly previewService: EncodingPreviewService
  ) {}

  /**
   * HIGH PRIORITY FIX: OnModuleDestroy lifecycle hook to kill all FFmpeg processes
   * Prevents zombie FFmpeg processes when backend shuts down or restarts
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('FfmpegService shutting down - killing all active FFmpeg processes');

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
        } catch (error) {
          // ESRCH error means process already dead - that's fine
          const err = error as NodeJS.ErrnoException;
          if (err.code !== 'ESRCH') {
            this.logger.warn(`Failed to kill FFmpeg for job ${jobId}: ${error}`);
          }
        }
      });

      await Promise.allSettled(killPromises);

      // Clear all tracking maps
      this.activeEncodings.clear();

      this.logger.log('FFmpeg cleanup complete');
    }

    // PERFORMANCE: Clear codec cache on shutdown
    this.codecCache.clear();
    this.logger.log('Codec cache cleared');
  }

  /**
   * SECURITY: Validate and filter FFmpeg flags
   * Only allows whitelisted flags to prevent command injection
   *
   * @param flags - Array of FFmpeg flags from policy advanced settings
   * @returns Filtered array of safe flags
   * @throws Error if any disallowed flags are found
   */
  private validateFfmpegFlags(flags: string[]): string[] {
    const validatedFlags: string[] = [];

    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i];

      // Check if flag is in whitelist
      if (!this.ALLOWED_FFMPEG_FLAGS.has(flag)) {
        this.logger.warn(`Blocked disallowed FFmpeg flag: ${flag}`);
        throw new Error(`FFmpeg flag '${flag}' is not allowed for security reasons`);
      }

      validatedFlags.push(flag);

      // If flag takes a value, include the next argument
      // (e.g., "-preset fast" -> ["-preset", "fast"])
      if (i + 1 < flags.length && !flags[i + 1].startsWith('-')) {
        const value = flags[i + 1];

        // SECURITY: Special validation for -map flag to prevent file path injection
        if (flag === '-map') {
          // -map values must match pattern: [input_index]:[stream_type]:[stream_index]
          // Examples: "0:v:0", "1:a:1", "0:s:0"
          // Reject file paths like "file:/etc/passwd" or "../sensitive/file"
          if (!/^[0-9]+:[vascdt]:[0-9]+$/.test(value) && value !== '0') {
            throw new Error(
              `FFmpeg -map flag value '${value}' is invalid. Must match pattern [input]:[type]:[index] (e.g., "0:v:0")`
            );
          }
        } else {
          // SECURITY: Sanitize value to prevent command injection
          // Only allow alphanumeric, dash, underscore, colon, dot, and comma
          if (!/^[a-zA-Z0-9\-_:.,=]+$/.test(value)) {
            throw new Error(`FFmpeg flag value '${value}' contains invalid characters`);
          }
        }

        validatedFlags.push(value);
        i++; // Skip next iteration since we already processed the value
      }
    }

    return validatedFlags;
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
    this.logger.log('Detecting hardware acceleration capabilities...');

    // Check NVIDIA GPU
    try {
      const nvidiaSmi = spawn('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']);
      const nvidiaAvailable = await new Promise<boolean>((resolve) => {
        nvidiaSmi.on('error', () => resolve(false));
        nvidiaSmi.on('close', (code) => resolve(code === 0));
      });

      if (nvidiaAvailable) {
        this.logger.log('NVIDIA GPU detected - using NVENC acceleration');
        return {
          type: 'NVIDIA',
          flags: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
          videoCodec: 'hevc_nvenc',
        };
      }
    } catch {
      // NVIDIA not available
    }

    // Check Intel QSV
    if (existsSync('/dev/dri/renderD128')) {
      this.logger.log('Intel QSV detected - using Quick Sync Video acceleration');
      return {
        type: 'INTEL_QSV',
        flags: ['-hwaccel', 'qsv', '-c:v', 'h264_qsv'],
        videoCodec: 'hevc_qsv',
      };
    }

    // Check AMD VAAPI
    if (existsSync('/dev/dri/renderD129')) {
      this.logger.log('AMD GPU detected - using VAAPI acceleration');
      return {
        type: 'AMD',
        flags: ['-hwaccel', 'vaapi', '-vaapi_device', '/dev/dri/renderD128'],
        videoCodec: 'hevc_vaapi',
      };
    }

    // Check Apple M (macOS)
    if (process.platform === 'darwin') {
      this.logger.log('macOS detected - using VideoToolbox acceleration');
      return {
        type: 'APPLE_M',
        flags: ['-hwaccel', 'videotoolbox'],
        videoCodec: 'hevc_videotoolbox',
      };
    }

    // Fallback to CPU
    this.logger.log('No hardware acceleration detected - using CPU encoding');
    return {
      type: 'CPU',
      flags: [],
      videoCodec: 'libx265',
    };
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
    const args: string[] = [];

    // Check if this is a REMUX job (container change only, no re-encoding)
    const jobWithType = job as any;
    const isRemux = jobWithType.type === 'REMUX';

    if (isRemux) {
      // REMUX MODE: Fast stream copy (no re-encoding)
      this.logger.log(
        `REMUX MODE: Container change only (${jobWithType.sourceContainer} → ${jobWithType.targetContainer})`
      );

      // Input file
      args.push('-i', job.filePath);

      // Stream copy for video and audio (no re-encoding)
      args.push('-c:v', 'copy');
      args.push('-c:a', 'copy');

      // Copy all streams (subtitles, metadata, etc.)
      args.push('-map', '0');
    } else {
      // ENCODE MODE: Full transcode with quality settings
      this.logger.log(`ENCODE MODE: Full transcode (${job.sourceCodec} → ${job.targetCodec})`);

      // TRUE RESUME: Add input seeking BEFORE -i for accurate frame seeking
      // This skips the already-encoded portion of the input file
      if (resumeFromTimestamp) {
        args.push('-ss', resumeFromTimestamp);
        this.logger.log(`TRUE RESUME: Using FFmpeg input seeking: -ss ${resumeFromTimestamp}`);
      }

      // Hardware acceleration flags (if available)
      args.push(...hwaccel.flags);

      // Input file
      args.push('-i', job.filePath);

      // Video codec and quality
      args.push('-c:v', hwaccel.videoCodec);
      args.push('-crf', policy.targetQuality.toString());

      // Audio codec (from policy advanced settings)
      const advancedSettings = policy.advancedSettings as Record<string, unknown>;
      const audioCodec = (advancedSettings.audioCodec as string) || 'copy';
      args.push('-c:a', audioCodec);

      // AV1 THROTTLING: Apply thread limit if specified on job
      const jobWithThreads = job as any;
      if (jobWithThreads.ffmpegThreads) {
        args.push('-threads', jobWithThreads.ffmpegThreads.toString());
        this.logger.warn(
          `[${job.id}] Using ${jobWithThreads.ffmpegThreads} threads (resource throttled: ${jobWithThreads.resourceThrottleReason || 'unknown reason'})`
        );
      }

      // SECURITY: Validate and add additional ffmpeg flags from policy
      if (advancedSettings.ffmpegFlags) {
        const customFlags = advancedSettings.ffmpegFlags as string[];
        try {
          const validatedFlags = this.validateFfmpegFlags(customFlags);
          args.push(...validatedFlags);
        } catch (error) {
          this.logger.error(
            `Invalid FFmpeg flags in policy: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
          throw error;
        }
      }
    }

    // Progress reporting (use stats format which outputs one-line progress)
    // -stats forces output even in non-interactive mode (pipes)
    args.push('-stats', '-stats_period', '1');

    // Output to specified path (temp file that will be renamed atomically)
    // Determine output format based on job type and target container
    const targetContainer = jobWithType.targetContainer || 'mkv';

    if (targetContainer === 'mp4' || targetContainer.includes('mp4')) {
      // MP4 format with fragmentation for streaming compatibility
      // Use fragmented MP4 for instant readability (moov atom at start)
      // This allows preview captures to work at any encoding progress
      args.push('-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4');
    } else if (targetContainer === 'mkv' || targetContainer.includes('matroska')) {
      // MKV format (no special flags needed)
      args.push('-f', 'matroska');
    } else {
      // Default to MKV for unknown containers
      this.logger.warn(`Unknown target container '${targetContainer}', defaulting to MKV`);
      args.push('-f', 'matroska');
    }

    // Overwrite output file if it exists
    args.push('-y', outputPath);

    this.logger.debug(`ffmpeg command: ffmpeg ${args.join(' ')}`);
    return args;
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
    const match = this.progressRegex.exec(line);
    if (!match) {
      return null;
    }

    return {
      frame: Number.parseInt(match[1], 10),
      fps: Number.parseFloat(match[2]),
      currentTime: match[3],
    };
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
    // Parse HH:MM:SS.MS format
    const parts = currentTime.split(':');
    if (parts.length !== 3) {
      return 0;
    }

    const hours = Number.parseInt(parts[0], 10);
    const minutes = Number.parseInt(parts[1], 10);
    const seconds = Number.parseFloat(parts[2]);

    const currentSeconds = hours * 3600 + minutes * 60 + seconds;
    const percentage = (currentSeconds / totalDurationSeconds) * 100;

    return Math.min(100, Math.max(0, percentage));
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
  private handleProgressUpdate(
    progressData: Pick<EncodingProgressDto, 'frame' | 'fps' | 'currentTime'>,
    job: Job,
    activeEncoding: ActiveEncoding,
    estimatedDurationSeconds: number,
    tempOutput: string,
    resumeFromPercent = 0
  ): void {
    // Calculate current progress based on time position
    const currentProgress = this.calculateProgressPercentage(
      progressData.currentTime,
      estimatedDurationSeconds
    );

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
    if (adjustedProgress - activeEncoding.lastProgress >= 0.1) {
      this.logger.debug(
        `[${job.id}] Updating database: ${adjustedProgress.toFixed(2)}% @ ${progressData.currentTime} (ETA: ${eta}s)`
      );
      this.queueService
        .updateProgress(job.id, {
          progress: Math.round(adjustedProgress * 100) / 100, // Round to 2 decimal places
          etaSeconds: eta,
          fps: progressData.fps,
          // TRUE RESUME: Save resume state for crash recovery
          resumeTimestamp: progressData.currentTime,
          tempFilePath: tempOutput,
        })
        .catch((error) => {
          this.logger.error(`Failed to update job progress: ${error.message}`);
        });
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
              // Update job with preview paths
              this.queueService.updateJobPreview(job.id, previewPaths).catch((err) => {
                this.logger.warn(
                  `Failed to update preview paths for job ${job.id}: ${err.message}`
                );
              });
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
    await this.sleep(5000);

    // ROCK SOLID FIX: Verify temp file EXISTS with retries (filesystem may need time to sync)
    const fileExists = await this.waitForFileExists(tempOutput, 10, 2000);
    if (!fileExists) {
      throw new Error(
        `Temp file missing after 20 seconds: ${tempOutput}\n` +
          `FFmpeg reported success but file was not written to disk.`
      );
    }

    // ROCK SOLID FIX: Verify temp file is VALID before rename with retries
    if (policy.verifyOutput) {
      this.logger.log(`Verifying temp file with retries: ${tempOutput}`);
      const verifyResult = await this.verifyFileWithRetries(tempOutput, 10);
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

    await this.queueService.failJob(job.id, errorMessage);
  }

  /**
   * ISSUE #11 FIX: Get video duration from FFprobe before encoding
   *
   * Uses ffprobe to extract the actual video duration for accurate progress calculation.
   * Falls back to 3600 seconds if ffprobe fails or duration cannot be determined.
   *
   * @param filePath - Path to video file
   * @returns Duration in seconds, or 3600 if unable to determine
   */
  async getVideoDuration(filePath: string): Promise<number> {
    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);

      let output = '';

      ffprobe.stdout?.on('data', (data) => {
        output += data.toString();
      });

      // AUDIT #2 ISSUE #26 FIX: Store timeout ID for cleanup to prevent orphaned timeouts
      const timeoutId = setTimeout(() => {
        ffprobe.kill();
        this.logger.warn(`[${filePath}] FFprobe timeout, using fallback 3600s`);
        resolve(3600);
      }, 10000);

      ffprobe.on('close', (code) => {
        // AUDIT #2 ISSUE #26 FIX: Clear timeout on completion
        clearTimeout(timeoutId);

        if (code === 0 && output.trim()) {
          try {
            const duration = Number.parseFloat(output.trim());
            if (!Number.isNaN(duration) && duration > 0) {
              this.logger.debug(`[${filePath}] FFprobe detected duration: ${duration.toFixed(2)}s`);
              resolve(duration);
              return;
            }
          } catch {
            // Fall through to default
          }
        }

        // Fall back to default 3600s if ffprobe fails or returns invalid data
        this.logger.warn(
          `[${filePath}] Failed to get duration from ffprobe (code: ${code}), using fallback 3600s`
        );
        resolve(3600);
      });

      ffprobe.on('error', (err) => {
        // AUDIT #2 ISSUE #26 FIX: Clear timeout on error
        clearTimeout(timeoutId);
        this.logger.warn(`[${filePath}] FFprobe error: ${err.message}, using fallback 3600s`);
        resolve(3600);
      });
    });
  }

  /**
   * Get video codec and container information using ffprobe
   *
   * @param filePath - Path to video file
   * @returns Object with codec name and container format
   */
  async getVideoInfo(filePath: string): Promise<{ codec: string; container: string }> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name:format=format_name',
        '-of',
        'json',
        filePath,
      ]);

      let output = '';

      ffprobe.stdout?.on('data', (data) => {
        output += data.toString();
      });

      const timeoutId = setTimeout(() => {
        ffprobe.kill();
        reject(new Error('FFprobe timeout'));
      }, 10000);

      ffprobe.on('close', (code) => {
        clearTimeout(timeoutId);

        if (code === 0 && output.trim()) {
          try {
            const data = JSON.parse(output);
            const codec = data.streams?.[0]?.codec_name || 'unknown';
            const container = data.format?.format_name?.split(',')[0] || 'unknown';

            resolve({ codec, container });
            return;
          } catch {
            reject(new Error('Failed to parse ffprobe output'));
          }
        }

        reject(new Error(`FFprobe failed with code ${code}`));
      });

      ffprobe.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
    });
  }

  /**
   * PERFORMANCE: Get video info with caching (1-hour TTL)
   * Reduces repeated FFprobe calls for the same file
   *
   * @param filePath - Path to video file
   * @returns Object with codec name and container format
   */
  async getVideoInfoCached(filePath: string): Promise<{ codec: string; container: string }> {
    // Check cache first
    const cached = this.codecCache.get(filePath);
    if (cached) {
      const age = Date.now() - cached.timestamp.getTime();
      if (age < this.CODEC_CACHE_TTL_MS) {
        this.logger.debug(`[CACHE HIT] Using cached codec info for: ${filePath}`);
        return { codec: cached.codec, container: cached.container };
      }
      // Cache expired - remove it
      this.codecCache.delete(filePath);
    }

    // Cache miss - fetch from FFprobe
    this.logger.debug(`[CACHE MISS] Fetching codec info via FFprobe: ${filePath}`);
    const result = await this.getVideoInfo(filePath);

    // Enforce max cache size with LRU eviction (remove oldest entry)
    if (this.codecCache.size >= this.CODEC_CACHE_MAX_SIZE) {
      const oldestKey = this.codecCache.keys().next().value;
      if (oldestKey) {
        this.codecCache.delete(oldestKey);
        this.logger.debug(`Cache full - evicted oldest entry: ${oldestKey}`);
      }
    }

    // Store in cache
    this.codecCache.set(filePath, {
      codec: result.codec,
      container: result.container,
      timestamp: new Date(),
    });

    // Periodic cleanup (only every 15 minutes instead of per-write)
    const now = Date.now();
    if (now - this.lastCacheCleanup > this.CODEC_CACHE_CLEANUP_INTERVAL_MS) {
      this.cleanupCodecCache();
      this.lastCacheCleanup = now;
    }

    return result;
  }

  /**
   * PERFORMANCE: Clean up expired codec cache entries
   * Runs periodically (every 15 min) to prevent unbounded growth
   * @private
   */
  private cleanupCodecCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [filePath, entry] of this.codecCache.entries()) {
      const age = now - entry.timestamp.getTime();
      if (age >= this.CODEC_CACHE_TTL_MS) {
        this.codecCache.delete(filePath);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired codec cache entries (${this.codecCache.size} remaining)`);
    }
  }

  /**
   * Normalize codec name to standard format
   * Maps various codec names to standardized identifiers
   */
  normalizeCodec(codec: string): string {
    const codecMap: Record<string, string> = {
      hevc: 'hevc',
      h265: 'hevc',
      hvc1: 'hevc',
      h264: 'h264',
      avc: 'h264',
      avc1: 'h264',
      vp9: 'vp9',
      av1: 'av1',
    };
    return codecMap[codec.toLowerCase()] || codec.toLowerCase();
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
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        // File doesn't exist yet - validate parent directory
        const parent = path.dirname(resolvedFile);
        try {
          const realParent = fs.realpathSync(parent);
          const realLibrary = fs.realpathSync(resolvedLibrary);

          if (!realParent.startsWith(realLibrary + path.sep)) {
            throw new Error(`File path '${filePath}' is outside library boundary`);
          }
        } catch (parentErr) {
          const message = parentErr instanceof Error ? parentErr.message : 'Unknown error';
          throw new Error(`Invalid file path: ${message}`);
        }
      } else {
        throw err;
      }
    }
  }

  /**
   * TRUE RESUME: Verify partial encoded file is valid (not corrupted)
   *
   * @param filePath - Path to partial temp file
   * @returns True if file is valid and can be used for resume
   * @private
   */
  private async verifyPartialEncode(filePath: string): Promise<boolean> {
    try {
      // Use ffprobe to check if file has valid video stream
      const result = await this.verifyFile(filePath);
      return result.isValid;
    } catch {
      return false;
    }
  }

  /**
   * TRUE RESUME: Parse HH:MM:SS.MS timestamp to seconds
   *
   * @param timestamp - Time string in HH:MM:SS.MS format
   * @returns Time in seconds
   * @private
   */
  private parseTimestampToSeconds(timestamp: string): number {
    const parts = timestamp.split(':');
    if (parts.length !== 3) {
      return 0;
    }

    const hours = Number.parseInt(parts[0], 10);
    const minutes = Number.parseInt(parts[1], 10);
    const seconds = Number.parseFloat(parts[2]);

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * TRUE RESUME: Convert seconds to HH:MM:SS.MS timestamp format
   *
   * @param totalSeconds - Time in seconds
   * @returns Time string in HH:MM:SS.MS format
   */
  formatSecondsToTimestamp(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((seconds % 1) * 100);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${Math.floor(seconds).toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
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
    const jobWithLibrary = job as any;
    if (jobWithLibrary.library?.path) {
      try {
        this.validateFilePath(job.filePath, jobWithLibrary.library.path);
      } catch (error) {
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
    const jobWithResume = job as any;

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
        // Clear resume state
        await this.queueService.updateProgress(job.id, {
          tempFilePath: null as any,
          resumeTimestamp: null as any,
          progress: 0,
        });
      }
    }

    // Detect hardware acceleration
    const hwaccel = await this.detectHardwareAcceleration();

    // Use custom output path if provided, otherwise use existing temp path or create new
    const tempOutput = customOutputPath || jobWithResume.tempFilePath || `${job.filePath}.tmp.mp4`;
    this.logger.debug(`[${job.id}] Output path: ${tempOutput}`);

    // Build ffmpeg command (with resume timestamp if resuming)
    const args = this.buildFfmpegCommand(
      job,
      policy,
      hwaccel,
      tempOutput,
      resumeFromSeconds > 0 ? jobWithResume.resumeTimestamp : undefined
    );

    // Get nice value based on job priority
    const niceValue = this.getNiceValue((job as any).priority ?? 0);

    // Spawn ffmpeg process with nice for CPU priority
    // If priority is non-zero, wrap ffmpeg in nice command
    let ffmpegProcess: ChildProcess;
    if (niceValue !== 0) {
      this.logger.log(
        `[${job.id}] Spawning FFmpeg with nice ${niceValue} (priority ${(job as any).priority ?? 0})`
      );
      ffmpegProcess = spawn('nice', ['-n', niceValue.toString(), 'ffmpeg', ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      ffmpegProcess = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
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

      // Parse stderr for progress
      ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        this.logger.debug(`[${job.id}] Received ${chunk.length} bytes from FFmpeg stderr`);
        stderrBuffer += chunk;
        fullStderr += chunk;

        // Update last output time - FFmpeg is actively producing output
        activeEncoding.lastOutputTime = new Date();

        // Keep last 2000 chars of stderr for error reporting
        if (fullStderr.length > 2000) {
          fullStderr = fullStderr.slice(-2000);
        }
        activeEncoding.lastStderr = fullStderr;

        // Split on both newline and carriage return (FFmpeg stats uses \r)
        const lines = stderrBuffer.split(/[\r\n]+/).filter((line) => line.trim());
        stderrBuffer = ''; // Clear buffer after processing

        for (const line of lines) {
          // Log all lines for debugging
          if (line.includes('frame=')) {
            this.logger.debug(`[${job.id}] FFmpeg stats line: ${line.substring(0, 150)}`);
          }
          const progressData = this.parseProgress(line);
          if (progressData) {
            this.logger.debug(
              `[${job.id}] Progress parsed: frame=${progressData.frame}, fps=${progressData.fps}, time=${progressData.currentTime}`
            );
            this.handleProgressUpdate(
              progressData,
              job,
              activeEncoding,
              estimatedDurationSeconds,
              tempOutput,
              resumeFromPercent
            );
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

        this.activeEncodings.delete(job.id);

        if (code === 0) {
          try {
            await this.handleEncodingSuccess(job, policy, tempOutput);
            resolve();
          } catch (error) {
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

        this.activeEncodings.delete(job.id);

        let errorMessage = `FFmpeg Process Error: ${error.message}\n\n`;

        // Add stderr context if available
        if (encoding?.lastStderr) {
          errorMessage += 'Last output from ffmpeg:\n';
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
   *
   * @param jobId - Job unique identifier
   * @returns True if process was found and killed, false if no active process
   */
  async killProcess(jobId: string): Promise<boolean> {
    const activeEncoding = this.activeEncodings.get(jobId);
    if (!activeEncoding) {
      return false;
    }

    try {
      // Kill ffmpeg process
      activeEncoding.process.kill('SIGTERM');

      // Wait for graceful shutdown (2 seconds)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Force kill if still running
      if (!activeEncoding.process.killed) {
        activeEncoding.process.kill('SIGKILL');
      }

      return true;
    } catch (error) {
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

      // Mark job as cancelled
      await this.queueService.cancelJob(jobId);

      // Cache stderr before removing from active encodings
      if (activeEncoding.lastStderr) {
        this.cacheStderr(jobId, activeEncoding.lastStderr);
      }

      this.activeEncodings.delete(jobId);
      this.logger.log(`Encoding cancelled for job ${jobId}`);
      return true;
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    progress: number = 0,
    retryCount: number = 0
  ): string {
    // Use new error analyzer for human-readable explanations
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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
    const job = {
      id: jobId,
      filePath: options.inputPath,
      fileLabel: '',
      sourceCodec: '',
      targetCodec: options.targetCodec,
      stage: 'ENCODING' as const,
      progress,
      etaSeconds: null,
      beforeSizeBytes: BigInt(0),
      afterSizeBytes: null,
      savedBytes: null,
      savedPercent: null,
      startedAt: new Date(),
      completedAt: null,
      error: null,
      nodeId: '',
      libraryId: '',
      policyId: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      // TRUE RESUME: Add resume fields if resuming
      ...(resumeTimestamp && tempFilePath
        ? {
            resumeTimestamp,
            tempFilePath,
          }
        : {}),
    } as any;

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
   * Verify that an encoded file is valid and playable
   *
   * Uses ffprobe to check file integrity.
   *
   * @param filePath - Path to file to verify
   * @returns Object with isValid flag and optional error details
   */
  async verifyFile(filePath: string): Promise<{ isValid: boolean; error?: string }> {
    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);

      let output = '';
      let stderrOutput = '';

      ffprobe.stdout?.on('data', (data) => {
        output += data.toString();
      });

      // Capture stderr for error details
      ffprobe.stderr?.on('data', (data) => {
        stderrOutput += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code !== 0 || !output.trim()) {
          // Build detailed error message
          let errorMessage = `File verification failed (exit code ${code})`;

          if (stderrOutput.trim()) {
            errorMessage += `\n\nffprobe error output:\n${stderrOutput.trim()}`;
          } else {
            errorMessage += '\n\nNo duration metadata found - file may be corrupted or incomplete';
          }

          resolve({ isValid: false, error: errorMessage });
        } else {
          // File is valid if exit code is 0 and we got a duration
          resolve({ isValid: true });
        }
      });

      ffprobe.on('error', (err) => {
        resolve({
          isValid: false,
          error: `Failed to run ffprobe: ${err.message}`,
        });
      });
    });
  }

  /**
   * ROCK SOLID: Sleep for specified milliseconds
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * ROCK SOLID: Wait for file to exist with retries
   * @param filePath - Path to file
   * @param maxRetries - Maximum number of retries (default: 10)
   * @param delayMs - Delay between retries in milliseconds (default: 2000)
   * @returns true if file exists, false if all retries exhausted
   */
  private async waitForFileExists(
    filePath: string,
    maxRetries: number = 10,
    delayMs: number = 2000
  ): Promise<boolean> {
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
      } catch (error) {
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
   * ROCK SOLID: Verify file with retries
   * @param filePath - Path to file to verify
   * @param maxRetries - Maximum number of retries (default: 10)
   * @returns Verification result with attempt count
   */
  private async verifyFileWithRetries(
    filePath: string,
    maxRetries: number = 10
  ): Promise<{ isValid: boolean; error?: string; attempts: number }> {
    let lastError: string = '';

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
        const result = await this.verifyFile(filePath);

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
      } catch (error) {
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
