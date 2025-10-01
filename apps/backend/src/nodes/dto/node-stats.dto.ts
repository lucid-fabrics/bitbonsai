import { ApiProperty } from '@nestjs/swagger';
import type { AccelerationType, License, Library, NodeRole, NodeStatus } from '@prisma/client';

/**
 * DTO for node statistics with related data
 */
export class NodeStatsDto {
  @ApiProperty({
    description: 'Node unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  id!: string;

  @ApiProperty({
    description: 'Display name of the node',
    example: 'Main Encoding Server',
  })
  name!: string;

  @ApiProperty({
    description: 'Role of the node in the cluster',
    enum: ['MAIN', 'LINKED'],
    example: 'MAIN',
  })
  role!: NodeRole;

  @ApiProperty({
    description: 'Current operational status of the node',
    enum: ['ONLINE', 'OFFLINE', 'MAINTENANCE'],
    example: 'ONLINE',
  })
  status!: NodeStatus;

  @ApiProperty({
    description: 'BitBonsai version running on this node',
    example: '1.0.0',
  })
  version!: string;

  @ApiProperty({
    description: 'Hardware acceleration type',
    enum: ['NONE', 'NVIDIA', 'INTEL', 'AMD', 'APPLE'],
    example: 'NVIDIA',
  })
  acceleration!: AccelerationType;

  @ApiProperty({
    description: 'API key for node authentication (only shown once during registration)',
    example: 'bb_a1b2c3d4e5f6...',
    required: false,
  })
  apiKey?: string;

  @ApiProperty({
    description: 'Timestamp of last heartbeat received from the node',
    example: '2025-10-01T12:34:56.789Z',
  })
  lastHeartbeat!: Date;

  @ApiProperty({
    description: 'Total uptime in seconds since node registration',
    example: 86400,
  })
  uptimeSeconds!: number;

  @ApiProperty({
    description: 'Timestamp when the node was registered',
    example: '2025-10-01T00:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Associated license information',
    type: 'object',
    required: false,
  })
  license?: Partial<License>;

  @ApiProperty({
    description: 'List of libraries managed by this node',
    type: 'array',
    required: false,
  })
  libraries?: Partial<Library>[];

  @ApiProperty({
    description: 'Count of active jobs (QUEUED, ENCODING, VERIFYING)',
    example: 5,
    required: false,
  })
  activeJobCount?: number;
}
