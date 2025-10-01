import { ApiProperty } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';

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
  name!: string;

  @ApiProperty({
    description: 'Absolute path to the library folder on the node filesystem',
    example: '/mnt/user/media/Movies',
  })
  path!: string;

  @ApiProperty({
    description: 'Type of media content in this library',
    enum: MediaType,
    example: MediaType.MOVIE,
    enumName: 'MediaType',
  })
  mediaType!: MediaType;

  @ApiProperty({
    description: 'ID of the node that manages this library',
    example: 'clq8x9z8x0000qh8x9z8x0000',
  })
  nodeId!: string;
}
