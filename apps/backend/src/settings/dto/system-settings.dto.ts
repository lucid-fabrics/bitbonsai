import { ApiProperty } from '@nestjs/swagger';

export enum DatabaseType {
  SQLITE = 'SQLITE',
  POSTGRESQL = 'POSTGRESQL',
}

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export class StorageInfoDto {
  @ApiProperty({
    description: 'Used storage in GB',
    example: 15.3,
  })
  usedGb!: number;

  @ApiProperty({
    description: 'Total storage in GB',
    example: 100.0,
  })
  totalGb!: number;

  @ApiProperty({
    description: 'Storage usage percentage',
    example: 15.3,
  })
  usagePercent!: number;
}

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
