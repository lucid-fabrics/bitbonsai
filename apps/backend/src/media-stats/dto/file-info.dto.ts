import { ApiProperty } from '@nestjs/swagger';

export class FileInfoDto {
  @ApiProperty({
    description: 'Full file path',
    example: '/media/Movies/Example Movie/example.mkv',
  })
  file_path!: string;

  @ApiProperty({
    description: 'File name without path',
    example: 'example.mkv',
  })
  file_name!: string;

  @ApiProperty({
    description: 'File size in gigabytes',
    example: 2.45,
  })
  size_gb!: number;

  @ApiProperty({
    description: 'Video codec',
    example: 'h264',
  })
  codec!: string;

  @ApiProperty({
    description: 'Video bitrate in Mbps',
    example: 5.2,
  })
  bitrate_mbps!: number;
}

export class FolderFilesDto {
  @ApiProperty({
    description: 'Folder name',
    example: 'Movies',
  })
  folder_name!: string;

  @ApiProperty({
    description: 'Folder path',
    example: '/media/Movies',
  })
  folder_path!: string;

  @ApiProperty({
    description: 'Codec filter applied',
    example: 'h264',
  })
  codec!: string;

  @ApiProperty({
    description: 'Total files matching filter',
    example: 42,
  })
  total_files!: number;

  @ApiProperty({
    description: 'List of files matching the codec filter',
    type: [FileInfoDto],
  })
  files!: FileInfoDto[];
}
