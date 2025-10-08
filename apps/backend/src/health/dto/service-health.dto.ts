import { ApiProperty } from '@nestjs/swagger';

export class ServiceHealthDto {
  @ApiProperty({
    description: 'Service health status',
    enum: ['ok', 'error', 'unavailable'],
    example: 'ok',
  })
  status!: 'ok' | 'error' | 'unavailable';

  @ApiProperty({
    description: 'Response time in milliseconds',
    type: Number,
    example: 15,
    required: false,
  })
  responseTime?: number;

  @ApiProperty({
    description: 'Error message if service is unavailable',
    type: String,
    required: false,
    example: 'Connection refused',
  })
  error?: string;

  @ApiProperty({
    description: 'Additional service-specific information',
    type: String,
    required: false,
    example: '5.1.2',
  })
  version?: string;
}
