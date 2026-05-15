import { ApiProperty } from '@nestjs/swagger';
import { JobStage } from '@prisma/client';

/**
 * System health information
 */
export class SystemHealthDto {
  @ApiProperty({
    description: 'Overall system status based on node health',
    enum: ['HEALTHY', 'DEGRADED', 'OFFLINE'],
    example: 'HEALTHY',
  })
  status!: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';

  @ApiProperty({
    description: 'Number of nodes currently online',
    example: 3,
    minimum: 0,
  })
  activeNodes!: number;

  @ApiProperty({
    description: 'Number of nodes currently offline or in error state',
    example: 1,
    minimum: 0,
  })
  offlineNodes!: number;

  @ApiProperty({
    description: 'Total storage capacity across all libraries in bytes',
    example: '5629499534213120',
    type: 'string',
  })
  totalStorage!: string;

  @ApiProperty({
    description: 'Total used storage across all libraries in bytes',
    example: '2251799813685248',
    type: 'string',
  })
  usedStorage!: string;

  @ApiProperty({
    description: 'Storage utilization percentage',
    example: 40.0,
    minimum: 0,
    maximum: 100,
  })
  storagePercent!: number;

  @ApiProperty({
    description: 'CPU utilization percentage',
    example: 25.5,
    minimum: 0,
    maximum: 100,
  })
  cpuPercent!: number;
}

/**
 * Queue statistics aggregated by job stage
 */
export class QueueStatsDto {
  @ApiProperty({
    description: 'Number of jobs in QUEUED stage waiting to start',
    example: 25,
    minimum: 0,
  })
  queued!: number;

  @ApiProperty({
    description: 'Number of jobs currently ENCODING',
    example: 8,
    minimum: 0,
  })
  encoding!: number;

  @ApiProperty({
    description: 'Number of jobs in COMPLETED stage',
    example: 342,
    minimum: 0,
  })
  completed!: number;

  @ApiProperty({
    description: 'Number of jobs in FAILED stage',
    example: 5,
    minimum: 0,
  })
  failed!: number;

  @ApiProperty({
    description: 'Total bytes saved across all completed jobs (can be negative)',
    example: '45097156608000',
    type: 'string',
  })
  totalSavedBytes!: string;

  @ApiProperty({
    description: 'Percentage of space saved across completed jobs',
    example: 35.2,
  })
  totalSavedPercent!: number;
}

/**
 * Recent activity item representing a completed or encoding job
 */
export class RecentActivityDto {
  @ApiProperty({
    description: 'Job unique identifier',
    example: 'clq8x9z8x0003qh8x9z8x0003',
  })
  id!: string;

  @ApiProperty({
    description: 'User-friendly file name',
    example: 'The Matrix (1999).mkv',
  })
  fileLabel!: string;

  @ApiProperty({
    description: 'Library name where the file belongs',
    example: 'Main Movie Collection',
  })
  libraryName!: string;

  @ApiProperty({
    description: 'Source codec before encoding',
    example: 'H.264',
  })
  sourceCodec!: string;

  @ApiProperty({
    description: 'Target codec after encoding',
    example: 'HEVC',
  })
  targetCodec!: string;

  @ApiProperty({
    description: 'Current job stage',
    enum: JobStage,
    example: JobStage.COMPLETED,
    enumName: 'JobStage',
  })
  stage!: JobStage;

  @ApiProperty({
    description: 'Original file size before encoding in bytes',
    example: '3221225472',
    type: 'string',
  })
  beforeSizeBytes!: string;

  @ApiProperty({
    description: 'File size after encoding in bytes (null for encoding jobs)',
    example: '1610612736',
    type: 'string',
    nullable: true,
  })
  afterSizeBytes!: string | null;

  @ApiProperty({
    description: 'Bytes saved by encoding (can be negative if larger, null for encoding jobs)',
    example: '1342177280',
    type: 'string',
    nullable: true,
  })
  savedBytes!: string | null;

  @ApiProperty({
    description: 'Percentage saved (null for encoding jobs)',
    example: 42.5,
    nullable: true,
  })
  savedPercent!: number | null;

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
  completedAt!: Date;
}

/**
 * Top library by job count
 */
export class TopLibraryDto {
  @ApiProperty({
    description: 'Library unique identifier',
    example: 'clq8x9z8x0002qh8x9z8x0002',
  })
  id!: string;

  @ApiProperty({
    description: 'Library display name',
    example: 'Main Movie Collection',
  })
  name!: string;

  @ApiProperty({
    description: 'Library media type',
    example: 'MOVIE',
  })
  mediaType!: string;

  @ApiProperty({
    description: 'Library filesystem path',
    example: '/mnt/user/media/Movies',
  })
  path!: string;

  @ApiProperty({
    description: 'Total number of jobs for this library',
    example: 127,
    minimum: 0,
  })
  jobCount!: number;

  @ApiProperty({
    description: 'Number of completed jobs',
    example: 98,
    minimum: 0,
  })
  completedJobs!: number;

  @ApiProperty({
    description: 'Number of jobs currently encoding',
    example: 5,
    minimum: 0,
  })
  encodingJobs!: number;

  @ApiProperty({
    description: 'Total bytes saved across completed jobs',
    example: '15099494400000',
    type: 'string',
  })
  totalSavedBytes!: string;

  @ApiProperty({
    description: 'Total original size before encoding in bytes',
    example: '45099494400000',
    type: 'string',
  })
  totalBeforeBytes!: string;
}

/**
 * Complete overview statistics for the dashboard
 */
export class OverviewStatsDto {
  @ApiProperty({
    description: 'System health and node status information',
    type: SystemHealthDto,
  })
  systemHealth!: SystemHealthDto;

  @ApiProperty({
    description: 'Queue statistics aggregated by job stage',
    type: QueueStatsDto,
  })
  queueStats!: QueueStatsDto;

  @ApiProperty({
    description: 'Recent activity showing last 10 completed jobs',
    type: [RecentActivityDto],
    maxItems: 10,
  })
  recentActivity!: RecentActivityDto[];

  @ApiProperty({
    description: 'Top 5 libraries by total job count',
    type: [TopLibraryDto],
    maxItems: 5,
  })
  topLibraries!: TopLibraryDto[];

  @ApiProperty({
    description: 'Timestamp when these statistics were generated',
    example: '2025-09-30T21:45:32.123Z',
    format: 'date-time',
  })
  timestamp!: Date;
}
