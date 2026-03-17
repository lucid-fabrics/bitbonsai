import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * DTO for approving a registration request
 */
export class ApproveRequestDto {
  @ApiProperty({
    description: 'Number of concurrent encoding jobs (1-12)',
    example: 4,
    minimum: 1,
    maximum: 12,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  maxWorkers?: number;

  @ApiProperty({
    description: 'Maximum CPU usage percentage (10-100)',
    example: 80,
    minimum: 10,
    maximum: 100,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(100)
  cpuLimit?: number;
}
