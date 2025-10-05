import { ApiProperty } from '@nestjs/swagger';

/**
 * System health information with snake_case field names for frontend compatibility
 */
export class SystemHealthModel {
  @ApiProperty({
    description: 'Number of currently active nodes and total nodes',
    example: { current: 3, total: 5 },
  })
  active_nodes!: {
    current: number;
    total: number;
  };

  @ApiProperty({
    description: 'Current queue status with encoding count',
    example: { encoding_count: 5 },
  })
  queue_status!: {
    encoding_count: number;
  };

  @ApiProperty({
    description: 'Total storage saved in terabytes',
    example: { total_tb: 2.5 },
  })
  storage_saved!: {
    total_tb: number;
  };

  @ApiProperty({
    description: 'Success rate percentage',
    example: { percentage: 95.5 },
  })
  success_rate!: {
    percentage: number;
  };
}

/**
 * Queue summary with counts by stage
 */
export class QueueSummaryModel {
  @ApiProperty({
    description: 'Number of jobs queued and waiting to start',
    example: 25,
    minimum: 0,
  })
  queued!: number;

  @ApiProperty({
    description: 'Number of jobs currently encoding',
    example: 8,
    minimum: 0,
  })
  encoding!: number;

  @ApiProperty({
    description: 'Number of completed jobs',
    example: 342,
    minimum: 0,
  })
  completed!: number;

  @ApiProperty({
    description: 'Number of failed jobs',
    example: 5,
    minimum: 0,
  })
  failed!: number;
}

/**
 * Recent activity item representing a completed job
 */
export class RecentActivityModel {
  @ApiProperty({
    description: 'Job unique identifier',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  id!: string;

  @ApiProperty({
    description: 'User-friendly file name',
    example: 'The Matrix (1999).mkv',
  })
  file_name!: string;

  @ApiProperty({
    description: 'Library name where the file belongs',
    example: 'Main Movie Collection',
  })
  library!: string;

  @ApiProperty({
    description: 'Codec change description',
    example: 'H.264 → H.265',
  })
  codec_change!: string;

  @ApiProperty({
    description: 'Space saved in gigabytes',
    example: 1.25,
  })
  savings_gb!: number;

  @ApiProperty({
    description: 'Duration in seconds',
    example: 120,
  })
  duration_seconds!: number;

  @ApiProperty({
    description: 'Timestamp when the job was completed',
    example: '2025-09-30T21:45:32.123Z',
    format: 'date-time',
  })
  completed_at!: string;
}

/**
 * Top library by job count
 */
export class TopLibraryModel {
  @ApiProperty({
    description: 'Library display name',
    example: 'Main Movie Collection',
  })
  name!: string;

  @ApiProperty({
    description: 'Total number of jobs for this library',
    example: 127,
    minimum: 0,
  })
  job_count!: number;

  @ApiProperty({
    description: 'Total space saved across all jobs in gigabytes',
    example: 15.5,
  })
  total_savings_gb!: number;
}

/**
 * Complete overview response for the dashboard
 * Uses snake_case field names for frontend compatibility
 */
export class OverviewResponseDto {
  @ApiProperty({
    description: 'System health information',
    type: SystemHealthModel,
  })
  system_health!: SystemHealthModel;

  @ApiProperty({
    description: 'Queue summary statistics',
    type: QueueSummaryModel,
  })
  queue_summary!: QueueSummaryModel;

  @ApiProperty({
    description: 'Recent activity showing last 10 completed jobs',
    type: [RecentActivityModel],
    maxItems: 10,
  })
  recent_activity!: RecentActivityModel[];

  @ApiProperty({
    description: 'Top 5 libraries by job count',
    type: [TopLibraryModel],
    maxItems: 5,
  })
  top_libraries!: TopLibraryModel[];

  @ApiProperty({
    description: 'Timestamp when these statistics were generated',
    example: '2025-09-30T21:45:32.123Z',
    format: 'date-time',
  })
  last_updated!: string;
}
