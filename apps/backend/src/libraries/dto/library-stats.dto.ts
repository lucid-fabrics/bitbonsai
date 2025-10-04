import { ApiProperty } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';

/**
 * Simplified Node information for library response
 */
export class LibraryNodeDto {
  @ApiProperty({
    description: 'Node unique identifier',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  id!: string;

  @ApiProperty({
    description: 'Node display name',
    example: 'Main Server',
  })
  name!: string;

  @ApiProperty({
    description: 'Current status of the node',
    example: 'ONLINE',
  })
  status!: string;
}

/**
 * Simplified Policy information for library response
 */
export class LibraryPolicyDto {
  @ApiProperty({
    description: 'Policy unique identifier',
    example: 'clq8x9z8x0001qh8x9z8x0001',
  })
  id!: string;

  @ApiProperty({
    description: 'Policy display name',
    example: 'Balanced HEVC Encoding',
  })
  name!: string;

  @ApiProperty({
    description: 'Policy preset type',
    example: 'BALANCED_HEVC',
  })
  preset!: string;
}

/**
 * Job count information for a library
 */
export class LibraryJobCountDto {
  @ApiProperty({
    description: 'Total number of jobs associated with this library',
    example: 42,
    minimum: 0,
  })
  jobs!: number;
}

/**
 * Complete library information with statistics
 */
export class LibraryStatsDto {
  @ApiProperty({
    description: 'Library unique identifier',
    example: 'clq8x9z8x0002qh8x9z8x0002',
  })
  id!: string;

  @ApiProperty({
    description: 'Display name of the library',
    example: 'Main Movie Collection',
  })
  name!: string;

  @ApiProperty({
    description: 'Absolute path to the library folder',
    example: '/mnt/user/media/Movies',
  })
  path!: string;

  @ApiProperty({
    description: 'Type of media content',
    enum: MediaType,
    example: MediaType.MOVIE,
    enumName: 'MediaType',
  })
  mediaType!: MediaType;

  @ApiProperty({
    description: 'Whether the library is enabled for scanning and processing',
    example: true,
  })
  enabled!: boolean;

  @ApiProperty({
    description: 'Whether automatic file watching (inotify) is enabled',
    example: false,
  })
  watchEnabled!: boolean;

  @ApiProperty({
    description: 'Timestamp of the last library scan',
    example: '2025-09-30T21:45:32.123Z',
    format: 'date-time',
    nullable: true,
  })
  lastScanAt!: Date | null;

  @ApiProperty({
    description: 'Total number of files in the library',
    example: 523,
    minimum: 0,
  })
  totalFiles!: number;

  @ApiProperty({
    description: 'Total storage size of the library in bytes',
    example: '562949953421312',
    type: 'string',
  })
  totalSizeBytes!: bigint;

  @ApiProperty({
    description: 'Node managing this library',
    type: LibraryNodeDto,
  })
  node!: LibraryNodeDto;

  @ApiProperty({
    description: 'Encoding policies applied to this library',
    type: [LibraryPolicyDto],
  })
  policies!: LibraryPolicyDto[];

  @ApiProperty({
    description: 'Job statistics for this library',
    type: LibraryJobCountDto,
  })
  _count!: LibraryJobCountDto;

  @ApiProperty({
    description: 'Timestamp when the library was created',
    example: '2025-09-28T10:15:20.123Z',
    format: 'date-time',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Timestamp when the library was last updated',
    example: '2025-09-30T21:45:32.123Z',
    format: 'date-time',
  })
  updatedAt!: Date;
}
