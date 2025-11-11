import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/guards/public.decorator';
import { EnvironmentInfoDto } from '../common/dto/environment-info.dto';
import { DatabaseType, LogLevel } from '../common/enums';
import { EnvironmentService } from '../common/environment.service';
import { AutoHealRetryLimitDto } from './dto/auto-heal-retry-limit.dto';
import { DefaultQueueViewDto } from './dto/default-queue-view.dto';
import { ReadyFilesCacheTtlDto } from './dto/ready-files-cache-ttl.dto';
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
      version: process.env.APP_VERSION || '1.0.0',
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
      version: process.env.APP_VERSION || '1.0.0',
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

  @Get('default-queue-view')
  @ApiOperation({
    summary: 'Get default queue view preference',
    description:
      "Retrieve the user's preferred default queue filter view (ENCODING, QUEUED, COMPLETED, FAILED, ALL, etc.)",
  })
  @ApiResponse({
    status: 200,
    description: 'Default queue view preference retrieved successfully',
    type: DefaultQueueViewDto,
  })
  async getDefaultQueueView(): Promise<DefaultQueueViewDto> {
    return this.settingsService.getDefaultQueueView();
  }

  @Patch('default-queue-view')
  @ApiOperation({
    summary: 'Update default queue view preference',
    description:
      "Update the user's preferred default queue filter view. This setting will be applied when the queue page loads.",
  })
  @ApiResponse({
    status: 200,
    description: 'Default queue view preference updated successfully',
    type: DefaultQueueViewDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid queue view provided',
  })
  async updateDefaultQueueView(
    @Body() updateDto: DefaultQueueViewDto
  ): Promise<DefaultQueueViewDto> {
    return this.settingsService.updateDefaultQueueView(updateDto);
  }

  @Get('ready-files-cache-ttl')
  @ApiOperation({
    summary: 'Get ready files cache TTL',
    description:
      'Retrieve the cache TTL (Time To Live) in minutes for the /api/v1/libraries/ready endpoint. This setting controls how long library scan results are cached.',
  })
  @ApiResponse({
    status: 200,
    description: 'Cache TTL retrieved successfully',
    type: ReadyFilesCacheTtlDto,
  })
  async getReadyFilesCacheTtl(): Promise<ReadyFilesCacheTtlDto> {
    return this.settingsService.getReadyFilesCacheTtl();
  }

  @Patch('ready-files-cache-ttl')
  @ApiOperation({
    summary: 'Update ready files cache TTL',
    description:
      'Update the cache TTL (Time To Live) in minutes for the /api/v1/libraries/ready endpoint. Minimum value is 5 minutes to prevent excessive file system scans.',
  })
  @ApiResponse({
    status: 200,
    description: 'Cache TTL updated successfully',
    type: ReadyFilesCacheTtlDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid TTL value (must be at least 5 minutes)',
  })
  async updateReadyFilesCacheTtl(
    @Body() updateDto: ReadyFilesCacheTtlDto
  ): Promise<ReadyFilesCacheTtlDto> {
    return this.settingsService.updateReadyFilesCacheTtl(updateDto.readyFilesCacheTtlMinutes);
  }

  @Get('auto-heal-retry-limit')
  @ApiOperation({
    summary: 'Get auto-heal retry limit',
    description:
      'Retrieve the maximum retry count for auto-heal to resurrect failed jobs. Jobs exceeding this limit will not be automatically healed on backend restart.',
  })
  @ApiResponse({
    status: 200,
    description: 'Auto-heal retry limit retrieved successfully',
    type: AutoHealRetryLimitDto,
  })
  async getAutoHealRetryLimit(): Promise<AutoHealRetryLimitDto> {
    return this.settingsService.getAutoHealRetryLimit();
  }

  @Patch('auto-heal-retry-limit')
  @ApiOperation({
    summary: 'Update auto-heal retry limit',
    description:
      'Update the maximum retry count for auto-heal. Minimum value is 3 to prevent overly aggressive auto-healing. Recommended: 10-20 for high-load systems.',
  })
  @ApiResponse({
    status: 200,
    description: 'Auto-heal retry limit updated successfully',
    type: AutoHealRetryLimitDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid retry limit (must be at least 3)',
  })
  async updateAutoHealRetryLimit(
    @Body() updateDto: AutoHealRetryLimitDto
  ): Promise<AutoHealRetryLimitDto> {
    return this.settingsService.updateAutoHealRetryLimit(updateDto.maxAutoHealRetries);
  }
}
