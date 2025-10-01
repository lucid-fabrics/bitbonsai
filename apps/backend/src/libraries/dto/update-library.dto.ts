import { ApiProperty, PartialType } from '@nestjs/swagger';
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
}
