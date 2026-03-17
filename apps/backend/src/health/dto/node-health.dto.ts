import { ApiProperty } from '@nestjs/swagger';

export class NodeHealthDto {
  @ApiProperty({
    description: 'Total number of nodes',
    type: Number,
    example: 2,
  })
  total!: number;

  @ApiProperty({
    description: 'Number of online nodes',
    type: Number,
    example: 2,
  })
  online!: number;

  @ApiProperty({
    description: 'Number of offline nodes',
    type: Number,
    example: 0,
  })
  offline!: number;
}
