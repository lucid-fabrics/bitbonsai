import { ApiProperty } from '@nestjs/swagger';
import { JobStage } from '@prisma/client';

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

  // MULTI-NODE: Additional fields for job management
  @ApiProperty({
    description: 'Temporary file path for resume capability',
    example: '/path/to/.temp-file.mkv.tmp-jobid',
    required: false,
  })
  tempFilePath?: string | null;

  @ApiProperty({
    description: 'Resume timestamp in HH:MM:SS format',
    example: '00:15:30',
    required: false,
  })
  resumeTimestamp?: string | null;

  @ApiProperty({
    description: 'Error message if job failed',
    example: 'Encoding failed: insufficient disk space',
    required: false,
  })
  error?: string | null;

  @ApiProperty({
    description: 'Job start timestamp',
    example: new Date(),
    required: false,
  })
  startedAt?: Date | null;

  @ApiProperty({
    description: 'Auto-heal timestamp',
    example: new Date(),
    required: false,
  })
  autoHealedAt?: Date | null;

  @ApiProperty({
    description: 'Progress when auto-healed',
    example: 45.5,
    required: false,
  })
  autoHealedProgress?: number | null;

  @ApiProperty({
    description: 'Retry count',
    example: 2,
    required: false,
  })
  retryCount?: number;

  @ApiProperty({
    description: 'Next retry timestamp',
    example: new Date(),
    required: false,
  })
  nextRetryAt?: Date | null;

  @ApiProperty({
    description: 'Original backup path for Keep Original feature',
    example: '/path/to/file.mkv.original',
    required: false,
  })
  originalBackupPath?: string | null;

  @ApiProperty({
    description: 'Original file size in bytes',
    example: '12345678901',
    required: false,
  })
  originalSizeBytes?: bigint | null;

  @ApiProperty({
    description: 'Replacement action (REPLACED, KEPT_BOTH)',
    example: 'REPLACED',
    required: false,
  })
  replacementAction?: string | null;
}
