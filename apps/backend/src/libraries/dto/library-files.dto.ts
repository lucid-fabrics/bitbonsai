import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for a single video file in the library
 */
export class LibraryFileDto {
  @ApiProperty({
    description: 'Absolute path to the video file',
    example: '/mnt/user/media/movies/The Matrix.mkv',
  })
  filePath!: string;

  @ApiProperty({
    description: 'File name without path',
    example: 'The Matrix.mkv',
  })
  fileName!: string;

  @ApiProperty({
    description: 'Video codec (e.g., H.264, HEVC, AV1)',
    example: 'H.264',
  })
  codec!: string;

  @ApiProperty({
    description: 'Video resolution (e.g., 1920x1080)',
    example: '1920x1080',
  })
  resolution!: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 1024000000,
  })
  sizeBytes!: number;

  @ApiProperty({
    description: 'Video duration in seconds',
    example: 7200,
  })
  duration!: number;

  @ApiProperty({
    description: 'File health status',
    example: 'HEALTHY',
    enum: ['HEALTHY', 'WARNING', 'CORRUPTED', 'UNKNOWN'],
  })
  healthStatus!: string;

  @ApiProperty({
    description: 'Health status message',
    example: 'File validated successfully',
    required: false,
  })
  healthMessage?: string;
}

/**
 * DTO for the library files response
 */
export class LibraryFilesDto {
  @ApiProperty({
    description: 'Library unique identifier',
    example: 'clq8x9z8x0002qh8x9z8x0002',
  })
  libraryId!: string;

  @ApiProperty({
    description: 'Library name',
    example: 'Movies',
  })
  libraryName!: string;

  @ApiProperty({
    description: 'Total number of video files found',
    example: 150,
  })
  totalFiles!: number;

  @ApiProperty({
    description: 'Total size of all files in bytes',
    example: '153600000000',
  })
  totalSizeBytes!: string;

  @ApiProperty({
    description: 'List of video files in the library',
    type: [LibraryFileDto],
  })
  files!: LibraryFileDto[];

  @ApiProperty({
    description: 'Timestamp when the files were scanned',
    example: '2025-01-15T10:30:00Z',
  })
  scannedAt!: Date;
}
