import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum NodeType {
  Main = 'main',
  Child = 'child',
}

export class InitializeSetupDto {
  @ApiProperty({
    description: 'Username for the first admin user (required for main nodes only)',
    example: 'admin',
    minLength: 3,
    required: false,
  })
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters long' })
  @IsOptional()
  username?: string;

  @ApiProperty({
    description: 'Password for the first admin user (required for main nodes only)',
    example: 'securePassword123',
    minLength: 8,
    required: false,
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @IsOptional()
  password?: string;

  @ApiProperty({
    description: 'Allow local network access without authentication',
    example: false,
  })
  @IsBoolean()
  allowLocalNetworkWithoutAuth!: boolean;

  @ApiProperty({
    description: 'Node type: main (create admin account) or child (generate pairing token)',
    example: NodeType.Main,
    enum: NodeType,
    required: false,
  })
  @IsEnum(NodeType)
  @IsOptional()
  nodeType?: NodeType;
}
