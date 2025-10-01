import { ApiProperty } from '@nestjs/swagger';

export class BasicHealthDto {
  @ApiProperty({
    description: 'Overall health status',
    enum: ['ok', 'error'],
    example: 'ok',
  })
  status: 'ok' | 'error';

  @ApiProperty({
    description: 'Current timestamp',
    type: Date,
    example: '2025-10-01T12:00:00Z',
  })
  timestamp: Date;

  @ApiProperty({
    description: 'Application uptime in seconds',
    type: Number,
    example: 3600,
  })
  uptime: number;

  @ApiProperty({
    description: 'Application version',
    type: String,
    example: '0.1.0',
  })
  version: string;
}

export class ServiceHealthDto {
  @ApiProperty({
    description: 'Service health status',
    enum: ['ok', 'error', 'unavailable'],
    example: 'ok',
  })
  status: 'ok' | 'error' | 'unavailable';

  @ApiProperty({
    description: 'Response time in milliseconds',
    type: Number,
    example: 15,
    required: false,
  })
  responseTime?: number;

  @ApiProperty({
    description: 'Error message if service is unavailable',
    type: String,
    required: false,
    example: 'Connection refused',
  })
  error?: string;

  @ApiProperty({
    description: 'Additional service-specific information',
    type: String,
    required: false,
    example: '5.1.2',
  })
  version?: string;
}

export class DiskHealthDto {
  @ApiProperty({
    description: 'Disk health status',
    enum: ['ok', 'warning', 'critical'],
    example: 'ok',
  })
  status: 'ok' | 'warning' | 'critical';

  @ApiProperty({
    description: 'Percentage of disk space used',
    type: String,
    example: '50%',
  })
  used: string;

  @ApiProperty({
    description: 'Available disk space',
    type: String,
    example: '500GB',
  })
  available: string;
}

export class MemoryHealthDto {
  @ApiProperty({
    description: 'Memory health status',
    enum: ['ok', 'warning', 'critical'],
    example: 'ok',
  })
  status: 'ok' | 'warning' | 'critical';

  @ApiProperty({
    description: 'Used memory',
    type: String,
    example: '2GB',
  })
  used: string;

  @ApiProperty({
    description: 'Total memory',
    type: String,
    example: '16GB',
  })
  total: string;

  @ApiProperty({
    description: 'Memory usage percentage',
    type: Number,
    example: 12.5,
  })
  percentage: number;
}

export class NodeHealthDto {
  @ApiProperty({
    description: 'Total number of nodes',
    type: Number,
    example: 2,
  })
  total: number;

  @ApiProperty({
    description: 'Number of online nodes',
    type: Number,
    example: 2,
  })
  online: number;

  @ApiProperty({
    description: 'Number of offline nodes',
    type: Number,
    example: 0,
  })
  offline: number;
}

export class QueueHealthDto {
  @ApiProperty({
    description: 'Number of queued tasks',
    type: Number,
    example: 5,
  })
  queued: number;

  @ApiProperty({
    description: 'Number of actively encoding tasks',
    type: Number,
    example: 2,
  })
  encoding: number;

  @ApiProperty({
    description: 'Number of completed tasks',
    type: Number,
    example: 150,
  })
  completed: number;

  @ApiProperty({
    description: 'Number of failed tasks',
    type: Number,
    example: 3,
  })
  failed: number;
}

export class HealthChecksDto {
  @ApiProperty({
    description: 'Database health status',
    type: ServiceHealthDto,
  })
  database: ServiceHealthDto;

  @ApiProperty({
    description: 'Redis health status',
    type: ServiceHealthDto,
    required: false,
  })
  redis?: ServiceHealthDto;

  @ApiProperty({
    description: 'Disk health status',
    type: DiskHealthDto,
  })
  disk: DiskHealthDto;

  @ApiProperty({
    description: 'Memory health status',
    type: MemoryHealthDto,
  })
  memory: MemoryHealthDto;

  @ApiProperty({
    description: 'FFmpeg availability status',
    type: ServiceHealthDto,
  })
  ffmpeg: ServiceHealthDto;
}

export class DetailedHealthDto {
  @ApiProperty({
    description: 'Overall health status',
    enum: ['ok', 'degraded', 'error'],
    example: 'ok',
  })
  status: 'ok' | 'degraded' | 'error';

  @ApiProperty({
    description: 'Current timestamp',
    type: Date,
    example: '2025-10-01T12:00:00Z',
  })
  timestamp: Date;

  @ApiProperty({
    description: 'Health check results for all services',
    type: HealthChecksDto,
  })
  checks: HealthChecksDto;

  @ApiProperty({
    description: 'Node cluster health',
    type: NodeHealthDto,
  })
  nodes: NodeHealthDto;

  @ApiProperty({
    description: 'Queue status',
    type: QueueHealthDto,
  })
  queue: QueueHealthDto;
}

export class ReadinessDto {
  @ApiProperty({
    description: 'Whether the application is ready to accept requests',
    type: Boolean,
    example: true,
  })
  ready: boolean;

  @ApiProperty({
    description: 'Reason if not ready',
    type: String,
    required: false,
    example: 'Database connection failed',
  })
  reason?: string;
}

export class LivenessDto {
  @ApiProperty({
    description: 'Whether the application is alive',
    type: Boolean,
    example: true,
  })
  alive: boolean;
}
