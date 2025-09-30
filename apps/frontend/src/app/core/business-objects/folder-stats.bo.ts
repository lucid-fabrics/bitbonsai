import { FolderStatsModel } from '../models/folder-stats.model';

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

  constructor(model: FolderStatsModel) {
    this.name = model.name || 'Unknown';
    this.path = model.path || '';
    this.totalSizeGB = model.total_size_gb || 0;
    this.fileCount = model.file_count || 0;
    this.codecDistribution = {
      hevc: model.codec_distribution?.hevc || 0,
      h264: model.codec_distribution?.h264 || 0,
      av1: model.codec_distribution?.av1 || 0,
      other: model.codec_distribution?.other || 0
    };
  }

  get totalSizeFormatted(): string {
    return `${this.totalSizeGB.toFixed(2)} GB`;
  }

  get hevcPercentage(): number {
    return this.fileCount > 0 ? (this.codecDistribution.hevc / this.fileCount) * 100 : 0;
  }

  get h264Percentage(): number {
    return this.fileCount > 0 ? (this.codecDistribution.h264 / this.fileCount) * 100 : 0;
  }
}
