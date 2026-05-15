import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for aggregated statistics across all jobs and nodes
 */
export class InsightsStatsDto {
  @ApiProperty({
    description: 'Total number of successfully completed encoding jobs',
    example: 1247,
    minimum: 0,
  })
  totalJobsCompleted!: number;

  @ApiProperty({
    description: 'Total number of failed encoding jobs',
    example: 23,
    minimum: 0,
  })
  totalJobsFailed!: number;

  @ApiProperty({
    description: 'Total bytes saved across all completed jobs (as string for BigInt support)',
    example: '524288000000',
    format: 'int64',
  })
  totalSavedBytes!: string;

  @ApiProperty({
    description: 'Total bytes saved in human-readable format (GB)',
    example: 488.28,
    minimum: 0,
  })
  totalSavedGB!: number;

  @ApiProperty({
    description: 'Average throughput across all nodes in files per hour',
    example: 12.5,
    minimum: 0,
  })
  avgThroughput!: number;

  @ApiProperty({
    description: 'Success rate as a percentage',
    example: 98.2,
    minimum: 0,
    maximum: 100,
  })
  successRate!: number;

  @ApiProperty({
    description: 'Timestamp when these statistics were calculated',
    example: '2024-09-30T21:45:32.123Z',
    format: 'date-time',
  })
  timestamp!: string;
}
