import { ApiProperty } from '@nestjs/swagger';
import type { AccelerationType, NodeRole, NodeStatus } from '@prisma/client';

/**
 * Current Node Info DTO
 *
 * Returns information about the currently running node instance.
 * Used by the frontend to determine UI restrictions based on node role.
 */
export class CurrentNodeDto {
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
}
