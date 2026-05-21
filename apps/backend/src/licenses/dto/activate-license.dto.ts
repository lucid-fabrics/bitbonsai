import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ActivateLicenseDto {
  @ApiProperty({
    description: 'License key from licensing-service (BITBONSAI-XXX-... format)',
    example: 'BITBONSAI-SUP-eyJlbWFpbCI6InVz...',
  })
  @IsNotEmpty({ message: 'License key is required' })
  @IsString()
  @MinLength(20, { message: 'License key is too short' })
  @MaxLength(1000, { message: 'License key is too long' })
  licenseKey!: string;

  @ApiProperty({
    description: 'Email address for license activation',
    example: 'user@example.com',
  })
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Invalid email format' })
  @MaxLength(254, { message: 'Email is too long' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email!: string;
}
