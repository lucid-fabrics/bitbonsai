import { ApiProperty } from '@nestjs/swagger';
import { HealthChecksDto } from './health-checks.dto';
import { NodeHealthDto } from './node-health.dto';
import { QueueHealthDto } from './queue-health.dto';

export class DetailedHealthDto {
  @ApiProperty({
    description: 'Overall health status',
    enum: ['ok', 'degraded', 'error'],
    example: 'ok',
  })
  status!: 'ok' | 'degraded' | 'error';

  @ApiProperty({
    description: 'Current timestamp',
    type: Date,
    example: '2025-10-01T12:00:00Z',
  })
  timestamp!: Date;

  @ApiProperty({
    description: 'Health check results for all services',
    type: HealthChecksDto,
  })
  checks!: HealthChecksDto;

  @ApiProperty({
    description: 'Node cluster health',
    type: NodeHealthDto,
  })
  nodes!: NodeHealthDto;

  @ApiProperty({
    description: 'Queue status',
    type: QueueHealthDto,
  })
  queue!: QueueHealthDto;
}
