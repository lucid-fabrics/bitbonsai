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

  @ApiProperty({
    description: 'CPU utilization percentage',
    example: { percentage: 25.5 },
  })
  cpu_utilization!: {
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
 * Recent activity item representing a completed or encoding job
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
    description: 'Source codec before encoding',
    example: 'H.264',
  })
  source_codec!: string;

  @ApiProperty({
    description: 'Target codec after encoding',
    example: 'HEVC',
  })
  target_codec!: string;

  @ApiProperty({
    description: 'Current job stage',
    example: 'COMPLETED',
    enum: ['COMPLETED', 'ENCODING'],
  })
  stage!: string;

  @ApiProperty({
    description: 'Original file size before encoding in bytes',
    example: 3221225472,
  })
  before_size_bytes!: number;

  @ApiProperty({
    description: 'File size after encoding in bytes (null for encoding jobs)',
    example: 1610612736,
    nullable: true,
  })
  after_size_bytes!: number | null;

  @ApiProperty({
    description: 'Bytes saved by encoding (null for encoding jobs)',
    example: 1610612736,
    nullable: true,
  })
  saved_bytes!: number | null;

  @ApiProperty({
    description: 'Percentage saved (null for encoding jobs)',
    example: 50.0,
    nullable: true,
  })
  saved_percent!: number | null;

  @ApiProperty({
    description: 'Encoding progress percentage (0-100, only for encoding jobs)',
    example: 67.5,
    nullable: true,
  })
  progress!: number | null;

  @ApiProperty({
    description: 'Timestamp when the job was completed or last updated',
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
    description: 'Library media type',
    example: 'MOVIE',
    enum: ['MOVIE', 'TV_SHOW', 'ANIME', 'ANIME_MOVIE', 'MIXED', 'OTHER'],
  })
  media_type!: string;

  @ApiProperty({
    description: 'Total number of jobs for this library',
    example: 127,
    minimum: 0,
  })
  job_count!: number;

  @ApiProperty({
    description: 'Number of completed jobs',
    example: 98,
    minimum: 0,
  })
  completed_jobs!: number;

  @ApiProperty({
    description: 'Number of jobs currently encoding',
    example: 5,
    minimum: 0,
  })
  encoding_jobs!: number;

  @ApiProperty({
    description: 'Total space saved across all jobs in bytes',
    example: 16642998272,
  })
  total_savings_bytes!: number;

  @ApiProperty({
    description: 'Total original size before encoding in bytes',
    example: 42949672960,
  })
  total_before_bytes!: number;
}

/**
 * Node status with statistics
 */
export class NodeStatusModel {
  @ApiProperty({
    description: 'Node unique identifier',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  id!: string;

  @ApiProperty({
    description: 'Display name of the node',
    example: 'Main Encoding Server',
  })
  name!: string;

  @ApiProperty({
    description: 'Node role',
    example: 'MAIN',
    enum: ['MAIN', 'LINKED'],
  })
  role!: string;

  @ApiProperty({
    description: 'Current operational status',
    example: 'ONLINE',
    enum: ['ONLINE', 'OFFLINE', 'ERROR'],
  })
  status!: string;

  @ApiProperty({
    description: 'Hardware acceleration type',
    example: 'NVIDIA',
    enum: ['NONE', 'NVIDIA', 'INTEL_QSV', 'AMD', 'APPLE_M'],
  })
  acceleration!: string;

  @ApiProperty({
    description: 'CPU usage percentage',
    example: 45.5,
    nullable: true,
  })
  cpu_usage!: number | null;

  @ApiProperty({
    description: 'Number of jobs currently encoding',
    example: 3,
  })
  encoding_count!: number;

  @ApiProperty({
    description: 'Total number of completed jobs',
    example: 127,
  })
  completed_count!: number;

  @ApiProperty({
    description: 'Total number of failed jobs',
    example: 5,
  })
  failed_count!: number;

  @ApiProperty({
    description: 'Total size saved in bytes',
    example: 16642998272,
  })
  total_saved_bytes!: number;

  @ApiProperty({
    description: 'Success rate percentage (completed / (completed + failed))',
    example: 95.5,
  })
  success_rate!: number;

  @ApiProperty({
    description: 'Estimated time remaining for ALL queued jobs assigned to this node in seconds',
    example: 14400,
    nullable: true,
  })
  total_queue_time_seconds!: number | null;

  @ApiProperty({
    description: 'Timestamp of last heartbeat',
    example: '2025-10-29T12:34:56.789Z',
  })
  last_heartbeat!: string;
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
    description: 'Node status with statistics for all nodes',
    type: [NodeStatusModel],
  })
  node_status!: NodeStatusModel[];

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
