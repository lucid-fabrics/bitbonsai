import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * EncodingResultDto
 *
 * Final encoding result including quality metrics.
 * Used when a job completes successfully to update job data.
 */
export class EncodingResultDto {
  @ApiProperty({
    description: 'Size of encoded file in bytes',
    example: '5368709120',
  })
  @IsString()
  afterSizeBytes!: string;

  @ApiProperty({
    description: 'Bytes saved compared to original (can be negative)',
    example: '2684354560',
  })
  @IsString()
  savedBytes!: string;

  @ApiProperty({
    description: 'Percentage of space saved',
    example: 50.0,
  })
  @IsNumber()
  @Min(0)
  savedPercent!: number;

  @ApiProperty({
    description: 'Quality metrics JSON string (VMAF, PSNR, SSIM)',
    example: '{"vmaf":92.5,"psnr":38.2,"ssim":0.97,"calculatedAt":"2026-03-29T06:00:00Z"}',
    required: false,
  })
  @IsOptional()
  @IsString()
  qualityMetrics?: string;
}

/**
 * Quality Metrics Input Dto
 *
 * Input for quality metrics calculation (optional, used internally)
 */
export class QualityMetricsInputDto {
  @ApiProperty({
    description: 'VMAF score (0-100)',
    example: 92.5,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  vmaf?: number;

  @ApiProperty({
    description: 'PSNR score in dB',
    example: 38.2,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  psnr?: number;

  @ApiProperty({
    description: 'SSIM score (0-1)',
    example: 0.97,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  ssim?: number;

  @ApiProperty({
    description: 'When metrics were calculated',
    example: '2026-03-29T06:00:00Z',
  })
  @Type(() => Date)
  @IsNumber()
  calculatedAt!: Date;
}

/**
 * Quality Validation Result Dto
 *
 * Result of quality validation check
 */
export class QualityValidationResultDto {
  @ApiProperty({
    description: 'Whether quality passed validation',
    example: true,
  })
  @IsBoolean()
  passed!: boolean;

  @ApiProperty({
    description: 'VMAF score (if available)',
    example: 92.5,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  vmaf?: number;

  @ApiProperty({
    description: 'Threshold that was used',
    example: 85,
  })
  @IsNumber()
  threshold!: number;

  @ApiProperty({
    description: 'Quality label (Excellent/Good/Fair/Poor)',
    example: 'Excellent',
  })
  @IsString()
  qualityLabel!: string;

  @ApiProperty({
    description: 'Whether re-encode was triggered due to low quality',
    example: false,
  })
  @IsBoolean()
  reencodeTriggered!: boolean;
}
