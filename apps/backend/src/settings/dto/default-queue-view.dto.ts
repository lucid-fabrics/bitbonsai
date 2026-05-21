import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class DefaultQueueViewDto {
  @ApiProperty({
    description: 'Default queue filter view (ENCODING, QUEUED, COMPLETED, FAILED, ALL, etc.)',
    example: 'ENCODING',
  })
  @IsString()
  defaultQueueView!: string;
}
