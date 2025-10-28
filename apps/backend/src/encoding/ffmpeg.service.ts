import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
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
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);
  private readonly activeEncodings = new Map<string, ActiveEncoding>();

  // Regex for parsing ffmpeg progress output
  // Example: frame= 2450 fps= 87 q=28.0 size=   12288kB time=00:01:42.50 bitrate=1234.5kbits/s speed=3.62x
  private readonly progressRegex = /frame=\s*(\d+).*fps=\s*([\d.]+).*time=\s*([\d:.]+)/;

  /**
   * SECURITY: Whitelist of allowed FFmpeg flags
   * Prevents command injection by only allowing safe, predefined flags
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

    // Metadata options
    '-metadata',
    '-map_metadata',

    // Threading options
    '-threads',

    // Quality/compression options
    '-qmin',
    '-qmax',
    '-qdiff',
  ]);

  constructor(
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2
  ) {}

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
   * Command structure:
   * ffmpeg [hwaccel flags] -i [input] [video codec] -crf [quality] [audio] [output]
   *
   * @param job - Job entity with file info
   * @param policy - Policy entity with encoding settings
   * @param hwaccel - Hardware acceleration config
   * @returns Array of ffmpeg arguments
   */
  buildFfmpegCommand(job: Job, policy: Policy, hwaccel: HardwareAccelConfig): string[] {
    const args: string[] = [];

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

    // Progress reporting
    args.push('-progress', 'pipe:2', '-stats_period', '1');

    // Output to temp file (will be renamed atomically)
    // Use .tmp.mp4 extension so FFmpeg can detect the format
    const tempOutput = `${job.filePath}.tmp.mp4`;
    args.push('-f', 'mp4', '-y', tempOutput); // -f mp4 to specify format explicitly

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
   * @param progressData - Parsed progress data
   * @param job - Job entity
   * @param activeEncoding - Active encoding state
   * @param estimatedDurationSeconds - Estimated video duration
   * @private
   */
  private handleProgressUpdate(
    progressData: Pick<EncodingProgressDto, 'frame' | 'fps' | 'currentTime'>,
    job: Job,
    activeEncoding: ActiveEncoding,
    estimatedDurationSeconds: number
  ): void {
    const progress = this.calculateProgressPercentage(
      progressData.currentTime,
      estimatedDurationSeconds
    );

    // Calculate ETA
    const elapsed = Date.now() - activeEncoding.startTime.getTime();
    const eta = progress > 0 ? Math.round(((elapsed / progress) * (100 - progress)) / 1000) : 0;

    // Emit progress event
    const progressDto: EncodingProgressDto = {
      jobId: job.id,
      frame: progressData.frame,
      fps: progressData.fps,
      currentTime: progressData.currentTime,
      progress,
      eta,
    };

    this.eventEmitter.emit('encoding.progress', progressDto);

    // Update job progress (throttle to every 5%)
    if (progress - activeEncoding.lastProgress >= 5) {
      this.queueService
        .updateProgress(job.id, {
          progress: Math.round(progress * 100) / 100, // Round to 2 decimal places
          etaSeconds: eta,
        })
        .catch((error) => {
          this.logger.error(`Failed to update job progress: ${error.message}`);
        });
      activeEncoding.lastProgress = progress;
    }
  }

  /**
   * Handle successful encoding completion
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

    // Complete job
    const savedPercentRounded = Math.round(savedPercent * 100) / 100;
    await this.queueService.completeJob(job.id, {
      afterSizeBytes: BigInt(afterSizeBytes).toString(),
      savedBytes: BigInt(savedBytes).toString(),
      savedPercent: savedPercentRounded,
    });

    this.logger.log(`Encoding completed for job ${job.id}: saved ${savedPercentRounded}%`);
  }

  /**
   * Handle encoding failure
   *
   * @param job - Job entity
   * @param tempOutput - Temporary output file path
   * @param errorMessage - Error message
   * @private
   */
  private async handleEncodingFailure(
    job: Job,
    tempOutput: string,
    errorMessage: string
  ): Promise<void> {
    this.logger.error(`Encoding failed for job ${job.id}: ${errorMessage}`);

    // Clean up temp file
    try {
      if (existsSync(tempOutput)) {
        await fs.unlink(tempOutput);
      }
    } catch {
      // Ignore cleanup errors
    }

    await this.queueService.failJob(job.id, errorMessage);
  }

  /**
   * Encode file using ffmpeg
   *
   * Process:
   * 1. Detect hardware acceleration
   * 2. Build ffmpeg command
   * 3. Spawn ffmpeg process
   * 4. Parse stderr for progress
   * 5. Emit progress events
   * 6. Update job entity
   * 7. Handle completion/errors
   * 8. Atomic file replacement
   *
   * @param job - Job entity with full relations (policy, library)
   * @param policy - Policy entity with encoding settings
   * @returns Promise that resolves when encoding completes
   * @throws Error if ffmpeg fails or process error occurs
   */
  async encodeFile(job: Job, policy: Policy): Promise<void> {
    this.logger.log(`Starting encoding for job ${job.id}: ${job.fileLabel}`);

    // Validate file exists
    if (!existsSync(job.filePath)) {
      throw new Error(`File not found: ${job.filePath}`);
    }

    // Detect hardware acceleration
    const hwaccel = await this.detectHardwareAcceleration();

    // Build ffmpeg command
    const args = this.buildFfmpegCommand(job, policy, hwaccel);
    const tempOutput = `${job.filePath}.tmp.mp4`;

    // Spawn ffmpeg process
    const ffmpegProcess = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Track active encoding
    const activeEncoding: ActiveEncoding = {
      jobId: job.id,
      process: ffmpegProcess,
      startTime: new Date(),
      lastProgress: 0,
      lastStderr: '',
    };
    this.activeEncodings.set(job.id, activeEncoding);

    // Get video duration (assuming it's in the job metadata or policy)
    // For now, we'll estimate based on file size and bitrate
    // In a real implementation, this would come from ffprobe scan
    const estimatedDurationSeconds = 3600; // Placeholder: 1 hour

    return new Promise((resolve, reject) => {
      let stderrBuffer = '';
      let fullStderr = '';

      // Parse stderr for progress
      ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderrBuffer += chunk;
        fullStderr += chunk;

        // Keep last 2000 chars of stderr for error reporting
        if (fullStderr.length > 2000) {
          fullStderr = fullStderr.slice(-2000);
        }
        activeEncoding.lastStderr = fullStderr;

        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const progressData = this.parseProgress(line);
          if (progressData) {
            this.handleProgressUpdate(progressData, job, activeEncoding, estimatedDurationSeconds);
          }
        }
      });

      // Handle process completion
      ffmpegProcess.on('close', async (code) => {
        const encoding = this.activeEncodings.get(job.id);
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
   * Get last stderr output for a job
   *
   * Returns the last 2000 characters of ffmpeg stderr output for error reporting.
   * Useful for diagnosing stuck or failed jobs.
   *
   * @param jobId - Job unique identifier
   * @returns Last stderr output, or null if job not found
   */
  getLastStderr(jobId: string): string | null {
    const activeEncoding = this.activeEncodings.get(jobId);
    return activeEncoding?.lastStderr || null;
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

    await this.encodeFile(job, policy);
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
