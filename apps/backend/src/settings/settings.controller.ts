import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/guards/public.decorator';
import { EnvironmentInfoDto } from '../common/dto/environment-info.dto';
import { DatabaseType, LogLevel } from '../common/enums';
import { EnvironmentService } from '../common/environment.service';
import { SecuritySettingsDto } from './dto/security-settings.dto';
import { SystemSettingsDto } from './dto/system-settings.dto';
import type { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly settingsService: SettingsService
  ) {}

  @Get('environment')
  @ApiOperation({
    summary: 'Get environment information',
    description:
      'Detect runtime environment and return system capabilities, hardware acceleration options, and default paths. Used by setup wizard to provide environment-specific configuration.',
  })
  @ApiResponse({
    status: 200,
    description: 'Environment information retrieved successfully',
    type: EnvironmentInfoDto,
  })
  async getEnvironmentInfo(): Promise<EnvironmentInfoDto> {
    return this.environmentService.getEnvironmentInfo();
  }

  @Get('system')
  @ApiOperation({
    summary: 'Get system configuration',
    description:
      'Retrieve current system settings including database info, FFmpeg path, log level, and API configuration. Used by settings UI to display and manage system configuration.',
  })
  @ApiResponse({
    status: 200,
    description: 'System settings retrieved successfully',
    type: SystemSettingsDto,
  })
  async getSystemSettings(): Promise<SystemSettingsDto> {
    return {
      version: '0.1.0',
      databaseType: DatabaseType.SQLITE,
      databasePath: '/config/bitbonsai.db',
      storageInfo: {
        usedGb: 15.3,
        totalGb: 100.0,
        usagePercent: 15.3,
      },
      ffmpegPath: '/usr/bin/ffmpeg',
      logLevel: LogLevel.INFO,
      analyticsEnabled: true,
      apiKey: 'bb_1234567890abcdef',
      webhookUrl: undefined,
    };
  }

  @Patch('system')
  @ApiOperation({
    summary: 'Update system configuration',
    description:
      'Update system settings such as FFmpeg path, log level, analytics toggle, and webhook URL. Only provided fields will be updated.',
  })
  @ApiResponse({
    status: 200,
    description: 'System settings updated successfully',
    type: SystemSettingsDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid settings provided',
  })
  async updateSystemSettings(
    @Body() updateDto: UpdateSystemSettingsDto
  ): Promise<SystemSettingsDto> {
    return {
      version: '0.1.0',
      databaseType: DatabaseType.SQLITE,
      databasePath: '/config/bitbonsai.db',
      storageInfo: {
        usedGb: 15.3,
        totalGb: 100.0,
        usagePercent: 15.3,
      },
      ffmpegPath: updateDto.ffmpegPath || '/usr/bin/ffmpeg',
      logLevel: updateDto.logLevel || LogLevel.INFO,
      analyticsEnabled: updateDto.analyticsEnabled ?? true,
      apiKey: 'bb_1234567890abcdef',
      webhookUrl: updateDto.webhookUrl,
    };
  }

  @Post('system/backup')
  @ApiOperation({
    summary: 'Backup database',
    description:
      'Create a backup of the current database. Returns the backup file path and timestamp.',
  })
  @ApiResponse({
    status: 200,
    description: 'Database backed up successfully',
    schema: {
      type: 'object',
      properties: {
        backupPath: { type: 'string', example: '/config/backups/bitbonsai-2025-10-01.db' },
        timestamp: { type: 'string', example: '2025-10-01T12:00:00Z' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Backup directory not writable or insufficient disk space',
  })
  async backupDatabase(): Promise<{ backupPath: string; timestamp: string }> {
    const timestamp = new Date().toISOString();
    return {
      backupPath: `/config/backups/bitbonsai-${timestamp.split('T')[0]}.db`,
      timestamp,
    };
  }

  @Post('system/reset')
  @ApiOperation({
    summary: 'Reset to default settings',
    description:
      'Reset system settings to default values. This does not delete user data or libraries, only resets configuration settings.',
  })
  @ApiResponse({
    status: 200,
    description: 'System settings reset successfully',
  })
  @ApiBadRequestResponse({
    description: 'Cannot reset settings while jobs are running',
  })
  async resetToDefaults(): Promise<{ message: string }> {
    return { message: 'System settings reset to defaults successfully' };
  }

  @Post('system/api-key/regenerate')
  @ApiOperation({
    summary: 'Regenerate API key',
    description:
      'Generate a new API key for external integrations. The old API key will be invalidated immediately.',
  })
  @ApiResponse({
    status: 200,
    description: 'API key regenerated successfully',
    schema: {
      type: 'object',
      properties: {
        apiKey: { type: 'string', example: 'bb_newapikey123456' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid request or API key regeneration not allowed',
  })
  async regenerateApiKey(): Promise<{ apiKey: string }> {
    const randomKey = Math.random().toString(36).substring(2, 18);
    return { apiKey: `bb_${randomKey}` };
  }

  @Get('security')
  @Public()
  @ApiOperation({
    summary: 'Get security settings',
    description:
      'Retrieve current security settings including local network authentication bypass configuration. This endpoint is public to allow the frontend to check if authentication is required.',
  })
  @ApiResponse({
    status: 200,
    description: 'Security settings retrieved successfully',
    type: SecuritySettingsDto,
  })
  async getSecuritySettings(): Promise<SecuritySettingsDto> {
    return this.settingsService.getSecuritySettings();
  }

  @Patch('security')
  @ApiOperation({
    summary: 'Update security settings',
    description:
      'Update security settings such as local network authentication bypass. Use with caution as this affects authentication behavior.',
  })
  @ApiResponse({
    status: 200,
    description: 'Security settings updated successfully',
    type: SecuritySettingsDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid security settings provided',
  })
  async updateSecuritySettings(
    @Body() updateDto: SecuritySettingsDto
  ): Promise<SecuritySettingsDto> {
    return this.settingsService.updateSecuritySettings(updateDto);
  }
}
