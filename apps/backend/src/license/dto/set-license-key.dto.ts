import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * DTO for setting a license key
 */
export class SetLicenseKeyDto {
  @ApiProperty({
    description: 'License key to set',
    example: 'BITBONSAI-SUP-a1b2c3d4',
    minLength: 10,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty({ message: 'License key is required' })
  @MinLength(10, { message: 'License key must be at least 10 characters' })
  @MaxLength(100, { message: 'License key must not exceed 100 characters' })
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'License key can only contain letters, numbers, and hyphens',
  })
  key!: string;
}
