import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * DTO for creating a new encoding job
 */
export class CreateJobDto {
  @ApiProperty({
    description: 'Full path to the media file to be encoded',
    example: '/mnt/user/media/Movies/Avatar (2009)/Avatar.mkv',
  })
  @IsNotEmpty()
  @IsString()
  filePath!: string;

  @ApiProperty({
    description: 'User-friendly file label for display in UI',
    example: 'Avatar (2009).mkv',
  })
  @IsNotEmpty()
  @IsString()
  fileLabel!: string;

  @ApiProperty({
    description: 'Current codec of the source file',
    example: 'H.264',
  })
  @IsNotEmpty()
  @IsString()
  sourceCodec!: string;

  @ApiProperty({
    description: 'Target codec for encoding',
    example: 'HEVC',
  })
  @IsNotEmpty()
  @IsString()
  targetCodec!: string;

  @ApiProperty({
    description: 'Original file size in bytes',
    example: 10737418240,
    type: 'string',
  })
  @IsNotEmpty()
  @IsString()
  beforeSizeBytes!: string;

  @ApiProperty({
    description: 'ID of the node that will process this job',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @IsNotEmpty()
  @IsString()
  nodeId!: string;

  @ApiProperty({
    description: 'ID of the library this file belongs to',
    example: 'clq8x9z8x0002qh8x9z8x0002',
  })
  @IsNotEmpty()
  @IsString()
  libraryId!: string;

  @ApiProperty({
    description: 'ID of the encoding policy to apply',
    example: 'clq8x9z8x0004qh8x9z8x0004',
  })
  @IsNotEmpty()
  @IsString()
  policyId!: string;

  @ApiPropertyOptional({
    description: 'User-facing warning message for this job',
    example: 'AV1 encoding will take significantly longer than other codecs',
  })
  @IsOptional()
  @IsString()
  warning?: string;

  @ApiPropertyOptional({
    description: 'Whether this job has resource throttling enabled',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  resourceThrottled?: boolean;

  @ApiPropertyOptional({
    description: 'Reason why resources were throttled',
    example: 'AV1 source codec requires reduced CPU usage',
  })
  @IsOptional()
  @IsString()
  resourceThrottleReason?: string;

  @ApiPropertyOptional({
    description: 'Number of FFmpeg threads to use for this job',
    example: 8,
  })
  @IsOptional()
  @IsInt()
  ffmpegThreads?: number;

  @ApiPropertyOptional({
    description: 'Job type: ENCODE (full transcode) or REMUX (container change only)',
    example: 'ENCODE',
    enum: ['ENCODE', 'REMUX'],
  })
  @IsOptional()
  @IsString()
  type?: 'ENCODE' | 'REMUX';

  @ApiPropertyOptional({
    description: 'Source container format (e.g., mkv, mp4, avi)',
    example: 'mkv',
  })
  @IsOptional()
  @IsString()
  sourceContainer?: string;

  @ApiPropertyOptional({
    description: 'Target container format (e.g., mkv, mp4)',
    example: 'mp4',
  })
  @IsOptional()
  @IsString()
  targetContainer?: string;
}
