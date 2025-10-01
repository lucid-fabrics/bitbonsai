import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PolicyPreset, TargetCodec } from './create-policy.dto';

export class LibraryInfoDto {
  @ApiProperty({
    description: 'Library unique identifier',
    example: 'clxxxx123456789',
  })
  id!: string;

  @ApiProperty({
    description: 'Library display name',
    example: 'TV Shows',
  })
  name!: string;
}

export class JobCountDto {
  @ApiProperty({
    description: 'Number of completed jobs using this policy',
    example: 142,
    minimum: 0,
  })
  jobs!: number;
}

export class PolicyStatsDto {
  @ApiProperty({
    description: 'Policy unique identifier',
    example: 'clxxxx987654321',
  })
  id!: string;

  @ApiProperty({
    description: 'Policy name',
    example: 'Standard Quality HEVC',
  })
  name!: string;

  @ApiProperty({
    description: 'Preset type',
    enum: PolicyPreset,
    example: PolicyPreset.BALANCED_HEVC,
  })
  preset!: PolicyPreset;

  @ApiProperty({
    description: 'Target codec',
    enum: TargetCodec,
    example: TargetCodec.HEVC,
  })
  targetCodec!: TargetCodec;

  @ApiProperty({
    description: 'Target quality (CRF)',
    example: 23,
    minimum: 0,
    maximum: 51,
  })
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
  deviceProfiles!: object;

  @ApiProperty({
    description: 'Advanced encoding settings',
    example: {
      ffmpegFlags: ['-preset', 'medium'],
      hwaccel: 'auto',
      audioCodec: 'copy',
      subtitleHandling: 'copy',
    },
  })
  advancedSettings!: object;

  @ApiProperty({
    description: 'Use atomic file replacement',
    example: true,
  })
  atomicReplace!: boolean;

  @ApiProperty({
    description: 'Verify output after encoding',
    example: true,
  })
  verifyOutput!: boolean;

  @ApiProperty({
    description: 'Skip files currently seeding',
    example: true,
  })
  skipSeeding!: boolean;

  @ApiPropertyOptional({
    description: 'Associated library information',
    type: LibraryInfoDto,
    nullable: true,
  })
  library?: LibraryInfoDto | null;

  @ApiProperty({
    description: 'Job statistics for this policy',
    type: JobCountDto,
  })
  _count!: JobCountDto;

  @ApiProperty({
    description: 'Policy creation timestamp',
    example: '2025-09-30T14:32:15.123Z',
    format: 'date-time',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Policy last update timestamp',
    example: '2025-10-01T08:15:42.456Z',
    format: 'date-time',
  })
  updatedAt!: string;
}

export class PolicyDto {
  @ApiProperty({
    description: 'Policy unique identifier',
    example: 'clxxxx987654321',
  })
  id!: string;

  @ApiProperty({
    description: 'Policy name',
    example: 'Standard Quality HEVC',
  })
  name!: string;

  @ApiProperty({
    description: 'Preset type',
    enum: PolicyPreset,
    example: PolicyPreset.BALANCED_HEVC,
  })
  preset!: PolicyPreset;

  @ApiProperty({
    description: 'Target codec',
    enum: TargetCodec,
    example: TargetCodec.HEVC,
  })
  targetCodec!: TargetCodec;

  @ApiProperty({
    description: 'Target quality (CRF)',
    example: 23,
    minimum: 0,
    maximum: 51,
  })
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
  deviceProfiles!: object;

  @ApiProperty({
    description: 'Advanced encoding settings',
    example: {
      ffmpegFlags: ['-preset', 'medium'],
      hwaccel: 'auto',
      audioCodec: 'copy',
      subtitleHandling: 'copy',
    },
  })
  advancedSettings!: object;

  @ApiProperty({
    description: 'Use atomic file replacement',
    example: true,
  })
  atomicReplace!: boolean;

  @ApiProperty({
    description: 'Verify output after encoding',
    example: true,
  })
  verifyOutput!: boolean;

  @ApiProperty({
    description: 'Skip files currently seeding',
    example: true,
  })
  skipSeeding!: boolean;

  @ApiPropertyOptional({
    description: 'Associated library ID',
    example: 'clxxxx123456789',
    nullable: true,
  })
  libraryId?: string | null;

  @ApiProperty({
    description: 'Policy creation timestamp',
    example: '2025-09-30T14:32:15.123Z',
    format: 'date-time',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Policy last update timestamp',
    example: '2025-10-01T08:15:42.456Z',
    format: 'date-time',
  })
  updatedAt!: string;
}

export class PresetInfoDto {
  @ApiProperty({
    description: 'Preset identifier',
    enum: PolicyPreset,
    example: PolicyPreset.BALANCED_HEVC,
  })
  preset!: PolicyPreset;

  @ApiProperty({
    description: 'Preset display name',
    example: 'Balanced HEVC',
  })
  name!: string;

  @ApiProperty({
    description: 'Preset description explaining use case',
    example: 'Balanced quality and speed for general-purpose HEVC encoding',
  })
  description!: string;

  @ApiProperty({
    description: 'Default target codec for this preset',
    enum: TargetCodec,
    example: TargetCodec.HEVC,
  })
  defaultCodec!: TargetCodec;

  @ApiProperty({
    description: 'Recommended CRF quality value',
    example: 23,
    minimum: 0,
    maximum: 51,
  })
  recommendedQuality!: number;
}
