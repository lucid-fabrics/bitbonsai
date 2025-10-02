import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PolicyPreset, TargetCodec } from '@bitbonsai/shared-models';
import { LibraryInfoDto } from './library-info.dto';
import { JobCountDto } from './job-count.dto';

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
