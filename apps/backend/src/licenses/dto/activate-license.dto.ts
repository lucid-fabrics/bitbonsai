import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';

export class ActivateLicenseDto {
  @ApiProperty({
    description: 'License key in format XXX-XXXX-XXXX-XXXX',
    example: 'ABC-1234-5678-9012',
    pattern: '^[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, {
    message: 'License key must be in format XXX-XXXX-XXXX-XXXX',
  })
  licenseKey!: string;

  @ApiProperty({
    description: 'Email address for license activation',
    example: 'user@example.com',
  })
  @IsNotEmpty()
  @IsEmail()
  email!: string;
}
