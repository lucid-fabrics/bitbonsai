import { ApiProperty } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class LibrarySyncDto {
  @ApiProperty({
    description: 'Library ID',
    example: 'clx789def012',
  })
  @IsString()
  id!: string;

  @ApiProperty({
    description: 'Library name',
    example: 'Movies',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'Library path (metadata only, not scanned on child)',
    example: '/data/media/movies',
  })
  @IsString()
  path!: string;

  @ApiProperty({
    description: 'Media type',
    enum: MediaType,
    example: MediaType.MOVIE,
  })
  @IsEnum(MediaType)
  mediaType!: MediaType;

  @ApiProperty({
    description: 'Library enabled status',
    example: true,
  })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({
    description: 'Default policy ID for this library',
    required: false,
    example: 'clx123abc456',
  })
  @IsOptional()
  @IsString()
  defaultPolicyId?: string;
}

export class ReceiveLibrariesDto {
  @ApiProperty({
    description: 'List of libraries to sync',
    type: [LibrarySyncDto],
  })
  @IsArray()
  libraries!: LibrarySyncDto[];
}
