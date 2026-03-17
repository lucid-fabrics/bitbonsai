import { ApiProperty } from '@nestjs/swagger';

export class SetupStatusDto {
  @ApiProperty({
    description: 'Indicates whether the initial setup has been completed',
    example: false,
  })
  isSetupComplete!: boolean;
}
