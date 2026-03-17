import { ApiProperty } from '@nestjs/swagger';
import { JobStage } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * DTO for updating job progress
 * MULTI-NODE: Supports all fields that LINKED nodes need to proxy to MAIN
 */
export class UpdateJobDto {
  @ApiProperty({
    description: 'Current encoding progress (0.0 to 100.0)',
    example: 45.5,
    minimum: 0,
    maximum: 100,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiProperty({
    description: 'Estimated time to completion in seconds',
    example: 1800,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  etaSeconds?: number;

  @ApiProperty({
    description: 'Current encoding speed in frames per second',
    example: 45.2,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fps?: number;

  @ApiProperty({
    description: 'Current stage of the job',
    enum: JobStage,
    example: JobStage.ENCODING,
    enumName: 'JobStage',
    required: false,
  })
  @IsOptional()
  @IsEnum(JobStage)
  stage?: JobStage;

  // MULTI-NODE: Additional fields for job management
  @ApiProperty({
    description: 'Temporary file path for resume capability',
    example: '/path/to/.temp-file.mkv.tmp-jobid',
    required: false,
  })
  @IsOptional()
  @IsString()
  tempFilePath?: string | null;

  @ApiProperty({
    description: 'Resume timestamp in HH:MM:SS format',
    example: '00:15:30',
    required: false,
  })
  @IsOptional()
  @IsString()
  resumeTimestamp?: string | null;

  @ApiProperty({
    description: 'Error message if job failed',
    example: 'Encoding failed: insufficient disk space',
    required: false,
  })
  @IsOptional()
  @IsString()
  error?: string | null;

  @ApiProperty({
    description: 'Job start timestamp',
    example: new Date(),
    required: false,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startedAt?: Date | null;

  @ApiProperty({
    description: 'Auto-heal timestamp',
    example: new Date(),
    required: false,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  autoHealedAt?: Date | null;

  @ApiProperty({
    description: 'Progress when auto-healed',
    example: 45.5,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  autoHealedProgress?: number | null;

  @ApiProperty({
    description: 'Retry count',
    example: 2,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  retryCount?: number;

  @ApiProperty({
    description: 'Next retry timestamp',
    example: new Date(),
    required: false,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  nextRetryAt?: Date | null;

  @ApiProperty({
    description: 'Original backup path for Keep Original feature',
    example: '/path/to/file.mkv.original',
    required: false,
  })
  @IsOptional()
  @IsString()
  originalBackupPath?: string | null;

  @ApiProperty({
    description: 'Original file size in bytes',
    example: '12345678901',
    required: false,
  })
  @IsOptional()
  @IsString()
  originalSizeBytes?: bigint | null;

  @ApiProperty({
    description: 'Replacement action (REPLACED, KEPT_BOTH)',
    example: 'REPLACED',
    required: false,
  })
  @IsOptional()
  @IsString()
  replacementAction?: string | null;
}
