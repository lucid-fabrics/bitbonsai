import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Username for authentication',
    example: 'admin',
    minLength: 1,
  })
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty({
    description: 'Password for authentication',
    example: 'your-secure-password',
    minLength: 1,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  password!: string;
}
