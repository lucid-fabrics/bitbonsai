import { ApiProperty } from '@nestjs/swagger';

export enum LicenseTier {
  FREE = 'FREE',
  PATREON = 'PATREON',
  COMMERCIAL_PRO = 'COMMERCIAL_PRO',
}

export class LicenseFeatureDto {
  @ApiProperty({
    description: 'Feature name',
    example: 'API Access',
  })
  name!: string;

  @ApiProperty({
    description: 'Whether this feature is enabled',
    example: true,
  })
  enabled!: boolean;
}

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

export class ActivateLicenseDto {
  @ApiProperty({
    description: 'License key in format XXX-XXXX-XXXX-XXXX',
    example: 'ABC-1234-5678-9012',
    pattern: '^[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$',
  })
  licenseKey!: string;

  @ApiProperty({
    description: 'Email address for license activation',
    example: 'user@example.com',
  })
  email!: string;
}
