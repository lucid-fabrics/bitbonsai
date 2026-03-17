import { ApiProperty } from '@nestjs/swagger';
import { PolicyPreset, TargetCodec } from '@prisma/client';

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
