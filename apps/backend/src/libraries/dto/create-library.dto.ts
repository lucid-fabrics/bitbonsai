import { ApiProperty } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

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
    description: 'Absolute path to the library folder on the node filesystem',
    example: '/mnt/user/media/Movies',
  })
  @IsNotEmpty()
  @IsString()
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
    description: 'ID of the node that manages this library',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  @IsNotEmpty()
  @IsString()
  nodeId!: string;
}
