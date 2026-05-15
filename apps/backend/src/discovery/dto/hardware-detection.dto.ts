import { ApiProperty } from '@nestjs/swagger';
import { AccelerationType } from '@prisma/client';

/**
 * HardwareDetectionDto
 *
 * Hardware capabilities detected on the current node.
 * Used by the node setup wizard to display hardware information
 * after successful pairing.
 */
export class HardwareDetectionDto {
  @ApiProperty({
    description: 'Acceleration type (NVIDIA, Intel QSV, AMD, Apple M-Series, or CPU)',
    enum: AccelerationType,
    example: AccelerationType.NVIDIA,
  })
  acceleration!: AccelerationType;

  @ApiProperty({
    description: 'Number of CPU cores',
    example: 16,
  })
  cpuCores!: number;

  @ApiProperty({
    description: 'Total memory in GB',
    example: 32,
  })
  totalMemoryGB!: number;

  @ApiProperty({
    description: 'Available disk space in GB',
    example: 512,
  })
  availableDiskGB!: number;

  @ApiProperty({
    description: 'Operating system platform',
    example: 'linux',
  })
  platform!: string;

  @ApiProperty({
    description: 'Node.js version',
    example: 'v20.10.0',
  })
  nodeVersion!: string;
}
