import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LicenseTier } from '@prisma/client';
import { IsDateString, IsEmail, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';

/**
 * DTO for creating a new license
 */
export class CreateLicenseDto {
  @ApiProperty({
    description: 'License tier',
    enum: LicenseTier,
    example: LicenseTier.FREE,
  })
  @IsEnum(LicenseTier)
  @IsNotEmpty()
  tier: LicenseTier;

  @ApiProperty({
    description: 'Email address associated with the license',
    example: 'user@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

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
