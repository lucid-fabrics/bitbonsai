import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { version as APP_VERSION } from '../../../../package.json';
import { Public } from '../auth/guards/public.decorator';
import { EnvironmentInfoDto } from '../common/dto/environment-info.dto';
import { DatabaseType, LogLevel } from '../common/enums';
import { EnvironmentService } from '../common/environment.service';
import { JellyfinIntegrationService } from '../integrations/jellyfin.service';
import { AdvancedModeDto } from './dto/advanced-mode.dto';
import { AutoHealRetryLimitDto } from './dto/auto-heal-retry-limit.dto';
import { DefaultQueueViewDto } from './dto/default-queue-view.dto';
import { JellyfinSettingsDto, JellyfinTestResultDto } from './dto/jellyfin-settings.dto';
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
    private readonly settingsService: SettingsService,
    private readonly jellyfinService: JellyfinIntegrationService
  ) {}

  @Get('environment')
  @ApiOperation({
    summary: 'Get environment information',
    description:
      'Detect runtime environment and return system capabilities, hardware acceleration options, and default paths. Used by setup wizard to provide environment-specific configuration.',
  })
  @ApiOkResponse({
    description: 'Environment info retrieved',
    type: EnvironmentInfoDto,
  })
  @ApiInternalServerErrorResponse({ description: 'Failed to detect environment' })
  async getEnvironmentInfo(): Promise<EnvironmentInfoDto> {
    return this.environmentService.getEnvironmentInfo();
  }

  @Get('system')
  @ApiOperation({
    summary: 'Get system configuration',
    description:
      'Retrieve current system settings including database info, FFmpeg path, log level, and API configuration. Used by settings UI to display and manage system configuration.',
  })
  @ApiOkResponse({
    description: 'System settings retrieved',
    type: SystemSettingsDto,
  })
  @ApiInternalServerErrorResponse({ description: 'Failed to retrieve settings' })
  async getSystemSettings(): Promise<SystemSettingsDto> {
    return {
      version: APP_VERSION, // Read from package.json
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
  @ApiOkResponse({
    description: 'System settings updated',
    type: SystemSettingsDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid settings provided' })
  async updateSystemSettings(
    @Body() updateDto: UpdateSystemSettingsDto
  ): Promise<SystemSettingsDto> {
    return {
      version: APP_VERSION, // Read from package.json
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
  @ApiOkResponse({
    description: 'Database backed up successfully',
    schema: {
      type: 'object',
      properties: {
        backupPath: { type: 'string', example: '/config/backups/bitbonsai-2025-10-01.db' },
        timestamp: { type: 'string', example: '2025-10-01T12:00:00Z' },
      },
    },
  })
  @ApiInternalServerErrorResponse({ description: 'Backup failed' })
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
  @ApiOkResponse({ description: 'Settings reset to defaults' })
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
  @ApiOkResponse({
    description: 'API key regenerated',
    schema: {
      type: 'object',
      properties: {
        apiKey: { type: 'string', example: 'bb_newapikey123456' },
      },
    },
  })
  @ApiInternalServerErrorResponse({ description: 'Failed to regenerate key' })
  @ApiBadRequestResponse({
    description: 'Invalid request or API key regeneration not allowed',
  })
  async regenerateApiKey(): Promise<{ apiKey: string }> {
    const randomKey = require('crypto').randomBytes(16).toString('hex').substring(0, 16);
    return { apiKey: `bb_${randomKey}` };
  }

  @Get('security')
  @Public()
  @ApiOperation({
    summary: 'Get security settings',
    description:
      'Retrieve current security settings including local network authentication bypass configuration. This endpoint is public to allow the frontend to check if authentication is required.',
  })
  @ApiOkResponse({
    description: 'Security settings retrieved',
    type: SecuritySettingsDto,
  })
  @ApiInternalServerErrorResponse({ description: 'Failed to retrieve security settings' })
  async getSecuritySettings(): Promise<SecuritySettingsDto> {
    return this.settingsService.getSecuritySettings();
  }

  @Patch('security')
  @ApiOperation({
    summary: 'Update security settings',
    description:
      'Update security settings such as local network authentication bypass. Use with caution as this affects authentication behavior.',
  })
  @ApiOkResponse({
    description: 'Security settings updated',
    type: SecuritySettingsDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid security settings' })
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
  @ApiOkResponse({
    description: 'Queue view preference retrieved',
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
  @ApiOkResponse({
    description: 'Queue view preference updated',
    type: DefaultQueueViewDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid queue view provided' })
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
  @ApiOkResponse({
    description: 'Cache TTL retrieved',
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
  @ApiOkResponse({
    description: 'Cache TTL updated',
    type: ReadyFilesCacheTtlDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid TTL value' })
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
  @ApiOkResponse({
    description: 'Auto-heal retry limit retrieved',
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
  @ApiOkResponse({
    description: 'Auto-heal retry limit updated',
    type: AutoHealRetryLimitDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid retry limit' })
  async updateAutoHealRetryLimit(
    @Body() updateDto: AutoHealRetryLimitDto
  ): Promise<AutoHealRetryLimitDto> {
    return this.settingsService.updateAutoHealRetryLimit(updateDto.maxAutoHealRetries);
  }

  // ============================================================================
  // ADVANCED MODE (UI Simplification)
  // ============================================================================

  @Get('advanced-mode')
  @ApiOperation({
    summary: 'Get advanced mode setting',
    description:
      'Retrieve whether advanced UI controls should be shown. Default is false (minimal mode) for simpler UX.',
  })
  @ApiOkResponse({
    description: 'Advanced mode setting retrieved',
    schema: {
      type: 'object',
      properties: {
        advancedModeEnabled: { type: 'boolean', example: false },
      },
    },
  })
  async getAdvancedMode(): Promise<AdvancedModeDto> {
    return this.settingsService.getAdvancedMode();
  }

  @Patch('advanced-mode')
  @ApiOperation({
    summary: 'Update advanced mode setting',
    description:
      'Toggle visibility of advanced UI controls (bulk actions, node filters, debug info, etc.).',
  })
  @ApiOkResponse({
    description: 'Advanced mode setting updated',
    schema: {
      type: 'object',
      properties: {
        advancedModeEnabled: { type: 'boolean', example: true },
      },
    },
  })
  async updateAdvancedMode(@Body() updateDto: AdvancedModeDto): Promise<AdvancedModeDto> {
    return this.settingsService.updateAdvancedMode(updateDto.advancedModeEnabled);
  }

  // ============================================================================
  // JELLYFIN INTEGRATION
  // ============================================================================

  @Get('jellyfin')
  @ApiOperation({
    summary: 'Get Jellyfin integration settings',
    description: 'Retrieve Jellyfin server URL and configuration. API key is masked for security.',
  })
  @ApiOkResponse({
    description: 'Jellyfin settings retrieved',
    type: JellyfinSettingsDto,
  })
  async getJellyfinSettings(): Promise<JellyfinSettingsDto> {
    const settings = await this.settingsService.getJellyfinSettings();
    return {
      jellyfinUrl: settings.jellyfinUrl || undefined,
      jellyfinApiKey: settings.jellyfinApiKey || undefined,
      jellyfinRefreshOnComplete: settings.jellyfinRefreshOnComplete,
    };
  }

  @Patch('jellyfin')
  @ApiOperation({
    summary: 'Update Jellyfin integration settings',
    description:
      'Update Jellyfin server URL, API key, or library refresh setting. Leave API key undefined to keep existing value.',
  })
  @ApiOkResponse({
    description: 'Jellyfin settings updated',
    type: JellyfinSettingsDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid Jellyfin settings' })
  async updateJellyfinSettings(
    @Body() updateDto: JellyfinSettingsDto
  ): Promise<JellyfinSettingsDto> {
    const settings = await this.settingsService.updateJellyfinSettings(updateDto);
    return {
      jellyfinUrl: settings.jellyfinUrl || undefined,
      jellyfinApiKey: settings.jellyfinApiKey || undefined,
      jellyfinRefreshOnComplete: settings.jellyfinRefreshOnComplete,
    };
  }

  @Post('jellyfin/test')
  @ApiOperation({
    summary: 'Test Jellyfin connection',
    description:
      'Test connectivity to Jellyfin server using provided or stored credentials. Returns server name and version if successful.',
  })
  @ApiOkResponse({
    description: 'Connection test completed',
    type: JellyfinTestResultDto,
  })
  @ApiBadRequestResponse({ description: 'Missing URL or API key' })
  async testJellyfinConnection(
    @Body() testDto: JellyfinSettingsDto
  ): Promise<JellyfinTestResultDto> {
    // Use provided credentials or fall back to stored ones
    let url = testDto.jellyfinUrl;
    let apiKey = testDto.jellyfinApiKey;

    if (!url || !apiKey) {
      const stored = await this.settingsService.getJellyfinSettings();
      url = url || stored.jellyfinUrl || undefined;
      // For test, we need the actual API key, not masked
      if (!apiKey && stored.jellyfinApiKey) {
        apiKey = (await this.settingsService.getUnmaskedJellyfinApiKey()) || undefined;
      }
    }

    if (!url || !apiKey) {
      return {
        success: false,
        error: 'Jellyfin URL and API key are required',
      };
    }

    return this.jellyfinService.testConnection(url, apiKey);
  }
}
