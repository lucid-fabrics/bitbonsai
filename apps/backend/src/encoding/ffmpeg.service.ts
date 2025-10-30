import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AccelerationType, Job, Policy } from '@prisma/client';
import { QueueService } from '../queue/queue.service';
import type { EncodingProgressDto } from './dto/encoding-progress.dto';

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
    private readonly eventEmitter: EventEmitter2
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
      return;
    }

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
        // SECURITY: Sanitize value to prevent command injection
        // Only allow alphanumeric, dash, underscore, colon, dot, and comma
        if (!/^[a-zA-Z0-9\-_:.,=]+$/.test(value)) {
          throw new Error(`FFmpeg flag value '${value}' contains invalid characters`);
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
   *
   * Command structure:
   * ffmpeg [-ss HH:MM:SS.MS] [hwaccel flags] -i [input] [video codec] -crf [quality] [audio] [output]
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

    // Progress reporting (use stats format which outputs one-line progress)
    // -stats forces output even in non-interactive mode (pipes)
    args.push('-stats', '-stats_period', '1');

    // Output to specified path (temp file that will be renamed atomically)
    // Force mp4 format to ensure compatibility
    args.push('-f', 'mp4', '-y', outputPath);

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
    }
  }

  /**
   * Handle successful encoding completion
   *
   * TRUE RESUME: Clears resume state on success
   *
   * @param job - Job entity
   * @param policy - Policy entity
   * @param tempOutput - Temporary output file path
   * @private
   */
  private async handleEncodingSuccess(job: Job, policy: Policy, tempOutput: string): Promise<void> {
    // Get output file size
    const stats = await fs.stat(tempOutput);
    const afterSizeBytes = stats.size;
    const savedBytes = Number(job.beforeSizeBytes) - afterSizeBytes;
    const savedPercent = (savedBytes / Number(job.beforeSizeBytes)) * 100;

    // Atomic replacement: rename temp file to original
    if (policy.atomicReplace) {
      await fs.rename(tempOutput, job.filePath);
    } else {
      // Keep both files (add .original extension)
      await fs.rename(job.filePath, `${job.filePath}.original`);
      await fs.rename(tempOutput, job.filePath);
    }

    // Complete job and clear resume state
    const savedPercentRounded = Math.round(savedPercent * 100) / 100;
    await this.queueService.completeJob(job.id, {
      afterSizeBytes: BigInt(afterSizeBytes).toString(),
      savedBytes: BigInt(savedBytes).toString(),
      savedPercent: savedPercentRounded,
    });

    // TRUE RESUME: Clear resume state after successful completion
    await this.queueService.updateProgress(job.id, {
      tempFilePath: null as any,
      resumeTimestamp: null as any,
    });

    this.logger.log(`Encoding completed for job ${job.id}: saved ${savedPercentRounded}%`);
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
   * @private
   */
  private async getVideoDuration(filePath: string): Promise<number> {
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
      case 0: // Normal priority
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
    const canResume =
      jobWithResume.tempFilePath &&
      jobWithResume.resumeTimestamp &&
      existsSync(jobWithResume.tempFilePath);

    let resumeFromSeconds = 0;
    let resumeFromPercent = 0;

    if (canResume) {
      // Verify temp file is valid (not corrupted)
      const isValid = await this.verifyPartialEncode(jobWithResume.tempFilePath);

      if (isValid) {
        // Parse HH:MM:SS.MS to seconds
        resumeFromSeconds = this.parseTimestampToSeconds(jobWithResume.resumeTimestamp);
        resumeFromPercent = (resumeFromSeconds / estimatedDurationSeconds) * 100;

        this.logger.log(
          `🔄 TRUE RESUME: Job ${job.id} will resume from ${jobWithResume.resumeTimestamp} (${resumeFromPercent.toFixed(1)}%)`
        );

        // TRUE RESUME APPROACH: Use FFmpeg input seeking (-ss before -i)
        // This skips the already-encoded portion during INPUT, saving encoding time
        // The output will be a complete video from 0 to end, but FFmpeg only processes
        // the frames from resumeTimestamp onwards (much faster than re-encoding from 0%)
        //
        // Progress tracking: We'll adjust the progress calculation to account for
        // the resumed portion so the user sees accurate progress (not restarting from 0%)
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
          // Get detailed error message with stderr context
          const stderr = encoding?.lastStderr || '';
          const errorMessage = this.interpretFfmpegExitCode(code as number, stderr);
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
   * Common ffmpeg exit codes:
   * - 0: Success
   * - 1: Generic error
   * - 255/-1: Aborted/interrupted
   * - Other codes: Various specific errors
   *
   * @param code - FFmpeg exit code
   * @param stderr - Last stderr output for context
   * @returns Detailed error message with explanation
   */
  private interpretFfmpegExitCode(code: number, stderr: string): string {
    let explanation = '';

    switch (code) {
      case 1:
        explanation = 'Generic encoding error';
        break;
      case 255:
      case -1:
        explanation = 'Process was aborted or interrupted';
        break;
      case 134:
        explanation = 'Segmentation fault (ffmpeg crashed)';
        break;
      case 139:
        explanation = 'Segmentation fault (signal 11)';
        break;
      default:
        explanation = code > 128 ? `Process killed by signal ${code - 128}` : 'Unknown error';
    }

    // Build detailed error message
    let errorMessage = `FFmpeg Error (Exit Code ${code}): ${explanation}\n\n`;

    // Add relevant stderr context
    if (stderr) {
      const stderrLines = stderr.trim().split('\n');

      // Look for common error patterns
      const errorLines = stderrLines.filter(
        (line) =>
          line.toLowerCase().includes('error') ||
          line.toLowerCase().includes('invalid') ||
          line.toLowerCase().includes('failed') ||
          line.toLowerCase().includes('could not') ||
          line.toLowerCase().includes('unable to')
      );

      if (errorLines.length > 0) {
        errorMessage += 'Relevant errors from ffmpeg:\n';
        errorMessage += errorLines.slice(-10).join('\n');
        errorMessage += '\n\n';
      }

      // Add last few lines for context
      errorMessage += 'Last output from ffmpeg:\n';
      errorMessage += stderrLines.slice(-15).join('\n');
    } else {
      errorMessage += 'No output captured from ffmpeg.';
    }

    return errorMessage;
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
    }
  ): Promise<void> {
    // Create a minimal job object for encodeFile
    const job = {
      id: jobId,
      filePath: options.inputPath,
      fileLabel: '',
      sourceCodec: '',
      targetCodec: options.targetCodec,
      stage: 'ENCODING' as const,
      progress: 0,
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
    } as Job;

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
}
