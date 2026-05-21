import { Injectable } from '@nestjs/common';
import type { EncodingProgressDto } from './dto/encoding-progress.dto';

/**
 * FfmpegProgressParserService
 *
 * Pure, stateless service for parsing FFmpeg progress output.
 * Handles regex-based progress line parsing and time-to-percentage conversion.
 */
@Injectable()
export class FfmpegProgressParserService {
  // Example: frame= 2450 fps= 87 q=28.0 size=   12288kB time=00:01:42.50 bitrate=1234.5kbits/s speed=3.62x
  private readonly progressRegex = /frame=\s*(\d+).*fps=\s*([\d.]+).*time=\s*([\d:.]+)/;

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
   *
   * @param currentTime - Current time position (HH:MM:SS.MS)
   * @param totalDurationSeconds - Total video duration in seconds
   * @returns Progress percentage (0-100)
   */
  calculateProgressPercentage(currentTime: string, totalDurationSeconds: number): number {
    // Handle N/A or invalid time - FFmpeg outputs N/A during initial decoding phase
    if (!currentTime || currentTime === 'N/A' || currentTime === 'n/a') {
      return 0;
    }

    // Parse HH:MM:SS.MS format
    const parts = currentTime.split(':');
    if (parts.length !== 3) {
      // Try parsing as microseconds (out_time_us format)
      const microseconds = Number.parseInt(currentTime, 10);
      if (!Number.isNaN(microseconds) && microseconds > 0) {
        const currentSeconds = microseconds / 1_000_000;
        const percentage = (currentSeconds / totalDurationSeconds) * 100;
        return Math.min(100, Math.max(0, percentage));
      }
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
   * Parse HH:MM:SS.MS timestamp to seconds
   *
   * @param timestamp - Time string in HH:MM:SS.MS format
   * @returns Time in seconds
   */
  parseTimestampToSeconds(timestamp: string): number {
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
   * Convert seconds to HH:MM:SS.MS timestamp format
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
}
