import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl } from 'class-validator';

/**
 * DTO for Jellyfin integration settings
 */
export class JellyfinSettingsDto {
  @ApiProperty({
    description: 'Jellyfin server URL',
    example: 'http://192.168.1.100:8096',
    required: false,
  })
  @IsOptional()
  @IsUrl({}, { message: 'jellyfinUrl must be a valid URL' })
  jellyfinUrl?: string;

  @ApiProperty({
    description: 'Jellyfin API key for authentication',
    example: 'abc123def456',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'jellyfinApiKey must be a string' })
  jellyfinApiKey?: string;

  @ApiProperty({
    description: 'Whether to refresh Jellyfin library after encoding completes',
    example: true,
    default: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'jellyfinRefreshOnComplete must be a boolean' })
  jellyfinRefreshOnComplete?: boolean;
}

/**
 * DTO for Jellyfin connection test result
 */
export class JellyfinTestResultDto {
  @ApiProperty({
    description: 'Whether the connection was successful',
    example: true,
  })
  success!: boolean;

  @ApiProperty({
    description: 'Jellyfin server name (if connection successful)',
    example: 'My Jellyfin Server',
    required: false,
  })
  serverName?: string;

  @ApiProperty({
    description: 'Jellyfin server version (if connection successful)',
    example: '10.8.13',
    required: false,
  })
  version?: string;

  @ApiProperty({
    description: 'Error message (if connection failed)',
    example: 'Connection refused',
    required: false,
  })
  error?: string;
}
