import { ApiProperty } from '@nestjs/swagger';
import { LicenseTier } from '@prisma/client';
import { LicenseFeatureDto } from './license-feature.dto';

export class LicenseDto {
  @ApiProperty({
    description: 'License tier',
    enum: LicenseTier,
    example: LicenseTier.FREE,
  })
  tier!: LicenseTier;

  @ApiProperty({
    description: 'Masked license key',
    example: 'XXX-XXXX-XXXX-1234',
  })
  licenseKey!: string;

  @ApiProperty({
    description: 'License holder email',
    example: 'user@example.com',
  })
  email!: string;

  @ApiProperty({
    description: 'License valid until date (ISO 8601) or "Lifetime"',
    example: '2025-12-31T23:59:59Z',
  })
  validUntil!: string;

  @ApiProperty({
    description: 'Maximum number of nodes allowed',
    example: 1,
  })
  maxNodes!: number;

  @ApiProperty({
    description: 'Currently used nodes',
    example: 1,
  })
  usedNodes!: number;

  @ApiProperty({
    description: 'Maximum concurrent jobs allowed',
    example: 2,
  })
  maxConcurrentJobs!: number;

  @ApiProperty({
    description: 'List of enabled features',
    type: [LicenseFeatureDto],
  })
  features!: LicenseFeatureDto[];
}
