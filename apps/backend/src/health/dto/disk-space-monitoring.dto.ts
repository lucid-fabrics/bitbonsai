import { ApiProperty } from '@nestjs/swagger';
import type { LibraryDiskSpaceDto } from './library-disk-space.dto';

export class DiskSpaceMonitoringDto {
  @ApiProperty({
    description: 'Overall disk space status across all libraries',
    enum: ['ok', 'warning', 'critical'],
    example: 'ok',
  })
  overallStatus!: 'ok' | 'warning' | 'critical';

  @ApiProperty({
    description: 'Timestamp of when this monitoring data was generated',
    type: Date,
    example: '2024-01-15T10:30:00Z',
  })
  timestamp!: Date;

  @ApiProperty({
    description: 'Per-library disk space breakdown',
    type: 'array',
    items: {
      type: 'object',
    },
  })
  libraries!: LibraryDiskSpaceDto[];

  @ApiProperty({
    description: 'Global warnings across all libraries',
    type: 'array',
    items: {
      type: 'string',
    },
    example: ['Library "Movies" is running low on disk space (90% used)'],
  })
  globalWarnings!: string[];

  @ApiProperty({
    description: 'Total queued jobs across all libraries',
    type: Number,
    example: 25,
  })
  totalQueuedJobs!: number;

  @ApiProperty({
    description: 'Total estimated space needed for all queued jobs in bytes',
    type: String,
    example: '250000000000',
    nullable: true,
  })
  totalEstimatedSpaceNeeded!: string | null;

  @ApiProperty({
    description: 'Whether the system can accommodate all queued jobs',
    type: Boolean,
    example: true,
  })
  canAccommodateQueue!: boolean;
}
