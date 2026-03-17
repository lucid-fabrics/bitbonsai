import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for optimal node configuration recommendations
 */
export class OptimalConfigDto {
  @ApiProperty({
    description: 'Recommended maximum number of concurrent workers',
    example: 4,
  })
  recommendedMaxWorkers!: number;

  @ApiProperty({
    description: 'Current configured maximum workers',
    example: 10,
  })
  currentMaxWorkers!: number;

  @ApiProperty({
    description: 'CPU cores allocated per job with recommended settings',
    example: 8,
  })
  cpuCoresPerJob!: number;

  @ApiProperty({
    description: 'Estimated system load average with recommended settings',
    example: 32,
  })
  estimatedLoadAverage!: number;

  @ApiProperty({
    description: 'Detailed reasoning for the recommendation',
    example:
      'High-core CPU system (32 cores). Allocating 8 cores per job for optimal AV1→HEVC transcoding performance.',
  })
  reasoning!: string;

  @ApiProperty({
    description: 'Summary of recommendation with action advice',
    example: '⚠️ Consider reducing from 10 → 4 workers to prevent CPU overload and job failures',
  })
  summary!: string;

  @ApiProperty({
    description: 'Total CPU cores on this node',
    example: 32,
  })
  totalCpuCores!: number;

  @ApiProperty({
    description: 'Hardware acceleration type',
    example: 'CPU',
  })
  acceleration!: string;
}
