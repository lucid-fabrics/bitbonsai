export interface FolderStatsModel {
  name: string;
  path: string;
  total_size_gb: number;
  file_count: number;
  codec_distribution: {
    hevc: number;
    h264: number;
    av1: number;
    other: number;
  };
}
