import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateLibraryDto } from './create-library.dto';

/**
 * DTO for updating an existing library
 * All fields are optional (partial update supported)
 */
export class UpdateLibraryDto extends PartialType(CreateLibraryDto) {
  @ApiProperty({
    description: 'Enable or disable the library',
    example: true,
    required: false,
  })
  enabled?: boolean;

  @ApiProperty({
    description: 'Enable or disable automatic file watching (inotify)',
    example: false,
    required: false,
  })
  @IsOptional()
  watchEnabled?: boolean;

  @ApiProperty({
    description: 'Total size of all media files in bytes',
    example: 1073741824,
    required: false,
  })
  @IsOptional()
  totalSizeBytes?: bigint;

  @ApiProperty({
    description: 'Default encoding policy ID for this library (auto-selected during scans)',
    example: 'clq8x9z8x0001qh8x9z8x0001',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  defaultPolicyId?: string | null;
}
