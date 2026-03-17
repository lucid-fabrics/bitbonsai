import { ApiProperty } from '@nestjs/swagger';
import type { AccelerationType, NodeRole, NodeStatus } from '@prisma/client';

/**
 * Safe Node Response DTO
 *
 * Returns node information without sensitive fields (apiKey, pairingToken).
 * Used for all endpoints except initial registration.
 */
export class NodeResponseDto {
  @ApiProperty({
    description: 'Node unique identifier',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  id!: string;

  @ApiProperty({
    description: 'Node display name',
    example: 'Main Encoding Node',
  })
  name!: string;

  @ApiProperty({
    description: 'Node role in cluster',
    enum: ['MAIN', 'LINKED'],
    example: 'MAIN',
  })
  role!: NodeRole;

  @ApiProperty({
    description: 'Current node status',
    enum: ['ONLINE', 'OFFLINE', 'ERROR'],
    example: 'ONLINE',
  })
  status!: NodeStatus;

  @ApiProperty({
    description: 'Node software version',
    example: '0.1.0',
  })
  version!: string;

  @ApiProperty({
    description: 'Hardware acceleration type',
    enum: ['CPU', 'INTEL_QSV', 'NVIDIA', 'AMD', 'APPLE_M'],
    example: 'NVIDIA',
  })
  acceleration!: AccelerationType;

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
    description: 'Timestamp when the node was last updated',
    example: '2025-10-01T12:34:56.789Z',
  })
  updatedAt!: Date;

  @ApiProperty({
    description: 'Maximum number of concurrent encoding jobs',
    example: 2,
    default: 1,
  })
  maxWorkers!: number;

  @ApiProperty({
    description: 'Maximum CPU usage percentage (1-100)',
    example: 80,
    default: 80,
  })
  cpuLimit!: number;

  // NOTE: apiKey and pairingToken are intentionally excluded for security
  // These fields are only returned during initial registration (NodeRegistrationResponseDto)
}
