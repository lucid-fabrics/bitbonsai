import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { basename, join } from 'path';
import type { FileInfoDto, FolderFilesDto } from './dto/file-info.dto';
import type { FolderStatsDto, MediaStatsDto } from './dto/media-stats.dto';

interface VideoInfo {
  codec: string;
  bitrate: number;
  size: number;
}

@Injectable()
export class MediaStatsService {
  private readonly logger = new Logger(MediaStatsService.name);
  private readonly VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv'];
  private statsCache: MediaStatsDto | null = null;

  async getMediaStats(): Promise<MediaStatsDto> {
    if (!this.statsCache) {
      this.logger.log('No cached stats, triggering initial scan');
      await this.triggerScan();
    }
    return this.statsCache!;
  }

  async triggerScan(): Promise<void> {
    this.logger.log('Starting media scan...');

    const mediaPaths = this.getMediaPaths();
    const allStats = {
      totalFiles: 0,
      hevcCount: 0,
      h264Count: 0,
      av1Count: 0,
      otherCount: 0,
      totalSizeBytes: 0,
      totalBitrate: 0,
      bitrateCount: 0,
    };

    const folderStats: FolderStatsDto[] = [];

    for (const mediaPath of mediaPaths) {
      this.logger.log(`Scanning: ${mediaPath}`);
      const stats = await this.scanFolder(mediaPath);

      allStats.totalFiles += stats.file_count;
      allStats.hevcCount += stats.codec_distribution.hevc;
      allStats.h264Count += stats.codec_distribution.h264;
      allStats.av1Count += stats.codec_distribution.av1;
      allStats.otherCount += stats.codec_distribution.other;
      allStats.totalSizeBytes += stats.total_size_gb * 1024 ** 3;

      folderStats.push(stats);
    }

    const avgBitrate =
      allStats.bitrateCount > 0 ? allStats.totalBitrate / allStats.bitrateCount : 0;

    this.statsCache = {
      total_files: allStats.totalFiles,
      total_size_gb: Math.round((allStats.totalSizeBytes / 1024 ** 3) * 100) / 100,
      average_bitrate_mbps: Math.round(avgBitrate * 100) / 100,
      codec_distribution: {
        hevc: allStats.hevcCount,
        h264: allStats.h264Count,
        av1: allStats.av1Count,
        other: allStats.otherCount,
      },
      folders: folderStats,
      scan_timestamp: new Date().toISOString(),
    };

    this.logger.log(`Scan complete. Total files: ${allStats.totalFiles}`);
  }

  private async scanFolder(folderPath: string): Promise<FolderStatsDto> {
    const files = this.findVideoFiles(folderPath);
    const totalFiles = files.length;

    if (totalFiles === 0) {
      return {
        name: folderPath.split('/').pop() || folderPath,
        path: folderPath,
        file_count: 0,
        total_size_gb: 0,
        codec_distribution: {
          hevc: 0,
          h264: 0,
          av1: 0,
          other: 0,
        },
        percent_h265: 0,
        sampled: 0,
        avg_bitrate_mbps: 0,
        space_saved_estimate_gb: 0,
      };
    }

    // Sample files (analyze all if <= 50, otherwise sample 50)
    const sampleSize = Math.min(50, totalFiles);
    const sampleFiles = this.getRandomSample(files, sampleSize);

    const codecCounts = { hevc: 0, h264: 0, av1: 0, other: 0 };
    let totalSize = 0;
    let totalBitrate = 0;
    let bitrateCount = 0;

    for (const file of sampleFiles) {
      const info = this.getVideoInfo(file);
      totalSize += info.size;

      if (info.bitrate > 0) {
        totalBitrate += info.bitrate;
        bitrateCount++;
      }

      if (info.codec === 'hevc' || info.codec === 'h265') {
        codecCounts.hevc++;
      } else if (info.codec === 'h264') {
        codecCounts.h264++;
      } else if (info.codec === 'av1') {
        codecCounts.av1++;
      } else {
        codecCounts.other++;
      }
    }

    // Extrapolate to total files
    const ratio = totalFiles / sampleSize;
    const hevcTotal = Math.round(codecCounts.hevc * ratio);
    const h264Total = Math.round(codecCounts.h264 * ratio);
    const av1Total = Math.round(codecCounts.av1 * ratio);
    const otherTotal = Math.round(codecCounts.other * ratio);
    const totalSizeGb = (totalSize * ratio) / 1024 ** 3;
    const avgBitrate = bitrateCount > 0 ? totalBitrate / bitrateCount : 0;

    // Calculate percentage of H.265 files
    const percentH265 = totalFiles > 0 ? Math.round((hevcTotal / totalFiles) * 100) : 0;

    // Estimate space saved (H.265 typically 40-50% smaller than H.264)
    const h264SizeEstimate = (codecCounts.h264 / sampleSize) * totalSize * ratio;
    const spaceSavedGb = (h264SizeEstimate * 0.45) / 1024 ** 3;

    return {
      name: folderPath.split('/').pop() || folderPath,
      path: folderPath,
      file_count: totalFiles,
      total_size_gb: Math.round(totalSizeGb * 100) / 100,
      codec_distribution: {
        hevc: hevcTotal,
        h264: h264Total,
        av1: av1Total,
        other: otherTotal,
      },
      percent_h265: percentH265,
      sampled: sampleSize,
      avg_bitrate_mbps: Math.round((avgBitrate / 1_000_000) * 100) / 100,
      space_saved_estimate_gb: Math.round(spaceSavedGb * 100) / 100,
    };
  }

  private findVideoFiles(dirPath: string): string[] {
    const files: string[] = [];

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          files.push(...this.findVideoFiles(fullPath));
        } else if (entry.isFile()) {
          const ext = entry.name.substring(entry.name.lastIndexOf('.')).toLowerCase();
          if (this.VIDEO_EXTENSIONS.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error reading directory ${dirPath}: ${errorMessage}`);
    }

    return files;
  }

  private getVideoInfo(filePath: string): VideoInfo {
    try {
      const result = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,bit_rate -of json "${filePath}"`,
        { timeout: 5000, encoding: 'utf8' }
      );

      const data = JSON.parse(result);
      const codec = data.streams?.[0]?.codec_name?.toLowerCase() || 'unknown';
      const bitrate = parseInt(data.streams?.[0]?.bit_rate || '0', 10);
      const size = statSync(filePath).size;

      return { codec, bitrate, size };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to get info for ${filePath}: ${errorMessage}`);
      return { codec: 'unknown', bitrate: 0, size: 0 };
    }
  }

  private getMediaPaths(): string[] {
    const pathsEnv = process.env.MEDIA_PATHS || '/media';
    return pathsEnv.split(',').map((p) => p.trim());
  }

  private getRandomSample<T>(array: T[], size: number): T[] {
    const shuffled = [...array].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, size);
  }

  async getFolderFiles(folderName: string, codec?: string): Promise<FolderFilesDto> {
    this.logger.log(`Getting files for folder: ${folderName}, codec: ${codec || 'all'}`);

    const mediaPaths = this.getMediaPaths();
    const folderPath = mediaPaths.find(
      (p) =>
        p.endsWith(`/${folderName}`) ||
        p.endsWith(`\\${folderName}`) ||
        p === `/media/${folderName}`
    );

    if (!folderPath) {
      throw new NotFoundException(`Folder "${folderName}" not found in configured media paths`);
    }

    const allFiles = this.findVideoFiles(folderPath);
    const fileInfoList: FileInfoDto[] = [];

    for (const filePath of allFiles) {
      const info = this.getVideoInfo(filePath);

      // Filter by codec if specified
      if (codec && info.codec !== codec.toLowerCase()) {
        continue;
      }

      fileInfoList.push({
        file_path: filePath,
        file_name: basename(filePath),
        size_gb: Math.round((info.size / 1024 ** 3) * 100) / 100,
        codec: info.codec,
        bitrate_mbps: Math.round((info.bitrate / 1_000_000) * 100) / 100,
      });
    }

    return {
      folder_name: folderName,
      folder_path: folderPath,
      codec: codec || 'all',
      total_files: fileInfoList.length,
      files: fileInfoList,
    };
  }
}
