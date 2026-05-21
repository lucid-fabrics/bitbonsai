import { ApiProperty } from '@nestjs/swagger';
import type { AccelerationType, ContainerType, RegistrationRequestStatus } from '@prisma/client';

/**
 * DTO for registration request response
 */
export class RegistrationRequestResponseDto {
  @ApiProperty({
    description: 'Registration request unique identifier (CUID)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  id!: string;

  @ApiProperty({
    description: 'Child node name',
    example: 'Encoding Server 2',
  })
  childNodeName!: string;

  @ApiProperty({
    description: 'Child node version',
    example: '1.0.0',
  })
  childVersion!: string;

  @ApiProperty({
    description: 'Child node IP address',
    example: '192.168.1.100',
  })
  ipAddress!: string;

  @ApiProperty({
    description: 'Child node hostname',
    example: 'encoder-02',
  })
  hostname!: string;

  @ApiProperty({
    description: 'Container type',
    enum: ['BARE_METAL', 'DOCKER', 'LXC', 'VM', 'UNKNOWN'],
    example: 'LXC',
  })
  containerType!: ContainerType;

  @ApiProperty({
    description: 'Hardware specifications',
    example: {
      cpuCores: 32,
      cpuModel: 'AMD Ryzen 9 5950X',
      ramGb: 64,
      diskGb: 2000,
      gpuModel: 'NVIDIA RTX 4090',
    },
  })
  hardwareSpecs!: {
    cpuCores: number;
    cpuModel: string;
    ramGb: number;
    diskGb: number;
    gpuModel: string | null;
  };

  @ApiProperty({
    description: 'Hardware acceleration type',
    enum: ['CPU', 'INTEL_QSV', 'NVIDIA', 'AMD', 'APPLE_M'],
    example: 'NVIDIA',
  })
  acceleration!: AccelerationType;

  @ApiProperty({
    description: '6-digit pairing token',
    example: '123456',
  })
  pairingToken!: string;

  @ApiProperty({
    description: 'Token expiration timestamp (24 hours)',
    example: '2025-11-07T20:10:08.000Z',
  })
  tokenExpiresAt!: Date;

  @ApiProperty({
    description: 'Request status',
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
    example: 'PENDING',
  })
  status!: RegistrationRequestStatus;

  @ApiProperty({
    description: 'When the request was created',
    example: '2025-11-06T20:10:08.000Z',
  })
  requestedAt!: Date;

  @ApiProperty({
    description: 'When the request was responded to (approved/rejected)',
    example: '2025-11-06T20:15:30.000Z',
    required: false,
  })
  respondedAt?: Date;

  @ApiProperty({
    description: 'Optional message from child node',
    example: 'This is my dedicated GPU encoding server',
    required: false,
  })
  message?: string;

  @ApiProperty({
    description: 'Rejection reason (if rejected)',
    example: 'Unauthorized device',
    required: false,
  })
  rejectionReason?: string;

  @ApiProperty({
    description: 'Created node ID (if approved)',
    example: 'clq8x9z8x0000qh8x9z8x0001',
    required: false,
  })
  childNodeId?: string;

  @ApiProperty({
    description: 'API key for child node authentication (only returned when approved)',
    example: 'bb_1234567890abcdef',
    required: false,
  })
  apiKey?: string;
}
