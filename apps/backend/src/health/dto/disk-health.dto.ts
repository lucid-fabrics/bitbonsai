import { ApiProperty } from '@nestjs/swagger';

export class DiskHealthDto {
  @ApiProperty({
    description: 'Disk health status',
    enum: ['ok', 'warning', 'critical'],
    example: 'ok',
  })
  status!: 'ok' | 'warning' | 'critical';

  @ApiProperty({
    description: 'Percentage of disk space used',
    type: String,
    example: '50%',
  })
  used!: string;

  @ApiProperty({
    description: 'Available disk space',
    type: String,
    example: '500GB',
  })
  available!: string;
}
