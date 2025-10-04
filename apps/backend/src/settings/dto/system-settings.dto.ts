import { DatabaseType, LogLevel } from '@bitbonsai/shared-models';
import { ApiProperty } from '@nestjs/swagger';
import { StorageInfoDto } from './storage-info.dto';

export class SystemSettingsDto {
  @ApiProperty({
    description: 'BitBonsai version',
    example: '0.1.0',
  })
  version!: string;

  @ApiProperty({
    description: 'Database type',
    enum: DatabaseType,
    example: DatabaseType.SQLITE,
  })
  databaseType!: DatabaseType;

  @ApiProperty({
    description: 'Database path or connection string',
    example: '/config/bitbonsai.db',
  })
  databasePath!: string;

  @ApiProperty({
    description: 'Storage usage information',
    type: StorageInfoDto,
  })
  storageInfo!: StorageInfoDto;

  @ApiProperty({
    description: 'FFmpeg executable path',
    example: '/usr/bin/ffmpeg',
  })
  ffmpegPath!: string;

  @ApiProperty({
    description: 'Log level',
    enum: LogLevel,
    example: LogLevel.INFO,
  })
  logLevel!: LogLevel;

  @ApiProperty({
    description: 'Whether analytics are enabled',
    example: true,
  })
  analyticsEnabled!: boolean;

  @ApiProperty({
    description: 'API key for external integrations',
    example: 'bb_1234567890abcdef',
  })
  apiKey!: string;

  @ApiProperty({
    description: 'Webhook URL for notifications',
    example: 'https://example.com/webhook',
    required: false,
  })
  webhookUrl?: string;
}
