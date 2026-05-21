import { ApiProperty } from '@nestjs/swagger';

export class QueueHealthDto {
  @ApiProperty({
    description: 'Number of queued tasks',
    type: Number,
    example: 5,
  })
  queued!: number;

  @ApiProperty({
    description: 'Number of actively encoding tasks',
    type: Number,
    example: 2,
  })
  encoding!: number;

  @ApiProperty({
    description: 'Number of completed tasks',
    type: Number,
    example: 150,
  })
  completed!: number;

  @ApiProperty({
    description: 'Number of failed tasks',
    type: Number,
    example: 3,
  })
  failed!: number;
}
