import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { AccelerationType, Job, Policy } from '@prisma/client';
import type { QueueService } from '../queue/queue.service';
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

  constructor(
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2
  ) {}

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

    // Additional ffmpeg flags from policy
    if (advancedSettings.ffmpegFlags) {
      const customFlags = advancedSettings.ffmpegFlags as string[];
      args.push(...customFlags);
    }

    // Progress reporting
    args.push('-progress', 'pipe:2', '-stats_period', '1');

    // Output to temp file (will be renamed atomically)
    const tempOutput = `${job.filePath}.tmp`;
    args.push('-y', tempOutput); // -y to overwrite temp file

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
          progress,
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
    await this.queueService.completeJob(job.id, {
      afterSizeBytes: BigInt(afterSizeBytes).toString(),
      savedBytes: BigInt(savedBytes).toString(),
      savedPercent,
    });

    this.logger.log(`Encoding completed for job ${job.id}: saved ${savedPercent.toFixed(2)}%`);
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
    const tempOutput = `${job.filePath}.tmp`;

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
    };
    this.activeEncodings.set(job.id, activeEncoding);

    // Get video duration (assuming it's in the job metadata or policy)
    // For now, we'll estimate based on file size and bitrate
    // In a real implementation, this would come from ffprobe scan
    const estimatedDurationSeconds = 3600; // Placeholder: 1 hour

    return new Promise((resolve, reject) => {
      let stderrBuffer = '';

      // Parse stderr for progress
      ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        stderrBuffer += data.toString();
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
          const errorMessage = `ffmpeg exited with code ${code}`;
          await this.handleEncodingFailure(job, tempOutput, errorMessage);
          reject(new Error(errorMessage));
        }
      });

      // Handle process errors
      ffmpegProcess.on('error', async (error) => {
        this.activeEncodings.delete(job.id);
        const errorMessage = `ffmpeg process error: ${error.message}`;
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
   * @returns True if file is valid, false otherwise
   */
  async verifyFile(filePath: string): Promise<boolean> {
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
      let hasError = false;

      ffprobe.stdout?.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.stderr?.on('data', () => {
        hasError = true;
      });

      ffprobe.on('close', (code) => {
        if (code !== 0 || hasError || !output.trim()) {
          resolve(false);
        } else {
          // File is valid if we got a duration
          resolve(true);
        }
      });

      ffprobe.on('error', () => {
        resolve(false);
      });
    });
  }
}
