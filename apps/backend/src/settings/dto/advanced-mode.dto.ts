import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class AdvancedModeDto {
  @ApiProperty({
    description: 'Whether advanced mode is enabled (shows power user controls)',
    example: false,
    default: false,
  })
  @IsBoolean()
  advancedModeEnabled!: boolean;
}
