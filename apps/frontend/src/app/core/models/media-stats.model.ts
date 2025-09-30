import { FolderStatsModel } from './folder-stats.model';

export interface MediaStatsModel {
  total_size_gb: number;
  total_files: number;
  average_bitrate_mbps: number;
  codec_distribution: CodecDistributionModel;
  folders: FolderStatsModel[];
  scan_timestamp: string;
}

export interface CodecDistributionModel {
  hevc: number;
  h264: number;
  av1: number;
  other: number;
}
