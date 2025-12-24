import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export enum FileHealthStatus {
  HEALTHY = 'HEALTHY',
  WARNING = 'WARNING',
  CORRUPTED = 'CORRUPTED',
  UNKNOWN = 'UNKNOWN',
}

export interface FileHealthResult {
  status: FileHealthStatus;
  message: string;
}

export interface VideoCodecInfo {
  filePath: string;
  codec: string;
  resolution: string;
  duration: number;
  sizeBytes: number;
  healthStatus: FileHealthStatus;
  healthMessage: string;
}

export interface ScanAnalysis {
  totalFiles: number;
  totalSizeBytes: bigint;
  needsEncoding: VideoCodecInfo[];
  alreadyOptimized: VideoCodecInfo[];
  errors: Array<{ filePath: string; error: string }>;
}

/**
 * FFprobe API response types
 */
interface FFprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
}

interface FFprobeFormat {
  format_name?: string;
  duration?: string;
  size?: string;
}

interface FFprobeResponse {
  format?: FFprobeFormat;
  streams?: FFprobeStream[];
}

/**
 * MediaAnalysisService
 *
 * Analyzes video files using FFprobe to determine encoding needs
 */
@Injectable()
export class MediaAnalysisService {
  private readonly logger = new Logger(MediaAnalysisService.name);

  /**
   * Validate file integrity before encoding
   *
   * Performs a quick integrity check to detect corrupted or problematic files
   * that would likely cause ffmpeg to hang or fail during encoding.
   *
   * @param filePath - Absolute path to video file
   * @returns FileHealthResult with status and message
   */
  async validateFileIntegrity(filePath: string): Promise<FileHealthResult> {
    try {
      // Quick validation: attempt to read container format and streams
      // This will fail fast if the file is severely corrupted
      const { stdout, stderr } = await execFileAsync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=format_name,duration:stream=codec_type,codec_name',
          '-of',
          'json',
          filePath,
        ],
        { timeout: 5000 } // 5 second timeout for quick check
      );

      // If ffprobe returns errors in stderr, file may be problematic
      if (stderr && stderr.trim().length > 0) {
        this.logger.warn(`File integrity warning for ${filePath}: ${stderr}`);
        return {
          status: FileHealthStatus.WARNING,
          message: `FFprobe warnings: ${stderr.substring(0, 100)}`,
        };
      }

      const data = JSON.parse(stdout) as FFprobeResponse;

      // Validate basic structure
      if (!data.format || !data.streams || data.streams.length === 0) {
        this.logger.warn(`Invalid file structure: ${filePath}`);
        return {
          status: FileHealthStatus.CORRUPTED,
          message: 'Invalid file structure - missing format or streams',
        };
      }

      // Check if we have at least one video stream
      const hasVideoStream = data.streams.some((s) => s.codec_type === 'video');
      if (!hasVideoStream) {
        this.logger.warn(`No video stream found: ${filePath}`);
        return {
          status: FileHealthStatus.CORRUPTED,
          message: 'No video stream found in file',
        };
      }

      // Check if duration is valid (not 0 or missing for video files)
      const duration = parseFloat(data.format.duration || '0');
      if (duration <= 0) {
        this.logger.warn(`Invalid duration (${duration}s): ${filePath}`);
        return {
          status: FileHealthStatus.WARNING,
          message: `Invalid or missing duration (${duration}s) - file may be incomplete`,
        };
      }

      return {
        status: FileHealthStatus.HEALTHY,
        message: 'File validated successfully',
      };
    } catch (error) {
      this.logger.error(`File integrity check failed for ${filePath}:`, error);
      return {
        status: FileHealthStatus.CORRUPTED,
        message: `Integrity check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Probe a video file to get codec information using FFprobe
   *
   * @param filePath - Absolute path to video file
   * @param validateIntegrity - Whether to validate file integrity before probing (default: true)
   * @returns Video codec information with health status
   */
  async probeVideoFile(filePath: string, validateIntegrity = true): Promise<VideoCodecInfo | null> {
    let healthResult: FileHealthResult = {
      status: FileHealthStatus.UNKNOWN,
      message: 'Not validated',
    };

    try {
      // Optional: validate file integrity first
      if (validateIntegrity) {
        healthResult = await this.validateFileIntegrity(filePath);

        // Skip corrupted files entirely
        if (healthResult.status === FileHealthStatus.CORRUPTED) {
          this.logger.warn(`Skipping corrupted file: ${filePath}`);
          return null;
        }
      }

      // Use ffprobe to get video stream info
      const { stdout } = await execFileAsync(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=codec_name,width,height',
          '-show_entries',
          'format=duration,size',
          '-of',
          'json',
          filePath,
        ],
        { timeout: 10000 } // 10 second timeout per file
      );

      const probeData = JSON.parse(stdout);

      if (!probeData.streams || probeData.streams.length === 0) {
        this.logger.warn(`No video stream found in: ${filePath}`);
        return null;
      }

      const videoStream = probeData.streams[0];
      const format = probeData.format;

      // Normalize codec names
      let codec = videoStream.codec_name?.toUpperCase() || 'UNKNOWN';
      if (codec === 'H264') codec = 'H.264';
      if (codec === 'HEVC') codec = 'HEVC';

      return {
        filePath,
        codec,
        resolution: `${videoStream.width || 0}x${videoStream.height || 0}`,
        duration: parseFloat(format.duration || '0'),
        sizeBytes: parseInt(format.size || '0', 10),
        healthStatus: healthResult.status,
        healthMessage: healthResult.message,
      };
    } catch (error) {
      this.logger.error(`Failed to probe file: ${filePath}`, error);
      return null;
    }
  }

  /**
   * Analyze if a file needs encoding based on policy target codec
   *
   * @param videoInfo - Video codec information
   * @param targetCodec - Target codec from policy (e.g., 'HEVC', 'AV1')
   * @returns true if file needs encoding
   */
  needsEncoding(videoInfo: VideoCodecInfo, targetCodec: string): boolean {
    const normalizedTarget = targetCodec.toUpperCase();
    const normalizedCurrent = videoInfo.codec.toUpperCase();

    // File needs encoding if current codec doesn't match target
    return normalizedCurrent !== normalizedTarget;
  }

  /**
   * Batch analyze multiple video files
   *
   * @param filePaths - Array of absolute file paths
   * @param targetCodec - Target codec from policy (for reference only, doesn't filter results)
   * @param concurrency - Number of files to probe concurrently (default: 3)
   * @returns Analysis results with ALL files (filtering by queue status happens in libraries.service)
   */
  async analyzeFiles(
    filePaths: string[],
    targetCodec: string,
    concurrency = 3
  ): Promise<ScanAnalysis> {
    this.logger.log(`Analyzing ${filePaths.length} files (target: ${targetCodec})`);

    const analysis: ScanAnalysis = {
      totalFiles: 0,
      totalSizeBytes: BigInt(0),
      needsEncoding: [], // All files go here (name kept for backward compatibility)
      alreadyOptimized: [], // Kept empty for backward compatibility
      errors: [],
    };

    // Process files in batches to avoid overwhelming FFprobe
    for (let i = 0; i < filePaths.length; i += concurrency) {
      const batch = filePaths.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async (filePath) => {
          try {
            const info = await this.probeVideoFile(filePath);
            return { filePath, info, error: null };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return { filePath, info: null, error: errorMessage };
          }
        })
      );

      // Add all valid files to needsEncoding array (no codec filtering)
      for (const { filePath, info, error } of results) {
        if (error) {
          analysis.errors.push({ filePath, error });
          continue;
        }

        if (!info) {
          analysis.errors.push({ filePath, error: 'Failed to probe file' });
          continue;
        }

        analysis.totalFiles++;
        analysis.totalSizeBytes += BigInt(info.sizeBytes);

        // Add ALL files to needsEncoding array
        // Job status filtering (QUEUED, ENCODING, COMPLETED, etc.) happens in libraries.service
        // This allows re-encoding files already in target codec (e.g., H.265 → H.265 with different settings)
        analysis.needsEncoding.push(info);
      }
    }

    this.logger.log(
      `Analysis complete: ${analysis.needsEncoding.length} total files, ${analysis.errors.length} errors`
    );

    return analysis;
  }
}
