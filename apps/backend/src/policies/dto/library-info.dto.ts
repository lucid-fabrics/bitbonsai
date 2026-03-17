import { ApiProperty } from '@nestjs/swagger';

export class LibraryInfoDto {
  @ApiProperty({
    description: 'Library unique identifier',
    example: 'clxxxx123456789',
  })
  id!: string;

  @ApiProperty({
    description: 'Library display name',
    example: 'TV Shows',
  })
  name!: string;
}
