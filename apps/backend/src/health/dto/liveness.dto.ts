import { ApiProperty } from '@nestjs/swagger';

export class LivenessDto {
  @ApiProperty({
    description: 'Whether the application is alive',
    type: Boolean,
    example: true,
  })
  alive!: boolean;
}
