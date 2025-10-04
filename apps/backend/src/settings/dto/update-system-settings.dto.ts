import { LogLevel } from '@bitbonsai/shared-models';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSystemSettingsDto {
  @ApiProperty({
    description: 'FFmpeg executable path',
    example: '/usr/bin/ffmpeg',
    required: false,
  })
  ffmpegPath?: string;

  @ApiProperty({
    description: 'Log level',
    enum: LogLevel,
    example: LogLevel.INFO,
    required: false,
  })
  logLevel?: LogLevel;

  @ApiProperty({
    description: 'Whether analytics are enabled',
    example: true,
    required: false,
  })
  analyticsEnabled?: boolean;

  @ApiProperty({
    description: 'Webhook URL for notifications (must be HTTPS)',
    example: 'https://example.com/webhook',
    pattern: '^https://.+',
    required: false,
  })
  webhookUrl?: string;
}
