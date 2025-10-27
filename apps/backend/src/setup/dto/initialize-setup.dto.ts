import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, MinLength } from 'class-validator';

export class InitializeSetupDto {
  @ApiProperty({
    description: 'Username for the first admin user',
    example: 'admin',
    minLength: 3,
  })
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters long' })
  username!: string;

  @ApiProperty({
    description: 'Password for the first admin user',
    example: 'securePassword123',
    minLength: 8,
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  @ApiProperty({
    description: 'Allow local network access without authentication',
    example: false,
  })
  @IsBoolean()
  allowLocalNetworkWithoutAuth!: boolean;
}
