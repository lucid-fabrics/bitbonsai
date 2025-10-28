import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/**
 * DTO for updating node configuration
 */
export class UpdateNodeDto {
  @ApiProperty({
    description: 'Display name for the node',
    example: 'Main Encoding Server',
    minLength: 1,
    maxLength: 255,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Node name must be a string' })
  @Length(1, 255, { message: 'Node name must be between 1 and 255 characters' })
  name?: string;

  @ApiProperty({
    description: 'Maximum number of concurrent encoding jobs',
    example: 2,
    minimum: 1,
    maximum: 10,
    default: 1,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'maxWorkers must be an integer' })
  @Min(1, { message: 'maxWorkers must be at least 1' })
  @Max(10, { message: 'maxWorkers cannot exceed 10' })
  maxWorkers?: number;

  @ApiProperty({
    description: 'Maximum CPU usage percentage (reserves resources for host system)',
    example: 80,
    minimum: 10,
    maximum: 100,
    default: 80,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'cpuLimit must be an integer' })
  @Min(10, { message: 'cpuLimit must be at least 10%' })
  @Max(100, { message: 'cpuLimit cannot exceed 100%' })
  cpuLimit?: number;
}
