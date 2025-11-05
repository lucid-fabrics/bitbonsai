import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { extname } from 'path';
import {
  HealthCheckIssue,
  HealthCheckIssueCategory,
  HealthCheckIssueSeverity,
  HealthCheckSuggestedAction,
} from '../queue/models/health-check-issue.model';

/**
 * Container Compatibility Service
 *
 * Detects compatibility issues between codecs, containers, and encoding settings.
 * Provides actionable recommendations to prevent encoding failures.
 *
 * Key Checks:
 * - AC3/DTS audio incompatibility with MP4 containers
 * - Container limitations (e.g., MP4 doesn't support many codecs)
 * - Audio codec compatibility with target format
 * - Multi-audio track handling
 */
@Injectable()
export class ContainerCompatibilityService {
  private readonly logger = new Logger(ContainerCompatibilityService.name);

  /**
   * Check for container compatibility issues
   *
   * @param filePath - Path to source file
   * @param targetContainer - Target container format (e.g., 'mp4', 'mkv')
   * @returns Array of detected issues requiring user decision
   */
  async checkCompatibility(
    filePath: string,
    targetContainer: string = 'mp4'
  ): Promise<HealthCheckIssue[]> {
    this.logger.debug(`Checking compatibility: ${filePath} → .${targetContainer}`);

    try {
      // Get detailed stream information
      const streams = await this.getStreamInfo(filePath);

      const issues: HealthCheckIssue[] = [];

      // Check audio codec compatibility with MP4
      if (targetContainer.toLowerCase() === 'mp4') {
        const mp4Issues = this.checkMP4Compatibility(streams, filePath);
        issues.push(...mp4Issues);
      }

      return issues;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Compatibility check failed: ${errorMessage}`);
      return [];
    }
  }

  /**
   * Check MP4 container compatibility
   *
   * MP4 has strict codec requirements:
   * - Audio: AAC, MP3, FLAC are compatible
   * - Audio: AC3, DTS, TrueHD, DTS-HD are NOT compatible
   *
   * @param streams - FFprobe stream data
   * @param filePath - Path to file (for extension detection)
   * @returns Array of compatibility issues
   */
  private checkMP4Compatibility(streams: MediaStream[], filePath: string): HealthCheckIssue[] {
    const issues: HealthCheckIssue[] = [];

    // Get all audio streams
    const audioStreams = streams.filter((s) => s.codec_type === 'audio');

    if (audioStreams.length === 0) {
      return issues; // No audio, no issues
    }

    // Check each audio stream for incompatible codecs
    const incompatibleStreams: Array<{ index: number; codec: string; title?: string }> = [];

    for (const stream of audioStreams) {
      const codec = stream.codec_name?.toLowerCase() || '';

      // AC3 (Dolby Digital)
      if (codec === 'ac3' || codec === 'eac3') {
        incompatibleStreams.push({
          index: stream.index,
          codec: codec === 'eac3' ? 'E-AC3 (Dolby Digital Plus)' : 'AC3 (Dolby Digital)',
          title: stream.tags?.title,
        });
      }

      // DTS
      if (codec.startsWith('dts')) {
        incompatibleStreams.push({
          index: stream.index,
          codec: 'DTS',
          title: stream.tags?.title,
        });
      }

      // TrueHD
      if (codec === 'truehd') {
        incompatibleStreams.push({
          index: stream.index,
          codec: 'TrueHD',
          title: stream.tags?.title,
        });
      }

      // PCM (uncompressed)
      if (codec.startsWith('pcm_')) {
        incompatibleStreams.push({
          index: stream.index,
          codec: 'PCM (Uncompressed)',
          title: stream.tags?.title,
        });
      }
    }

    if (incompatibleStreams.length > 0) {
      // Build detailed message
      const codecList = incompatibleStreams
        .map((s) => {
          const title = s.title ? ` (${s.title})` : '';
          return `Stream #${s.index}: ${s.codec}${title}`;
        })
        .join(', ');

      const message =
        incompatibleStreams.length === 1
          ? `This file has ${incompatibleStreams[0].codec} audio, which is incompatible with MP4 containers`
          : `This file has ${incompatibleStreams.length} audio tracks with incompatible codecs: ${codecList}`;

      const technicalDetails = `
MP4 containers cannot store ${incompatibleStreams.map((s) => s.codec).join(', ')} audio streams due to format limitations.

FFmpeg will fail with: "Could not write header for output file (incorrect codec parameters?)"

The MP4 container requires audio to be in AAC, MP3, or FLAC format. Surround sound codecs like AC3 and DTS are not supported in MP4 without transcoding.
`.trim();

      // Determine if file is already MP4
      const currentContainer = extname(filePath).toLowerCase();
      const isSourceMP4 = currentContainer === '.mp4' || currentContainer === '.m4v';

      // Build suggested actions
      const actions: HealthCheckSuggestedAction[] = [];

      // Action 1: Use MKV container (recommended for preserving quality)
      actions.push({
        id: 'use_mkv_container',
        label: 'Use MKV Container',
        description: 'Keep original audio intact, change container to MKV',
        impact: isSourceMP4
          ? 'File extension changes to .mkv, audio quality preserved'
          : 'Container remuxed to MKV, no re-encoding needed',
        recommended: true,
        config: {
          targetContainer: 'mkv',
          audioAction: 'copy', // Copy audio streams without re-encoding
        },
      });

      // Action 2: Transcode audio to AAC
      actions.push({
        id: 'transcode_audio_aac',
        label: 'Transcode Audio to AAC',
        description: 'Convert all incompatible audio tracks to AAC (lossy compression)',
        impact: 'Slight audio quality loss, maintains MP4 container',
        recommended: false,
        config: {
          targetContainer: 'mp4',
          audioAction: 'transcode_aac',
          audioCodec: 'aac',
          audioBitrate: '256k', // Good quality AAC
        },
      });

      // Action 3: Use delay_moov workaround (advanced, not recommended)
      actions.push({
        id: 'use_delay_moov',
        label: 'Force MP4 with delay_moov (Advanced)',
        description: 'Attempt to force AC3/DTS into MP4 using FFmpeg workaround',
        impact:
          'May work but creates non-standard MP4 files. Playback compatibility not guaranteed.',
        recommended: false,
        config: {
          targetContainer: 'mp4',
          audioAction: 'copy',
          ffmpegFlags: ['-movflags', '+delay_moov'],
        },
      });

      // Create issue
      issues.push({
        category: HealthCheckIssueCategory.CONTAINER,
        severity: HealthCheckIssueSeverity.BLOCKER, // Must resolve before encoding
        code: 'AC3_DTS_MP4_INCOMPATIBLE',
        message,
        technicalDetails,
        suggestedActions: actions,
        affectedStreams: incompatibleStreams.map((s) => s.index),
        metadata: {
          incompatibleCodecs: incompatibleStreams.map((s) => s.codec),
          audioTrackCount: audioStreams.length,
          incompatibleTrackCount: incompatibleStreams.length,
        },
      });
    }

    return issues;
  }

  /**
   * Get detailed stream information using ffprobe
   *
   * @param filePath - Path to file
   * @returns Array of stream metadata
   */
  private async getStreamInfo(filePath: string): Promise<MediaStream[]> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', filePath]);

      let stdout = '';
      let stderr = '';

      ffprobe.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      ffprobe.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`FFprobe failed with code ${code}: ${stderr}`));
          return;
        }

        try {
          const json = JSON.parse(stdout);
          const streams: MediaStream[] = json.streams || [];
          resolve(streams);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          reject(new Error(`Failed to parse ffprobe output: ${errorMessage}`));
        }
      });

      ffprobe.on('error', (error) => {
        reject(error);
      });
    });
  }
}

/**
 * Media stream metadata from ffprobe
 */
interface MediaStream {
  index: number;
  codec_name?: string;
  codec_type?: string;
  codec_long_name?: string;
  tags?: {
    language?: string;
    title?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
