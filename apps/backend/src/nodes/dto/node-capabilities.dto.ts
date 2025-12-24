import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO for node capabilities
 */
export class NodeCapabilitiesDto {
  @ApiProperty({
    description: 'Hardware acceleration support',
    example: {
      nvidia: true,
      vaapi: false,
      qsv: false,
    },
  })
  hwaccel!: {
    nvidia: boolean;
    vaapi: boolean;
    qsv: boolean;
  };

  @ApiProperty({
    description: 'FFmpeg capabilities',
    example: {
      version: '5.1.2',
      codecs: ['hevc', 'h264', 'av1'],
    },
  })
  ffmpeg!: {
    version: string;
    codecs: string[];
  };

  @ApiProperty({
    description: 'System resources',
    example: {
      cpuCores: 8,
      totalMemoryGB: 16,
    },
  })
  resources!: {
    cpuCores: number;
    totalMemoryGB: number;
  };
}
