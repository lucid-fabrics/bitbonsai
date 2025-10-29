import { ApiProperty } from '@nestjs/swagger';
import { JobStage } from '@prisma/client';

/**
 * DTO for updating job progress
 */
export class UpdateJobDto {
  @ApiProperty({
    description: 'Current encoding progress (0.0 to 100.0)',
    example: 45.5,
    minimum: 0,
    maximum: 100,
    required: false,
  })
  progress?: number;

  @ApiProperty({
    description: 'Estimated time to completion in seconds',
    example: 1800,
    required: false,
  })
  etaSeconds?: number;

  @ApiProperty({
    description: 'Current encoding speed in frames per second',
    example: 45.2,
    required: false,
  })
  fps?: number;

  @ApiProperty({
    description: 'Current stage of the job',
    enum: JobStage,
    example: JobStage.ENCODING,
    enumName: 'JobStage',
    required: false,
  })
  stage?: JobStage;
}
