import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for a single node's performance metrics
 */
export class NodeMetricsDto {
  @ApiProperty({
    description: 'Node unique identifier',
    example: 'clq8x9z8x0002qh8x9z8x0002',
  })
  nodeId!: string;

  @ApiProperty({
    description: 'Node display name',
    example: 'Main Encoding Server',
  })
  nodeName!: string;

  @ApiProperty({
    description: 'Node acceleration type',
    example: 'NVIDIA',
    enum: ['CPU', 'INTEL_QSV', 'NVIDIA', 'AMD', 'APPLE_M'],
  })
  acceleration!: string;

  @ApiProperty({
    description: 'Total jobs completed by this node',
    example: 523,
    minimum: 0,
  })
  jobsCompleted!: number;

  @ApiProperty({
    description: 'Total jobs failed on this node',
    example: 7,
    minimum: 0,
  })
  jobsFailed!: number;

  @ApiProperty({
    description: 'Success rate as a percentage',
    example: 98.7,
    minimum: 0,
    maximum: 100,
  })
  successRate!: number;

  @ApiProperty({
    description: 'Total bytes saved by this node (as string for BigInt support)',
    example: '268435456000',
    format: 'int64',
  })
  totalSavedBytes!: string;

  @ApiProperty({
    description: 'Total bytes saved in gigabytes',
    example: 250.0,
    minimum: 0,
  })
  totalSavedGB!: number;

  @ApiProperty({
    description: 'Average throughput in files per hour',
    example: 15.3,
    minimum: 0,
  })
  avgThroughput!: number;

  @ApiProperty({
    description: 'Current node status',
    example: 'ONLINE',
    enum: ['ONLINE', 'OFFLINE', 'ERROR'],
  })
  status!: string;
}

/**
 * Response DTO for node comparison endpoint
 */
export class NodeComparisonDto {
  @ApiProperty({
    description: 'Array of node performance metrics',
    type: [NodeMetricsDto],
  })
  nodes!: NodeMetricsDto[];

  @ApiProperty({
    description: 'Timestamp when comparison was calculated',
    example: '2024-09-30T21:45:32.123Z',
    format: 'date-time',
  })
  timestamp!: string;
}
