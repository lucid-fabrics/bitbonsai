import { ApiProperty } from '@nestjs/swagger';

export class LibraryDiskSpaceDto {
  @ApiProperty({
    description: 'Library unique identifier',
    type: String,
    example: 'lib-123',
  })
  libraryId!: string;

  @ApiProperty({
    description: 'Library name',
    type: String,
    example: 'Movies',
  })
  libraryName!: string;

  @ApiProperty({
    description: 'Library file system path',
    type: String,
    example: '/mnt/user/movies',
  })
  path!: string;

  @ApiProperty({
    description: 'Disk space status for this library path',
    enum: ['ok', 'warning', 'critical'],
    example: 'ok',
  })
  status!: 'ok' | 'warning' | 'critical';

  @ApiProperty({
    description: 'Total size of the filesystem/mount point in bytes',
    type: String,
    example: '1000000000000',
  })
  totalBytes!: string;

  @ApiProperty({
    description: 'Available (free) space in bytes',
    type: String,
    example: '500000000000',
  })
  availableBytes!: string;

  @ApiProperty({
    description: 'Used space in bytes',
    type: String,
    example: '500000000000',
  })
  usedBytes!: string;

  @ApiProperty({
    description: 'Percentage of space used (0-100)',
    type: Number,
    example: 50,
  })
  usedPercent!: number;

  @ApiProperty({
    description: 'Human-readable available space',
    type: String,
    example: '500 GB',
  })
  availableFormatted!: string;

  @ApiProperty({
    description: 'Human-readable total space',
    type: String,
    example: '1 TB',
  })
  totalFormatted!: string;

  @ApiProperty({
    description: 'Number of queued jobs for this library',
    type: Number,
    example: 10,
  })
  queuedJobsCount!: number;

  @ApiProperty({
    description: 'Estimated space needed for queued jobs in bytes',
    type: String,
    example: '100000000000',
    nullable: true,
  })
  estimatedSpaceNeededBytes!: string | null;

  @ApiProperty({
    description: 'Whether there is enough space for queued jobs',
    type: Boolean,
    example: true,
  })
  hasEnoughSpaceForQueue!: boolean;

  @ApiProperty({
    description: 'Warning message if space is low or insufficient',
    type: String,
    example: 'Not enough space to complete all queued jobs',
    nullable: true,
  })
  warningMessage!: string | null;
}
