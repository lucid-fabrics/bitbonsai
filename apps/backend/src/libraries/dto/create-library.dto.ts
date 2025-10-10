import { ApiProperty } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO for creating a new library
 */
export class CreateLibraryDto {
  @ApiProperty({
    description: 'Display name for the library',
    example: 'Main Movie Collection',
    minLength: 1,
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiProperty({
    description:
      'Absolute path to the library folder on the node filesystem (no path traversal allowed)',
    example: '/mnt/user/media/Movies',
  })
  @IsNotEmpty()
  @IsString()
  // SECURITY: Prevent path traversal attacks
  // - Must be an absolute path (starts with /)
  // - Cannot contain .. (parent directory references)
  // - Cannot contain consecutive slashes
  // - Only allows alphanumeric, dash, underscore, dot, and forward slash
  @Matches(/^\/[a-zA-Z0-9/_\-.]+$/, {
    message: 'Path must be an absolute path without path traversal sequences (..)',
  })
  path!: string;

  @ApiProperty({
    description: 'Type of media content in this library',
    enum: MediaType,
    example: MediaType.MOVIE,
    enumName: 'MediaType',
  })
  @IsNotEmpty()
  @IsEnum(MediaType)
  mediaType!: MediaType;

  @ApiProperty({
    description:
      'ID of the node that manages this library (optional - auto-assigns to first available node if not provided)',
    example: 'clq8x9z8x0000qh8x9z8x0000',
    required: false,
  })
  @IsOptional()
  @IsString()
  nodeId?: string;
}
