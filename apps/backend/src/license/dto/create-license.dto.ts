import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const VALID_TIERS = [
  'FREE',
  'PATREON',
  'PATREON_SUPPORTER',
  'PATREON_PLUS',
  'PATREON_PRO',
  'PATREON_ULTIMATE',
  'COMMERCIAL_STARTER',
  'COMMERCIAL_PRO',
  'COMMERCIAL_ENTERPRISE',
] as const;

export type TierString = (typeof VALID_TIERS)[number];

/**
 * DTO for creating a new license
 */
export class CreateLicenseDto {
  @ApiProperty({
    description: 'License tier',
    enum: VALID_TIERS,
    example: 'FREE',
  })
  @IsString()
  @IsNotEmpty()
  tier!: string;

  @ApiProperty({
    description: 'Email address associated with the license',
    example: 'user@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiPropertyOptional({
    description:
      'License expiration date (ISO 8601 format). Null or omitted means perpetual license.',
    example: '2025-12-31T23:59:59.999Z',
    type: String,
  })
  @IsOptional()
  @IsDateString()
  validUntil?: string;
}
