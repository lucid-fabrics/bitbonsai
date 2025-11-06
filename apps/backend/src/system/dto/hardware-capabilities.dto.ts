import { ApiProperty } from '@nestjs/swagger';

/**
 * GPU vendor types
 */
export enum GPUVendor {
  NVIDIA = 'NVIDIA',
  INTEL = 'INTEL',
  AMD = 'AMD',
  APPLE = 'APPLE',
}

/**
 * Acceleration type priority:
 * NVIDIA > Intel QSV > AMD > Apple > CPU-only
 */
export enum AccelerationType {
  NVIDIA = 'NVIDIA',
  INTEL = 'INTEL',
  AMD = 'AMD',
  APPLE = 'APPLE',
  CPU = 'CPU',
}

/**
 * GPU information
 */
export class GPUInfo {
  @ApiProperty({
    description: 'GPU vendor',
    enum: GPUVendor,
    example: GPUVendor.NVIDIA,
  })
  vendor!: GPUVendor;

  @ApiProperty({
    description: 'GPU model name',
    example: 'GeForce RTX 4090',
  })
  model!: string;

  @ApiProperty({
    description: 'GPU memory in MB',
    example: 24576,
  })
  memory!: number;

  @ApiProperty({
    description: 'GPU driver version',
    example: '535.129.03',
  })
  driverVersion!: string;
}

/**
 * CPU information
 */
export class CPUInfo {
  @ApiProperty({
    description: 'CPU model name',
    example: 'Intel(R) Core(TM) i9-13900K',
  })
  model!: string;

  @ApiProperty({
    description: 'Number of CPU cores',
    example: 24,
  })
  cores!: number;

  @ApiProperty({
    description: 'CPU speed in MHz',
    example: 3000,
  })
  speed!: number;
}

/**
 * Memory information
 */
export class MemoryInfo {
  @ApiProperty({
    description: 'Total memory in MB',
    example: 65536,
  })
  total!: number;

  @ApiProperty({
    description: 'Free memory in MB',
    example: 32768,
  })
  free!: number;

  @ApiProperty({
    description: 'Used memory in MB',
    example: 32768,
  })
  used!: number;
}

/**
 * Complete hardware capabilities
 */
export class HardwareCapabilitiesDto {
  @ApiProperty({
    description: 'List of GPUs detected',
    type: [GPUInfo],
  })
  gpus!: GPUInfo[];

  @ApiProperty({
    description: 'CPU information',
    type: CPUInfo,
  })
  cpu!: CPUInfo;

  @ApiProperty({
    description: 'Memory information',
    type: MemoryInfo,
  })
  memory!: MemoryInfo;

  @ApiProperty({
    description: 'Operating system platform',
    example: 'linux',
  })
  platform!: string;

  @ApiProperty({
    description: 'Primary acceleration type',
    enum: AccelerationType,
    example: AccelerationType.NVIDIA,
  })
  accelerationType!: AccelerationType;
}
