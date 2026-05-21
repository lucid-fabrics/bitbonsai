import { ApiProperty } from '@nestjs/swagger';

export class BasicHealthDto {
  @ApiProperty({
    description: 'Overall health status',
    enum: ['ok', 'error'],
    example: 'ok',
  })
  status!: 'ok' | 'error';

  @ApiProperty({
    description: 'Current timestamp',
    type: Date,
    example: '2025-10-01T12:00:00Z',
  })
  timestamp!: Date;

  @ApiProperty({
    description: 'Application uptime in seconds',
    type: Number,
    example: 3600,
  })
  uptime!: number;

  @ApiProperty({
    description: 'Application version',
    type: String,
    example: '0.1.0',
  })
  version!: string;
}
