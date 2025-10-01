import { MediaStatsModel } from '../models/media-stats.model';
import { FolderStatsBo } from './folder-stats.bo';

export class MediaStatsBo {
  totalSizeGB: number;
  totalFiles: number;
  averageBitrateMbps: number;
  codecDistribution: {
    hevc: number;
    h264: number;
    av1: number;
    other: number;
  };
  folders: FolderStatsBo[];
  scanTimestamp: Date;

  constructor(model: MediaStatsModel) {
    this.totalSizeGB = model.total_size_gb || 0;
    this.totalFiles = model.total_files || 0;
    this.averageBitrateMbps = model.average_bitrate_mbps || 0;
    this.codecDistribution = {
      hevc: model.codec_distribution?.hevc || 0,
      h264: model.codec_distribution?.h264 || 0,
      av1: model.codec_distribution?.av1 || 0,
      other: model.codec_distribution?.other || 0
    };
    this.folders = model.folders?.map(f => new FolderStatsBo(f)) || [];
    this.scanTimestamp = new Date(model.scan_timestamp);
  }

  get totalSizeFormatted(): string {
    return `${this.totalSizeGB.toFixed(2)} GB`;
  }

  get hevcPercentage(): number {
    return this.totalFiles > 0 ? (this.codecDistribution.hevc / this.totalFiles) * 100 : 0;
  }

  get h264Percentage(): number {
    return this.totalFiles > 0 ? (this.codecDistribution.h264 / this.totalFiles) * 100 : 0;
  }

  get av1Percentage(): number {
    return this.totalFiles > 0 ? (this.codecDistribution.av1 / this.totalFiles) * 100 : 0;
  }

  get scanTimestampFormatted(): string {
    return this.scanTimestamp.toLocaleString();
  }

  get totalSizeFormattedLarge(): string {
    if (this.totalSizeGB >= 1000) {
      return `${(this.totalSizeGB / 1000).toFixed(2)} TB`;
    }
    return `${this.totalSizeGB.toFixed(2)} GB`;
  }

  get completionPercentage(): number {
    return this.totalFiles > 0 ? Math.round((this.codecDistribution.hevc / this.totalFiles) * 100) : 0;
  }

  get h264RemainingCount(): number {
    return this.codecDistribution.h264;
  }
}
