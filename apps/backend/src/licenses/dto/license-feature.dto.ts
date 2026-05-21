import { ApiProperty } from '@nestjs/swagger';

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
