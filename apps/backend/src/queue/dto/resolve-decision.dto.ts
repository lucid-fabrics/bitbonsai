import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

export class ResolveDecisionDto {
  @ApiProperty({
    description:
      'User decision data to resolve health check blockers. ' +
      'Contains key-value pairs mapping issue IDs to chosen solutions. ' +
      'Example: { "audio_codec_incompatible": "remux_to_mkv", "resolution_too_high": "proceed_anyway" }',
    example: {
      audio_codec_incompatible: 'remux_to_mkv',
      resolution_too_high: 'proceed_anyway',
    },
    required: false,
  })
  @IsOptional()
  @IsObject()
  decisionData?: Record<string, any>;
}
