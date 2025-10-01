import { ApiProperty } from '@nestjs/swagger';

export class HardwareAccelerationDto {
  @ApiProperty({
    description: 'Whether NVIDIA GPU acceleration is available',
    example: true,
  })
  nvidia: boolean;

  @ApiProperty({
    description: 'Whether Intel Quick Sync Video is available',
    example: false,
  })
  intelQsv: boolean;

  @ApiProperty({
    description: 'Whether AMD GPU acceleration is available',
    example: false,
  })
  amd: boolean;

  @ApiProperty({
    description: 'Whether Apple VideoToolbox (Apple Silicon) is available',
    example: false,
  })
  appleVideoToolbox: boolean;
}

export class SystemInfoDto {
  @ApiProperty({
    description: 'Number of CPU cores available',
    example: 8,
  })
  cpuCores: number;

  @ApiProperty({
    description: 'CPU architecture',
    example: 'x64',
  })
  architecture: string;

  @ApiProperty({
    description: 'Operating system platform',
    example: 'linux',
  })
  platform: string;

  @ApiProperty({
    description: 'Total system memory in GB',
    example: 16,
  })
  totalMemoryGb: number;

  @ApiProperty({
    description: 'Container runtime if running in Docker',
    example: 'docker',
    required: false,
  })
  containerRuntime?: string;

  @ApiProperty({
    description: 'Unraid version if running on Unraid',
    example: '6.12.4',
    required: false,
  })
  unraidVersion?: string;
}

export class DefaultPathsDto {
  @ApiProperty({
    description: 'Default path for media library storage',
    example: '/mnt/user/media',
  })
  mediaPath: string;

  @ApiProperty({
    description: 'Default path for download directory',
    example: '/mnt/user/Downloads',
  })
  downloadsPath: string;

  @ApiProperty({
    description: 'Default path for application config and data',
    example: '/mnt/user/appdata/bitbonsai',
  })
  configPath: string;
}

export class EnvironmentInfoDto {
  @ApiProperty({
    description: 'Detected environment type',
    enum: ['UNRAID', 'DOCKER', 'BARE_METAL'],
    example: 'UNRAID',
  })
  environment: 'UNRAID' | 'DOCKER' | 'BARE_METAL';

  @ApiProperty({
    description: 'Whether running on Unraid OS',
    example: true,
  })
  isUnraid: boolean;

  @ApiProperty({
    description: 'Whether running in Docker container',
    example: true,
  })
  isDocker: boolean;

  @ApiProperty({
    description: 'Available hardware acceleration options',
    type: HardwareAccelerationDto,
  })
  hardwareAcceleration: HardwareAccelerationDto;

  @ApiProperty({
    description: 'Environment-specific default paths',
    type: DefaultPathsDto,
  })
  defaultPaths: DefaultPathsDto;

  @ApiProperty({
    description: 'System information',
    type: SystemInfoDto,
  })
  systemInfo: SystemInfoDto;

  @ApiProperty({
    description: 'Link to environment-specific documentation',
    example: 'https://docs.bitbonsai.com/setup/unraid',
  })
  docsLink: string;

  @ApiProperty({
    description: 'Environment-specific setup recommendations',
    example: [
      'GPU passthrough detected - hardware acceleration available',
      'Use /mnt/user paths for Unraid array storage',
    ],
    type: [String],
  })
  recommendations: string[];
}
