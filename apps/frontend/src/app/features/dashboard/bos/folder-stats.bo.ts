import type { FolderStatsModel } from '../models/folder-stats.model';

export class FolderStatsBo {
  name: string;
  path: string;
  totalSizeGB: number;
  fileCount: number;
  codecDistribution: {
    hevc: number;
    h264: number;
    av1: number;
    other: number;
  };
  percentH265: number;
  sampled: number;
  avgBitrateMbps: number;
  spaceSavedEstimateGb: number;

  constructor(model: FolderStatsModel) {
    this.name = model.name || 'Unknown';
    this.path = model.path || '';
    this.totalSizeGB = model.total_size_gb || 0;
    this.fileCount = model.file_count || 0;
    this.codecDistribution = {
      hevc: model.codec_distribution?.hevc || 0,
      h264: model.codec_distribution?.h264 || 0,
      av1: model.codec_distribution?.av1 || 0,
      other: model.codec_distribution?.other || 0,
    };
    this.percentH265 = model.percent_h265 || 0;
    this.sampled = model.sampled || 0;
    this.avgBitrateMbps = model.avg_bitrate_mbps || 0;
    this.spaceSavedEstimateGb = model.space_saved_estimate_gb || 0;
  }

  get totalSizeFormatted(): string {
    if (this.totalSizeGB >= 1000) {
      return `${(this.totalSizeGB / 1000).toFixed(2)} TB`;
    }
    return `${this.totalSizeGB.toFixed(2)} GB`;
  }

  get spaceSavedFormatted(): string {
    if (this.spaceSavedEstimateGb >= 1000) {
      return `${(this.spaceSavedEstimateGb / 1000).toFixed(2)} TB`;
    }
    return `${this.spaceSavedEstimateGb.toFixed(2)} GB`;
  }

  get hevcPercentage(): number {
    return this.percentH265;
  }

  get h264Percentage(): number {
    return this.fileCount > 0 ? (this.codecDistribution.h264 / this.fileCount) * 100 : 0;
  }

  get badge(): { text: string; class: string } {
    if (this.percentH265 >= 95) {
      return { text: '✓ Complete', class: 'badge-success' };
    }
    if (this.percentH265 >= 75) {
      return { text: '⚡ Active', class: 'badge-warning' };
    }
    return { text: '⚠ Needs Work', class: 'badge-danger' };
  }
}
