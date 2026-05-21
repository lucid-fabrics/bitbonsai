import { ApiProperty } from '@nestjs/swagger';

export class ReadinessDto {
  @ApiProperty({
    description: 'Whether the application is ready to accept requests',
    type: Boolean,
    example: true,
  })
  ready!: boolean;

  @ApiProperty({
    description: 'Reason if not ready',
    type: String,
    required: false,
    example: 'Database connection failed',
  })
  reason?: string;
}
