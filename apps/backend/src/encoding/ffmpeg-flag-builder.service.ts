import { Injectable, Logger } from '@nestjs/common';
import type { Job, Policy } from '@prisma/client';
import {
  type HardwareAccelConfig,
  HardwareAccelerationService,
} from './hardware-acceleration.service';

/**
 * Extended Job type with remux-specific fields
 */
type JobWithRemuxFields = Job & {
  sourceContainer?: string;
  targetContainer?: string;
};

/**
 * Extended Job type with thread configuration fields
 */
type JobWithThreadsFields = Job & {
  ffmpegThreads?: number;
  resourceThrottleReason?: string;
};

/**
 * FfmpegFlagBuilderService
 *
 * Pure command-argument construction for FFmpeg invocations.
 * Responsible for:
 * - Security whitelisting and validation of FFmpeg flags
 * - Building the full FFmpeg argument array for encode and remux jobs
 * - Codec selection delegation to HardwareAccelerationService
 *
 * All methods are stateless with respect to job execution state.
 */
@Injectable()
export class FfmpegFlagBuilderService {
  private readonly logger = new Logger(FfmpegFlagBuilderService.name);

  /**
   * SECURITY: Whitelist of allowed FFmpeg flags
   * Prevents command injection by only allowing safe, predefined flags
   * LOW PRIORITY FIX #18: Expanded whitelist for more encoding options
   */
  readonly ALLOWED_FFMPEG_FLAGS = new Set([
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

  constructor(private readonly hardwareAccelerationService: HardwareAccelerationService) {}

  /**
   * SECURITY: Validate and filter FFmpeg flags
   * Only allows whitelisted flags to prevent command injection
   *
   * @param flags - Array of FFmpeg flags from policy advanced settings
   * @returns Filtered array of safe flags
   * @throws Error if any disallowed flags are found
   */
  validateFfmpegFlags(flags: string[]): string[] {
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
   * Select the appropriate FFmpeg codec based on policy target and available hardware
   *
   * Maps policy codec preferences (HEVC, AV1, VP9, H264) to hardware-accelerated
   * variants when available, falling back to software encoding if needed.
   *
   * @param targetCodec - Target codec from encoding policy (HEVC, AV1, VP9, H264)
   * @param hwType - Hardware acceleration type (NVIDIA, INTEL_QSV, AMD, APPLE_M, CPU)
   * @returns FFmpeg codec name (e.g., hevc_nvenc, libx265, av1_nvenc, etc.)
   */
  selectCodecForPolicy(targetCodec: string, hwType: string): string {
    return this.hardwareAccelerationService.selectCodecForPolicy(targetCodec, hwType);
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
    const jobWithType = job as JobWithRemuxFields;
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
      // Select codec based on policy target and available hardware acceleration
      const selectedCodec = this.selectCodecForPolicy(policy.targetCodec, hwaccel.type);
      args.push('-c:v', selectedCodec);
      args.push('-crf', policy.targetQuality.toString());

      // Audio codec (from decision config or policy advanced settings)
      // DECISION FIX: Check if decisionData has audio config overrides
      let audioCodec = 'copy';
      let audioBitrate: string | undefined;

      if (job.decisionData) {
        try {
          const decisionData = JSON.parse(job.decisionData as string);
          if (decisionData?.actionConfig?.audioCodec) {
            audioCodec = decisionData.actionConfig.audioCodec;
            this.logger.log(`Using audio codec from decision: ${audioCodec}`);
          }
          if (decisionData?.actionConfig?.audioBitrate) {
            audioBitrate = decisionData.actionConfig.audioBitrate;
            this.logger.log(`Using audio bitrate from decision: ${audioBitrate}`);
          }
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Fall back to policy settings if not overridden by decision
      const advancedSettings = policy.advancedSettings as Record<string, unknown>;
      if (audioCodec === 'copy' && advancedSettings.audioCodec) {
        audioCodec = advancedSettings.audioCodec as string;
      }

      args.push('-c:a', audioCodec);

      // Apply audio bitrate if specified
      if (audioBitrate) {
        args.push('-b:a', audioBitrate);
      }

      // AV1 THROTTLING: Apply thread limit if specified on job
      const jobWithThreads = job as JobWithThreadsFields;
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
        } catch (error: unknown) {
          this.logger.error(
            `Invalid FFmpeg flags in policy: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
          throw error;
        }
      }

      // DECISION FIX: Apply additional FFmpeg flags from decision config
      if (job.decisionData) {
        try {
          const decisionData = JSON.parse(job.decisionData as string);
          if (decisionData?.actionConfig?.ffmpegFlags) {
            const decisionFlags = decisionData.actionConfig.ffmpegFlags as string[];
            const validatedFlags = this.validateFfmpegFlags(decisionFlags);
            args.push(...validatedFlags);
            this.logger.log(`Applied decision FFmpeg flags: ${validatedFlags.join(' ')}`);
          }
        } catch {
          // Ignore JSON parse errors
        }
      }
    }

    // Progress reporting - FFmpeg progress format to stderr
    // Uses -progress pipe:2 to write structured progress data (frame=X, fps=Y, out_time=HH:MM:SS)
    // This format is much easier to parse than -stats and works in all environments (including LXC)
    args.push('-progress', 'pipe:2'); // Structured progress output to stderr
    args.push('-nostdin'); // Disable interactive input

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
}
