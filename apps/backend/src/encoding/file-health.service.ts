import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

export enum FileHealthStatus {
  HEALTHY = 'HEALTHY',
  WARNING = 'WARNING',
  AT_RISK = 'AT_RISK',
  CORRUPTED = 'CORRUPTED',
}

export interface FileHealthResult {
  status: FileHealthStatus;
  score: number; // 0-100
  issues: string[];
  warnings: string[];
  canEncode: boolean;
  metadata?: {
    duration?: number;
    bitrate?: number;
    hasVideo?: boolean;
    hasAudio?: boolean;
    videoCodec?: string;
    audioCodec?: string;
  };
}

/**
 * FileHealthService
 *
 * Validates media file health before encoding to prevent failures.
 * Provides intuitive health scores and warnings for user decision-making.
 */
@Injectable()
export class FileHealthService {
  private readonly logger = new Logger(FileHealthService.name);

  /**
   * Analyze file health before encoding
   *
   * Checks:
   * - File exists and is readable
   * - Container format is valid
   * - Streams are decodable
   * - Duration and metadata are accessible
   * - No critical errors in file structure
   *
   * @param filePath - Path to file to analyze
   * @returns Health analysis result with recommendations
   */
  async analyzeFile(filePath: string): Promise<FileHealthResult> {
    this.logger.debug(`Analyzing file health: ${filePath}`);

    // Check file exists
    if (!existsSync(filePath)) {
      return {
        status: FileHealthStatus.CORRUPTED,
        score: 0,
        issues: ['File does not exist'],
        warnings: [],
        canEncode: false,
      };
    }

    try {
      // Run comprehensive ffprobe analysis
      const probeResult = await this.runFFProbe(filePath);

      // Analyze results
      return this.evaluateHealth(probeResult);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`File health analysis failed: ${errorMessage}`);
      return {
        status: FileHealthStatus.CORRUPTED,
        score: 0,
        issues: [`Analysis failed: ${errorMessage}`],
        warnings: [],
        canEncode: false,
      };
    }
  }

  /**
   * Run ffprobe with comprehensive error detection
   *
   * @param filePath - Path to file
   * @returns Probe result with metadata and errors
   * @private
   */
  private async runFFProbe(filePath: string): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    duration?: number;
    bitrate?: number;
    hasVideo?: boolean;
    hasAudio?: boolean;
    videoCodec?: string;
    audioCodec?: string;
  }> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'warning', // Show warnings but not info
        '-show_entries',
        'format=duration,bit_rate:stream=codec_name,codec_type',
        '-of',
        'json',
        filePath,
      ]);

      let stdout = '';
      let stderr = '';

      ffprobe.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      ffprobe.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      ffprobe.on('close', (code) => {
        try {
          const result = { exitCode: code || 0, stdout, stderr };

          // Parse JSON output
          if (stdout.trim()) {
            const json = JSON.parse(stdout);
            const format = json.format || {};
            const streams = json.streams || [];

            const videoStream = streams.find(
              (s: { codec_type: string }) => s.codec_type === 'video'
            );
            const audioStream = streams.find(
              (s: { codec_type: string }) => s.codec_type === 'audio'
            );

            Object.assign(result, {
              duration: parseFloat(format.duration) || undefined,
              bitrate: parseInt(format.bit_rate, 10) || undefined,
              hasVideo: !!videoStream,
              hasAudio: !!audioStream,
              videoCodec: videoStream?.codec_name,
              audioCodec: audioStream?.codec_name,
            });
          }

          resolve(result);
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

  /**
   * Evaluate file health based on probe results
   *
   * Scoring:
   * - 90-100: HEALTHY - No issues detected
   * - 70-89:  WARNING - Minor issues, encoding likely to succeed
   * - 40-69:  AT_RISK - Significant issues, encoding may fail
   * - 0-39:   CORRUPTED - Critical issues, encoding will likely fail
   *
   * @param probeResult - FFProbe analysis result
   * @returns Health evaluation with recommendations
   * @private
   */
  private evaluateHealth(probeResult: {
    exitCode: number;
    stdout: string;
    stderr: string;
    duration?: number;
    bitrate?: number;
    hasVideo?: boolean;
    hasAudio?: boolean;
    videoCodec?: string;
    audioCodec?: string;
  }): FileHealthResult {
    const issues: string[] = [];
    const warnings: string[] = [];
    let score = 100;

    // Critical: Exit code non-zero
    if (probeResult.exitCode !== 0) {
      issues.push('FFProbe failed to analyze file (corrupted container)');
      score -= 50;
    }

    // Critical: No video stream
    if (!probeResult.hasVideo) {
      issues.push('No video stream detected');
      score -= 40;
    }

    // Warning: No audio stream (not critical for encoding)
    if (!probeResult.hasAudio && probeResult.hasVideo) {
      warnings.push('No audio stream detected (video-only file)');
      score -= 5;
    }

    // Warning: No duration (may indicate container issues)
    if (!probeResult.duration || probeResult.duration <= 0) {
      warnings.push('Duration could not be determined');
      score -= 10;
    }

    // Warning: No bitrate (may indicate metadata issues)
    if (!probeResult.bitrate || probeResult.bitrate <= 0) {
      warnings.push('Bitrate information missing');
      score -= 5;
    }

    // Analyze stderr for warnings/errors
    const stderrLower = probeResult.stderr.toLowerCase();

    // Critical errors in stderr
    if (stderrLower.includes('invalid') || stderrLower.includes('corrupt')) {
      issues.push('File contains invalid or corrupted data');
      score -= 30;
    }

    if (stderrLower.includes('moov atom not found')) {
      issues.push('MP4 container missing required metadata (MOOV atom)');
      score -= 40;
    }

    // Warnings in stderr
    if (stderrLower.includes('warning')) {
      const warningCount = (stderrLower.match(/warning/g) || []).length;
      warnings.push(`${warningCount} warning(s) detected in file structure`);
      score -= Math.min(warningCount * 3, 15); // Cap at -15
    }

    if (stderrLower.includes('non-monotonous dts')) {
      warnings.push('Timestamp issues detected (may cause playback glitches)');
      score -= 5;
    }

    // Ensure score is within bounds
    score = Math.max(0, Math.min(100, score));

    // Determine status
    let status: FileHealthStatus;
    let canEncode = true;

    if (score >= 90) {
      status = FileHealthStatus.HEALTHY;
    } else if (score >= 70) {
      status = FileHealthStatus.WARNING;
    } else if (score >= 40) {
      status = FileHealthStatus.AT_RISK;
    } else {
      status = FileHealthStatus.CORRUPTED;
      canEncode = false; // Don't encode corrupted files
    }

    return {
      status,
      score,
      issues,
      warnings,
      canEncode,
      metadata: {
        duration: probeResult.duration,
        bitrate: probeResult.bitrate,
        hasVideo: probeResult.hasVideo,
        hasAudio: probeResult.hasAudio,
        videoCodec: probeResult.videoCodec,
        audioCodec: probeResult.audioCodec,
      },
    };
  }
}
