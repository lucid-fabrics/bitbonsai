import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VerifyLicenseResponseDto {
  @ApiProperty() valid: boolean;
  @ApiPropertyOptional() error?: string;
  @ApiPropertyOptional() license?: {
    email: string;
    tier: string;
    maxNodes: number;
    maxConcurrentJobs: number;
    expiresAt: string | null;
  };
}
