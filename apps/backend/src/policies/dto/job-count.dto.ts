import { ApiProperty } from '@nestjs/swagger';

export class JobCountDto {
  @ApiProperty({
    description: 'Number of completed jobs using this policy',
    example: 142,
    minimum: 0,
  })
  jobs!: number;
}
