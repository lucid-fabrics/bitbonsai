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
   * Pull `-vf <value>` pairs out of a validated flag array into `vfChain`,
   * returning the remaining flags. Lets the builder emit a single merged -vf.
   */
  private extractVfFragments(flags: string[], vfChain: string[]): string[] {
    const rest: string[] = [];
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] === '-vf' && i + 1 < flags.length) {
        vfChain.push(flags[i + 1]);
        i++;
      } else {
        rest.push(flags[i]);
      }
    }
    return rest;
  }

  /**
   * Map hardware acceleration type to its quality-control flag. CRF is a
   * software-encoder (x264/x265/aom/vpx) concept; passing it to a hardware
   * encoder is ignored or rejected depending on the ffmpeg build.
   *
   * @param hwType - Hardware acceleration type (NVIDIA, INTEL_QSV, AMD, APPLE_M, CPU)
   * @returns FFmpeg quality flag (e.g., -cq, -global_quality, -crf)
   */
  private getQualityFlag(hwType: string): string {
    const qualityFlagByHwType: Record<string, string> = {
      NVIDIA: '-cq',
      INTEL_QSV: '-global_quality',
      AMD: '-qp',
      APPLE_M: '-q:v',
    };
    return qualityFlagByHwType[hwType] || '-crf';
  }

  /**
   * Build ffmpeg command arguments
   *
   * REMUX: Supports fast stream copy when job.type === 'REMUX'
   *
   * Command structure:
   * ENCODE: ffmpeg [input opts] -i [input] [video codec] [quality flag] [quality] [audio] [maps] [output]
   * REMUX: ffmpeg -i [input] -c copy [maps] [output]
   *
   * @param job - Job entity with file info
   * @param policy - Policy entity with encoding settings
   * @param hwaccel - Hardware acceleration config
   * @param outputPath - Path to output file
   * @returns Array of ffmpeg arguments
   */
  buildFfmpegCommand(
    job: Job,
    policy: Policy,
    hwaccel: HardwareAccelConfig,
    outputPath: string
  ): string[] {
    const args: string[] = [];

    // Check if this is a REMUX job (container change only, no re-encoding)
    const jobWithType = job as JobWithRemuxFields;
    const isRemux = jobWithType.type === 'REMUX';

    // Determine output container up front - both branches need it, and ENCODE
    // mode also uses it to pick a compatible subtitle codec below.
    const targetContainer = jobWithType.targetContainer || 'mkv';
    const isMp4Container = targetContainer === 'mp4' || targetContainer.includes('mp4');

    if (isRemux) {
      // REMUX MODE: Fast stream copy (no re-encoding)
      this.logger.log(
        `REMUX MODE: Container change only (${jobWithType.sourceContainer} → ${jobWithType.targetContainer})`
      );

      // Input file
      args.push('-i', job.filePath);

      if (isMp4Container) {
        // MP4 can't hold arbitrary streams: bitmap subtitles and font
        // attachments make `-map 0` a hard failure. Copy only real video
        // (excluding cover art) and audio.
        args.push('-map', '0:V', '-map', '0:a?');
        args.push('-c:v', 'copy');
        args.push('-c:a', 'copy');
      } else {
        // MKV holds anything: copy every stream as-is.
        args.push('-map', '0');
        args.push('-c:v', 'copy');
        args.push('-c:a', 'copy');
        args.push('-c:s', 'copy');
      }
    } else {
      // ENCODE MODE: Full transcode with quality settings
      this.logger.log(`ENCODE MODE: Full transcode (${job.sourceCodec} → ${job.targetCodec})`);

      // TIMESTAMP RESILIENCE: health check flagged non-monotonic DTS on this
      // source (see FileHealthService/health-check-codec-analyzer); genpts
      // regenerates presentation timestamps to avoid A/V desync mid-encode.
      const jobHealthMessage = job.healthMessage;
      if (jobHealthMessage?.toLowerCase().includes('timestamp issues detected')) {
        args.push('-fflags', '+genpts');
      }

      // GPU→CPU FALLBACK: honor a codec override applied after a prior GPU
      // failure by skipping hardware acceleration entirely for this attempt -
      // decode flags like -hwaccel_output_format cuda pin frames on the GPU,
      // which breaks a CPU encoder downstream.
      if (!job.codecOverride) {
        args.push(...hwaccel.flags);
      }

      // Input file
      args.push('-i', job.filePath);

      // Video codec and quality
      // Select codec based on policy target and available hardware acceleration,
      // unless a GPU→CPU fallback already picked one for this job.
      const selectedCodec =
        job.codecOverride || this.selectCodecForPolicy(policy.targetCodec, hwaccel.type);
      args.push('-c:v', selectedCodec);

      // Quality flag differs per encoder family: CRF is a software x264/x265/
      // aom concept, hardware encoders use their own quality knob.
      const qualityFlag = this.getQualityFlag(job.codecOverride ? 'CPU' : hwaccel.type);
      args.push(qualityFlag, policy.targetQuality.toString());

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

      // Map real video (0:V excludes attached_pic cover art) and all audio
      // (0:a? tolerates video-only sources) instead of ffmpeg's default of
      // picking one stream of each - without this, multi-audio and commentary
      // tracks were silently dropped.
      args.push('-map', '0:V', '-map', '0:a?');
      if (!isMp4Container) {
        // MKV can copy any subtitle codec as-is, so keep them all. MP4 gets
        // NO subtitle map: force-mapping bitmap subs (PGS/DVD) into MP4 is a
        // hard failure ("only text to text"), and there's no stream metadata
        // at build time to map only the text ones. Dropping subs for MP4
        // keeps the encode succeeding, matching ffmpeg's own type-matched
        // auto-selection behavior for incompatible subs.
        args.push('-map', '0:s?');
        args.push('-c:s', 'copy');
      }

      // AV1 THROTTLING: Apply thread limit if specified on job
      const jobWithThreads = job as JobWithThreadsFields;
      if (jobWithThreads.ffmpegThreads) {
        args.push('-threads', jobWithThreads.ffmpegThreads.toString());
        this.logger.warn(
          `[${job.id}] Using ${jobWithThreads.ffmpegThreads} threads (resource throttled: ${jobWithThreads.resourceThrottleReason || 'unknown reason'})`
        );
      }

      // Collect -vf fragments so exactly one merged -vf is emitted: ffmpeg
      // takes the LAST -vf when repeated, which would silently drop either
      // the policy's filters or the VAAPI hwupload chain.
      const vfChain: string[] = [];

      // SECURITY: Validate and add additional ffmpeg flags from policy
      if (advancedSettings.ffmpegFlags) {
        const customFlags = advancedSettings.ffmpegFlags as string[];
        try {
          const validatedFlags = this.validateFfmpegFlags(customFlags);
          args.push(...this.extractVfFragments(validatedFlags, vfChain));
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
            args.push(...this.extractVfFragments(validatedFlags, vfChain));
            this.logger.log(`Applied decision FFmpeg flags: ${validatedFlags.join(' ')}`);
          }
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Hardware filter (e.g. VAAPI format=nv12,hwupload) goes LAST in the
      // chain: CPU filters must run before frames are uploaded to the GPU.
      // Skipped on codec override (software fallback) and when a policy
      // already supplies its own hwupload chain.
      if (
        hwaccel.videoFilter &&
        !job.codecOverride &&
        !vfChain.some((v) => v.includes('hwupload'))
      ) {
        vfChain.push(hwaccel.videoFilter);
      }

      if (vfChain.length > 0) {
        args.push('-vf', vfChain.join(','));
      }
    }

    // Progress reporting - FFmpeg progress format to stderr
    // Uses -progress pipe:2 to write structured progress data (frame=X, fps=Y, out_time=HH:MM:SS)
    // This format is much easier to parse than -stats and works in all environments (including LXC)
    args.push('-progress', 'pipe:2'); // Structured progress output to stderr
    args.push('-nostdin'); // Disable interactive input

    // Output to specified path (temp file that will be renamed atomically)
    // Determine output format based on job type and target container
    if (isMp4Container) {
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
