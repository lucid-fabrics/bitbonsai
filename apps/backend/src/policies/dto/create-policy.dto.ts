import { PolicyPreset, TargetCodec } from '@prisma/client';

// Re-export for test files
export { PolicyPreset, TargetCodec };

// Type definitions
export type DeviceProfiles = {
  appleTv: boolean;
  roku: boolean;
  web: boolean;
  chromecast: boolean;
  ps5: boolean;
  xbox: boolean;
};

export type AdvancedSettings = {
  ffmpegFlags: string[];
  hwaccel: string;
  audioCodec: string;
  subtitleHandling: string;
};

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreatePolicyDto {
  @ApiProperty({
    description: 'Descriptive name for the encoding policy',
    example: 'Standard Quality HEVC',
    minLength: 1,
    maxLength: 100,
  })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'Preset configuration template for common encoding scenarios',
    enum: PolicyPreset,
    example: PolicyPreset.BALANCED_HEVC,
  })
  @IsEnum(PolicyPreset)
  preset!: PolicyPreset;

  @ApiProperty({
    description: 'Target video codec for transcoding',
    enum: TargetCodec,
    example: TargetCodec.HEVC,
  })
  @IsEnum(TargetCodec)
  targetCodec!: TargetCodec;

  @ApiProperty({
    description:
      'CRF (Constant Rate Factor) quality value. Lower = better quality, higher file size. Range: 0-51',
    example: 23,
    minimum: 0,
    maximum: 51,
  })
  @IsInt()
  @Min(0)
  @Max(51)
  targetQuality!: number;

  @ApiPropertyOptional({
    description:
      'Target container format for encoded files. Supported formats: mkv (universal compatibility, Matroska), mp4 (streaming-optimized, MPEG-4), webm (web-optimized, WebM), or null to keep the original container format unchanged.',
    example: 'mkv',
    enum: ['mkv', 'mp4', 'webm', null],
    default: 'mkv',
    nullable: true,
  })
  @IsOptional()
  @IsIn(['mkv', 'mp4', 'webm', null], {
    message: 'Container format must be one of: mkv, mp4, webm, or null (keep original)',
  })
  targetContainer?: string | null;

  @ApiPropertyOptional({
    description:
      'Enable smart remux mode: Skip re-encoding when source codec matches target codec. When enabled, files already in the target codec will only have their container changed (fast remux) instead of being fully re-encoded (slow transcode). This saves significant time and preserves original quality. Example: H.264 → H.264 with container change MP4 → MKV takes seconds instead of hours.',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  skipReencoding?: boolean;

  @ApiPropertyOptional({
    description:
      'Allow encoding when source and target codec are the same without requiring user confirmation. When enabled, jobs will proceed directly to encoding instead of pausing at NEEDS_DECISION. Useful for re-compression scenarios where you want to reduce file size even if already in target codec.',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allowSameCodec?: boolean;

  @ApiPropertyOptional({
    description:
      'Minimum expected savings percentage required to proceed with same-codec encoding. Only applies when allowSameCodec is enabled. Jobs with expected savings below this threshold will be skipped. Range: 0-100 (0 = no threshold).',
    example: 10,
    default: 0,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minSavingsPercent?: number;

  @ApiPropertyOptional({
    description: 'Optional library ID to associate this policy with a specific media library',
    example: 'clxxxx123456789',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  libraryId?: string | null;

  @ApiPropertyOptional({
    description: 'Device compatibility profile settings',
    example: {
      appleTv: true,
      roku: true,
      web: true,
      chromecast: true,
      ps5: true,
      xbox: true,
    },
  })
  @IsOptional()
  @IsObject()
  deviceProfiles?: DeviceProfiles;

  @ApiPropertyOptional({
    description: 'Advanced FFmpeg settings for fine-tuned control',
    example: {
      ffmpegFlags: ['-preset', 'medium'],
      hwaccel: 'auto',
      audioCodec: 'copy',
      subtitleHandling: 'copy',
    },
  })
  @IsOptional()
  @IsObject()
  advancedSettings?: AdvancedSettings;

  @ApiPropertyOptional({
    description: 'Replace original file atomically using rename operation',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  atomicReplace?: boolean;

  @ApiPropertyOptional({
    description: 'Verify output file playability after encoding',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  verifyOutput?: boolean;

  @ApiPropertyOptional({
    description: 'Skip files currently seeding in torrent clients',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  skipSeeding?: boolean;
}
