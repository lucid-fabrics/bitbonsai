import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LicenseTierDto } from './license-tier.enum';

export class LicenseResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() key: string;
  @ApiProperty() email: string;
  @ApiProperty({ enum: LicenseTierDto }) tier: LicenseTierDto;
  @ApiProperty() maxNodes: number;
  @ApiProperty() maxConcurrentJobs: number;
  @ApiPropertyOptional() expiresAt?: Date;
  @ApiProperty() createdAt: Date;
}
