import { ApiProperty } from '@nestjs/swagger';
import { PolicyPreset, TargetCodec } from '@prisma/client';
import { IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString } from 'class-validator';

export class PolicySyncDto {
  @ApiProperty({
    description: 'Policy ID',
    example: 'clx123abc456',
  })
  @IsString()
  id!: string;

  @ApiProperty({
    description: 'Policy name',
    example: 'High Quality HEVC',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'Policy preset type',
    enum: PolicyPreset,
    example: PolicyPreset.BALANCED_HEVC,
  })
  @IsEnum(PolicyPreset)
  preset!: PolicyPreset;

  @ApiProperty({
    description: 'Target codec',
    enum: TargetCodec,
    example: TargetCodec.HEVC,
  })
  @IsEnum(TargetCodec)
  targetCodec!: TargetCodec;

  @ApiProperty({
    description: 'CRF quality value (0-51, lower = better)',
    example: 23,
  })
  @IsInt()
  targetQuality!: number;

  @ApiProperty({
    description: 'Device compatibility profiles',
    example: {
      appleTv: true,
      roku: true,
      web: true,
      chromecast: true,
      ps5: true,
      xbox: true,
    },
  })
  @IsObject()
  deviceProfiles!: object;

  @ApiProperty({
    description: 'Advanced FFmpeg settings',
    example: {
      ffmpegFlags: ['-preset', 'medium'],
      hwaccel: 'auto',
      audioCodec: 'copy',
      subtitleHandling: 'copy',
    },
  })
  @IsObject()
  advancedSettings!: object;

  @ApiProperty({
    description: 'Atomically replace original file',
    example: true,
  })
  @IsBoolean()
  atomicReplace!: boolean;

  @ApiProperty({
    description: 'Verify output file playability',
    example: true,
  })
  @IsBoolean()
  verifyOutput!: boolean;

  @ApiProperty({
    description: 'Skip files currently seeding',
    example: true,
  })
  @IsBoolean()
  skipSeeding!: boolean;

  @ApiProperty({
    description: 'Library ID this policy belongs to',
    required: false,
    example: 'clx789def012',
  })
  @IsOptional()
  @IsString()
  libraryId?: string;
}

export class ReceivePoliciesDto {
  @ApiProperty({
    description: 'List of policies to sync',
    type: [PolicySyncDto],
  })
  @IsArray()
  policies!: PolicySyncDto[];
}
