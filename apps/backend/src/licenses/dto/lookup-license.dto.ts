import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

export class LookupLicenseDto {
  @ApiProperty({
    description: 'Email address to lookup license for',
    example: 'user@example.com',
  })
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Invalid email format' })
  @MaxLength(254, { message: 'Email is too long' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email!: string;
}
