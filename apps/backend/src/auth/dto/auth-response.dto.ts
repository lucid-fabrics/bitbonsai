import { ApiProperty } from '@nestjs/swagger';

export class AuthResponseDto {
  @ApiProperty({
    description: 'JWT access token for authenticated requests (expires in 1 hour)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  access_token: string;

  @ApiProperty({
    description: 'Refresh token for obtaining new access tokens (expires in 7 days)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  refresh_token: string;

  @ApiProperty({
    description: 'User ID',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  userId: string;

  @ApiProperty({
    description: 'Username',
    example: 'admin',
  })
  username: string;

  @ApiProperty({
    description: 'User role',
    example: 'ADMIN',
    enum: ['ADMIN', 'USER'],
  })
  role: string;

  constructor(
    access_token: string,
    refresh_token: string,
    userId: string,
    username: string,
    role: string
  ) {
    this.access_token = access_token;
    this.refresh_token = refresh_token;
    this.userId = userId;
    this.username = username;
    this.role = role;
  }
}
