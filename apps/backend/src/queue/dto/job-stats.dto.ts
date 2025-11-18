import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for job queue statistics
 */
export class JobStatsDto {
  @ApiProperty({
    description: 'Number of detected jobs awaiting health check',
    example: 15,
  })
  detected!: number;

  @ApiProperty({
    description: 'Number of jobs currently being health checked',
    example: 5,
  })
  healthCheck!: number;

  @ApiProperty({
    description: 'Number of queued jobs waiting to be processed',
    example: 42,
  })
  queued!: number;

  @ApiProperty({
    description: 'Number of jobs being transferred to nodes',
    example: 2,
  })
  transferring!: number;

  @ApiProperty({
    description: 'Number of currently encoding jobs',
    example: 3,
  })
  encoding!: number;

  @ApiProperty({
    description: 'Number of jobs being verified after encoding',
    example: 2,
  })
  verifying!: number;

  @ApiProperty({
    description: 'Number of completed jobs',
    example: 150,
  })
  completed!: number;

  @ApiProperty({
    description: 'Number of failed jobs',
    example: 5,
  })
  failed!: number;

  @ApiProperty({
    description: 'Number of cancelled jobs',
    example: 12,
  })
  cancelled!: number;

  @ApiProperty({
    description: 'Total bytes saved across all completed jobs',
    example: '536870912000',
    type: 'string',
  })
  totalSavedBytes!: string;

  @ApiProperty({
    description: 'Optional node ID if statistics are filtered by node',
    example: 'clq8x9z8x0000qh8x9z8x0000',
    required: false,
  })
  nodeId?: string;
}
