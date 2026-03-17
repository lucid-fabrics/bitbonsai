import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsString } from 'class-validator';

export class ReceiveSettingsDto {
  @ApiProperty({
    description: 'Setup completion status',
    example: true,
  })
  @IsBoolean()
  isSetupComplete!: boolean;

  @ApiProperty({
    description: 'Allow local network without auth',
    example: false,
  })
  @IsBoolean()
  allowLocalNetworkWithoutAuth!: boolean;

  @ApiProperty({
    description: 'Default queue view filter',
    example: 'ENCODING',
  })
  @IsString()
  defaultQueueView!: string;

  @ApiProperty({
    description: 'Ready files cache TTL in minutes',
    example: 5,
  })
  @IsInt()
  readyFilesCacheTtlMinutes!: number;
}
