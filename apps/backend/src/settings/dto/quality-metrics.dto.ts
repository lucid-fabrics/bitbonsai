import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class QualityMetricsDto {
  @ApiProperty({
    description: 'Whether quality metrics (VMAF/PSNR/SSIM) are calculated after encoding',
    example: false,
    default: false,
  })
  @IsBoolean()
  qualityMetricsEnabled!: boolean;
}
