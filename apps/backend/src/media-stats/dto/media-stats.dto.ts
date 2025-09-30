export interface MediaStatsDto {
  total_size_gb: number;
  total_files: number;
  average_bitrate_mbps: number;
  codec_distribution: CodecDistributionDto;
  folders: FolderStatsDto[];
  scan_timestamp: string;
}

export interface CodecDistributionDto {
  hevc: number;
  h264: number;
  av1: number;
  other: number;
}

export interface FolderStatsDto {
  name: string;
  path: string;
  total_size_gb: number;
  file_count: number;
  codec_distribution: CodecDistributionDto;
}
