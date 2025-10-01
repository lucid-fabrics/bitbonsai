import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
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
    description: 'Total size of all media files in bytes',
    example: 1073741824,
    required: false,
  })
  @IsOptional()
  totalSizeBytes?: bigint;
}
