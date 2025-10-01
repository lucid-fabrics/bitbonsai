import { ApiProperty } from '@nestjs/swagger';

export class CodecDistributionDto {
  @ApiProperty({
    description: 'Number of files using H.265/HEVC codec',
    example: 245,
    minimum: 0,
  })
  hevc!: number;

  @ApiProperty({
    description: 'Number of files using H.264/AVC codec',
    example: 532,
    minimum: 0,
  })
  h264!: number;

  @ApiProperty({
    description: 'Number of files using AV1 codec',
    example: 12,
    minimum: 0,
  })
  av1!: number;

  @ApiProperty({
    description:
      'Number of files using other codecs (VP9, MPEG-2, MPEG-4, etc.)',
    example: 8,
    minimum: 0,
  })
  other!: number;
}

export class FolderStatsDto {
  @ApiProperty({
    description: 'Display name of the media folder',
    example: 'TV Shows',
  })
  name!: string;

  @ApiProperty({
    description: 'Absolute path to the media folder',
    example: '/media/TV',
  })
  path!: string;

  @ApiProperty({
    description: 'Total storage used by this folder in gigabytes',
    example: 523.47,
    minimum: 0,
  })
  total_size_gb!: number;

  @ApiProperty({
    description: 'Number of video files in this folder',
    example: 387,
    minimum: 0,
  })
  file_count!: number;

  @ApiProperty({
    description: 'Codec distribution for files in this folder',
    type: CodecDistributionDto,
  })
  codec_distribution!: CodecDistributionDto;

  @ApiProperty({
    description: 'Percentage of files using H.265/HEVC codec',
    example: 65,
    minimum: 0,
    maximum: 100,
  })
  percent_h265!: number;

  @ApiProperty({
    description: 'Number of files sampled for analysis (for transparency)',
    example: 50,
    minimum: 0,
  })
  sampled!: number;

  @ApiProperty({
    description: 'Average bitrate of media files in this folder in Mbps',
    example: 8.5,
    minimum: 0,
  })
  avg_bitrate_mbps!: number;

  @ApiProperty({
    description: 'Estimated space savings if H.264 files were re-encoded to H.265',
    example: 125.3,
    minimum: 0,
  })
  space_saved_estimate_gb!: number;
}

export class MediaStatsDto {
  @ApiProperty({
    description:
      'Total storage used across all media directories in gigabytes',
    example: 1247.83,
    minimum: 0,
  })
  total_size_gb!: number;

  @ApiProperty({
    description: 'Total number of video files across all directories',
    example: 797,
    minimum: 0,
  })
  total_files!: number;

  @ApiProperty({
    description: 'Average bitrate of all media files in megabits per second',
    example: 8.5,
    minimum: 0,
  })
  average_bitrate_mbps!: number;

  @ApiProperty({
    description:
      'Distribution of video codecs across the entire media library',
    type: CodecDistributionDto,
  })
  codec_distribution!: CodecDistributionDto;

  @ApiProperty({
    description:
      'Detailed statistics for each media folder configured in MEDIA_PATHS',
    type: [FolderStatsDto],
    example: [
      {
        name: 'TV Shows',
        path: '/media/TV',
        total_size_gb: 523.47,
        file_count: 387,
        codec_distribution: { hevc: 120, h264: 255, av1: 8, other: 4 },
      },
      {
        name: 'Movies',
        path: '/media/Movies',
        total_size_gb: 624.36,
        file_count: 298,
        codec_distribution: { hevc: 98, h264: 195, av1: 3, other: 2 },
      },
      {
        name: 'Anime',
        path: '/media/Anime',
        total_size_gb: 100.0,
        file_count: 112,
        codec_distribution: { hevc: 27, h264: 82, av1: 1, other: 2 },
      },
    ],
  })
  folders!: FolderStatsDto[];

  @ApiProperty({
    description:
      'ISO 8601 timestamp of when the media library was last scanned',
    example: '2025-09-30T21:45:32.123Z',
    format: 'date-time',
  })
  scan_timestamp!: string;
}
