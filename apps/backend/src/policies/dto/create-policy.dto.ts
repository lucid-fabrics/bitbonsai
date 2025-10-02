import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  PolicyPreset,
  TargetCodec,
  DeviceProfiles,
  AdvancedSettings,
} from '@bitbonsai/shared-models';

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
