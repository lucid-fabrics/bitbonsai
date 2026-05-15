import { ApiProperty } from '@nestjs/swagger';
import type { AccelerationType, NodeRole, NodeStatus } from '@prisma/client';

/**
 * DTO for successful node registration response
 */
export class NodeRegistrationResponseDto {
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
    description: 'Role assigned to the node (MAIN for first node, LINKED for additional)',
    enum: ['MAIN', 'LINKED'],
    example: 'MAIN',
  })
  role!: NodeRole;

  @ApiProperty({
    description: 'Current operational status',
    enum: ['ONLINE', 'OFFLINE', 'ERROR'],
    example: 'ONLINE',
  })
  status!: NodeStatus;

  @ApiProperty({
    description: 'BitBonsai version',
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
    description: 'API key for authenticating this node (SAVE THIS - only shown once)',
    example: 'bb_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2',
  })
  apiKey!: string;

  @ApiProperty({
    description: '6-digit pairing token for completing registration (expires in 10 minutes)',
    example: '123456',
  })
  pairingToken!: string;

  @ApiProperty({
    description: 'Timestamp when pairing token expires',
    example: '2025-10-01T12:44:56.789Z',
  })
  pairingExpiresAt!: Date;

  @ApiProperty({
    description: 'Timestamp when node was created',
    example: '2025-10-01T12:34:56.789Z',
  })
  createdAt!: Date;
}
