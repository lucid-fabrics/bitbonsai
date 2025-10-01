import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for validating a license key
 */
export class ValidateLicenseDto {
  @ApiProperty({
    description: 'The license key to validate',
    example: 'FRE-abcdef123456',
    minLength: 1,
  })
  @IsString()
  @IsNotEmpty()
  key: string;
}
