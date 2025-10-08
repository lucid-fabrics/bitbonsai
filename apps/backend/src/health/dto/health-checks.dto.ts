import { ApiProperty } from '@nestjs/swagger';
import { DiskHealthDto } from './disk-health.dto';
import { MemoryHealthDto } from './memory-health.dto';
import { ServiceHealthDto } from './service-health.dto';

export class HealthChecksDto {
  @ApiProperty({
    description: 'Database health status',
    type: ServiceHealthDto,
  })
  database!: ServiceHealthDto;

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
  disk!: DiskHealthDto;

  @ApiProperty({
    description: 'Memory health status',
    type: MemoryHealthDto,
  })
  memory!: MemoryHealthDto;

  @ApiProperty({
    description: 'FFmpeg availability status',
    type: ServiceHealthDto,
  })
  ffmpeg!: ServiceHealthDto;
}
