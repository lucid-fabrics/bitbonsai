import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for marking a job as failed
 */
export class FailJobDto {
  @ApiProperty({
    description: 'Error message describing why the job failed',
    example: 'FFmpeg encoding failed: Unsupported codec in source file',
  })
  error!: string;
}
