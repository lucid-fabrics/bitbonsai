import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class VerifyLicenseDto {
  @ApiProperty({ example: 'BITBONSAI-PRO-...' })
  @IsString()
  licenseKey: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  machineId?: string;
}
