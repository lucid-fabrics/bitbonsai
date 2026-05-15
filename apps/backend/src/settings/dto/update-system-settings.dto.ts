import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUrl } from 'class-validator';
import { LogLevel } from '../../common/enums';

export class UpdateSystemSettingsDto {
  @ApiProperty({
    description: 'FFmpeg executable path',
    example: '/usr/bin/ffmpeg',
    required: false,
  })
  @IsOptional()
  @IsString()
  ffmpegPath?: string;

  @ApiProperty({
    description: 'Log level',
    enum: LogLevel,
    example: LogLevel.INFO,
    required: false,
  })
  @IsOptional()
  @IsEnum(LogLevel)
  logLevel?: LogLevel;

  @ApiProperty({
    description: 'Whether analytics are enabled',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  analyticsEnabled?: boolean;

  @ApiProperty({
    description: 'Webhook URL for notifications (must be HTTPS)',
    example: 'https://example.com/webhook',
    pattern: '^https://.+',
    required: false,
  })
  @IsOptional()
  @IsUrl({ protocols: ['https'] }, { message: 'Webhook URL must use HTTPS protocol' })
  webhookUrl?: string;
}
