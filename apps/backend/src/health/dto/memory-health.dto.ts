import { ApiProperty } from '@nestjs/swagger';

export class MemoryHealthDto {
  @ApiProperty({
    description: 'Memory health status',
    enum: ['ok', 'warning', 'critical'],
    example: 'ok',
  })
  status!: 'ok' | 'warning' | 'critical';

  @ApiProperty({
    description: 'Used memory',
    type: String,
    example: '2GB',
  })
  used!: string;

  @ApiProperty({
    description: 'Total memory',
    type: String,
    example: '16GB',
  })
  total!: string;

  @ApiProperty({
    description: 'Memory usage percentage',
    type: Number,
    example: 12.5,
  })
  percentage!: number;
}
