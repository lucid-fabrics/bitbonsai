import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SecuritySettingsDto {
  @ApiProperty({
    description: 'Allow local network access without authentication',
    example: false,
  })
  @IsBoolean()
  allowLocalNetworkWithoutAuth!: boolean;
}
