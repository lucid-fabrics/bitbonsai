import { Test, type TestingModule } from '@nestjs/testing';
import { DatabaseType, LogLevel } from '../../../common/enums';
import { EnvironmentService } from '../../../common/environment.service';
import { JellyfinIntegrationService } from '../../../integrations/jellyfin.service';
import { SettingsController } from '../../settings.controller';
import { SettingsService } from '../../settings.service';

describe('SettingsController', () => {
  let controller: SettingsController;
  let settingsService: jest.Mocked<SettingsService>;
  let environmentService: jest.Mocked<EnvironmentService>;
  let jellyfinService: jest.Mocked<JellyfinIntegrationService>;

  beforeEach(async () => {
    const mockSettingsService = {
      getSecuritySettings: jest.fn(),
      updateSecuritySettings: jest.fn(),
      getDefaultQueueView: jest.fn(),
      updateDefaultQueueView: jest.fn(),
      getReadyFilesCacheTtl: jest.fn(),
      updateReadyFilesCacheTtl: jest.fn(),
      getAutoHealRetryLimit: jest.fn(),
      updateAutoHealRetryLimit: jest.fn(),
      getAdvancedMode: jest.fn(),
      updateAdvancedMode: jest.fn(),
      getJellyfinSettings: jest.fn(),
      getUnmaskedJellyfinApiKey: jest.fn(),
      updateJellyfinSettings: jest.fn(),
    };

    const mockEnvironmentService = {
      getEnvironmentInfo: jest.fn(),
    };

    const mockJellyfinService = {
      testConnection: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: EnvironmentService, useValue: mockEnvironmentService },
        { provide: JellyfinIntegrationService, useValue: mockJellyfinService },
      ],
    }).compile();

    controller = module.get<SettingsController>(SettingsController);
    settingsService = module.get(SettingsService);
    environmentService = module.get(EnvironmentService);
    jellyfinService = module.get(JellyfinIntegrationService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ==========================================================================
  // ENVIRONMENT
  // ==========================================================================
  describe('getEnvironmentInfo', () => {
    it('should return environment info from service', async () => {
      const envInfo = {
        environment: 'UNRAID' as const,
        isUnraid: true,
        isDocker: true,
        hardwareAcceleration: {
          nvidia: true,
          intelQsv: false,
          amd: false,
          appleVideoToolbox: false,
        },
        defaultPaths: {
          mediaPath: '/mnt/user/media',
          downloadsPath: '/mnt/user/Downloads',
          configPath: '/mnt/user/appdata/bitbonsai',
        },
        systemInfo: {
          cpuCores: 8,
          architecture: 'x64',
          platform: 'linux',
          totalMemoryGb: 16,
        },
        docsLink: 'https://docs.bitbonsai.com/setup/unraid',
        recommendations: ['GPU passthrough detected'],
      };
      environmentService.getEnvironmentInfo.mockResolvedValue(envInfo);

      const result = await controller.getEnvironmentInfo();

      expect(result).toEqual(envInfo);
      expect(environmentService.getEnvironmentInfo).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // SYSTEM SETTINGS
  // ==========================================================================
  describe('getSystemSettings', () => {
    it('should return hardcoded system settings with version', async () => {
      const result = await controller.getSystemSettings();

      expect(result.databaseType).toBe(DatabaseType.SQLITE);
      expect(result.databasePath).toBe('/config/bitbonsai.db');
      expect(result.ffmpegPath).toBe('/usr/bin/ffmpeg');
      expect(result.logLevel).toBe(LogLevel.INFO);
      expect(result.analyticsEnabled).toBe(true);
      expect(result.apiKey).toBe('bb_1234567890abcdef');
      expect(typeof result.version).toBe('string');
      expect(result.storageInfo).toEqual({
        usedGb: 15.3,
        totalGb: 100.0,
        usagePercent: 15.3,
      });
    });
  });

  describe('updateSystemSettings', () => {
    it('should return updated system settings', async () => {
      const result = await controller.updateSystemSettings({
        ffmpegPath: '/custom/ffmpeg',
        logLevel: LogLevel.DEBUG,
        analyticsEnabled: false,
        webhookUrl: 'https://example.com/webhook',
      });

      expect(result.ffmpegPath).toBe('/custom/ffmpeg');
      expect(result.logLevel).toBe(LogLevel.DEBUG);
      expect(result.analyticsEnabled).toBe(false);
      expect(result.webhookUrl).toBe('https://example.com/webhook');
    });

    it('should use defaults when no values provided', async () => {
      const result = await controller.updateSystemSettings({});

      expect(result.ffmpegPath).toBe('/usr/bin/ffmpeg');
      expect(result.logLevel).toBe(LogLevel.INFO);
      expect(result.analyticsEnabled).toBe(true);
      expect(result.webhookUrl).toBeUndefined();
    });
  });

  // ==========================================================================
  // BACKUP & RESET
  // ==========================================================================
  describe('backupDatabase', () => {
    it('should return backup path with timestamp', async () => {
      const result = await controller.backupDatabase();

      expect(result.backupPath).toContain('/config/backups/bitbonsai-');
      expect(result.backupPath).toMatch(/\.db$/);
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('resetToDefaults', () => {
    it('should return success message', async () => {
      const result = await controller.resetToDefaults();

      expect(result.message).toBe('System settings reset to defaults successfully');
    });
  });

  // ==========================================================================
  // API KEY
  // ==========================================================================
  describe('regenerateApiKey', () => {
    it('should return a new API key with bb_ prefix', async () => {
      const result = await controller.regenerateApiKey();

      expect(result.apiKey).toMatch(/^bb_[a-f0-9]{16}$/);
    });

    it('should generate unique keys each time', async () => {
      const result1 = await controller.regenerateApiKey();
      const result2 = await controller.regenerateApiKey();

      // While theoretically possible to collide, practically never happens
      expect(result1.apiKey).not.toBe(result2.apiKey);
    });
  });

  // ==========================================================================
  // SECURITY SETTINGS
  // ==========================================================================
  describe('getSecuritySettings', () => {
    it('should delegate to settings service', async () => {
      const expected = { allowLocalNetworkWithoutAuth: true };
      settingsService.getSecuritySettings.mockResolvedValue(expected);

      const result = await controller.getSecuritySettings();

      expect(result).toEqual(expected);
      expect(settingsService.getSecuritySettings).toHaveBeenCalled();
    });
  });

  describe('updateSecuritySettings', () => {
    it('should delegate to settings service', async () => {
      const dto = { allowLocalNetworkWithoutAuth: false };
      settingsService.updateSecuritySettings.mockResolvedValue(dto);

      const result = await controller.updateSecuritySettings(dto);

      expect(result).toEqual(dto);
      expect(settingsService.updateSecuritySettings).toHaveBeenCalledWith(dto);
    });
  });

  // ==========================================================================
  // DEFAULT QUEUE VIEW
  // ==========================================================================
  describe('getDefaultQueueView', () => {
    it('should delegate to settings service', async () => {
      const expected = { defaultQueueView: 'ENCODING' };
      settingsService.getDefaultQueueView.mockResolvedValue(expected);

      const result = await controller.getDefaultQueueView();

      expect(result).toEqual(expected);
    });
  });

  describe('updateDefaultQueueView', () => {
    it('should delegate to settings service', async () => {
      const dto = { defaultQueueView: 'FAILED' };
      settingsService.updateDefaultQueueView.mockResolvedValue(dto);

      const result = await controller.updateDefaultQueueView(dto);

      expect(result).toEqual(dto);
      expect(settingsService.updateDefaultQueueView).toHaveBeenCalledWith(dto);
    });
  });

  // ==========================================================================
  // READY FILES CACHE TTL
  // ==========================================================================
  describe('getReadyFilesCacheTtl', () => {
    it('should delegate to settings service', async () => {
      const expected = { readyFilesCacheTtlMinutes: 30 };
      settingsService.getReadyFilesCacheTtl.mockResolvedValue(expected);

      const result = await controller.getReadyFilesCacheTtl();

      expect(result).toEqual(expected);
    });
  });

  describe('updateReadyFilesCacheTtl', () => {
    it('should pass TTL value to settings service', async () => {
      const dto = { readyFilesCacheTtlMinutes: 60 };
      settingsService.updateReadyFilesCacheTtl.mockResolvedValue(dto);

      const result = await controller.updateReadyFilesCacheTtl(dto);

      expect(result).toEqual(dto);
      expect(settingsService.updateReadyFilesCacheTtl).toHaveBeenCalledWith(60);
    });
  });

  // ==========================================================================
  // AUTO-HEAL RETRY LIMIT
  // ==========================================================================
  describe('getAutoHealRetryLimit', () => {
    it('should delegate to settings service', async () => {
      const expected = { maxAutoHealRetries: 15 };
      settingsService.getAutoHealRetryLimit.mockResolvedValue(expected);

      const result = await controller.getAutoHealRetryLimit();

      expect(result).toEqual(expected);
    });
  });

  describe('updateAutoHealRetryLimit', () => {
    it('should pass retry limit to settings service', async () => {
      const dto = { maxAutoHealRetries: 20 };
      settingsService.updateAutoHealRetryLimit.mockResolvedValue(dto);

      const result = await controller.updateAutoHealRetryLimit(dto);

      expect(result).toEqual(dto);
      expect(settingsService.updateAutoHealRetryLimit).toHaveBeenCalledWith(20);
    });
  });

  // ==========================================================================
  // ADVANCED MODE
  // ==========================================================================
  describe('getAdvancedMode', () => {
    it('should delegate to settings service', async () => {
      const expected = { advancedModeEnabled: false };
      settingsService.getAdvancedMode.mockResolvedValue(expected);

      const result = await controller.getAdvancedMode();

      expect(result).toEqual(expected);
    });
  });

  describe('updateAdvancedMode', () => {
    it('should pass enabled flag to settings service', async () => {
      const dto = { advancedModeEnabled: true };
      settingsService.updateAdvancedMode.mockResolvedValue(dto);

      const result = await controller.updateAdvancedMode(dto);

      expect(result).toEqual(dto);
      expect(settingsService.updateAdvancedMode).toHaveBeenCalledWith(true);
    });
  });

  // ==========================================================================
  // JELLYFIN INTEGRATION
  // ==========================================================================
  describe('getJellyfinSettings', () => {
    it('should return Jellyfin settings with undefined for null values', async () => {
      settingsService.getJellyfinSettings.mockResolvedValue({
        jellyfinUrl: null,
        jellyfinApiKey: null,
        jellyfinRefreshOnComplete: true,
      });

      const result = await controller.getJellyfinSettings();

      expect(result).toEqual({
        jellyfinUrl: undefined,
        jellyfinApiKey: undefined,
        jellyfinRefreshOnComplete: true,
      });
    });

    it('should return configured Jellyfin settings', async () => {
      settingsService.getJellyfinSettings.mockResolvedValue({
        jellyfinUrl: 'http://jf:8096',
        jellyfinApiKey: '••••••••',
        jellyfinRefreshOnComplete: false,
      });

      const result = await controller.getJellyfinSettings();

      expect(result).toEqual({
        jellyfinUrl: 'http://jf:8096',
        jellyfinApiKey: '••••••••',
        jellyfinRefreshOnComplete: false,
      });
    });
  });

  describe('updateJellyfinSettings', () => {
    it('should delegate to settings service and transform null to undefined', async () => {
      settingsService.updateJellyfinSettings.mockResolvedValue({
        jellyfinUrl: 'http://jf:8096',
        jellyfinApiKey: '••••••••',
        jellyfinRefreshOnComplete: true,
      });

      const result = await controller.updateJellyfinSettings({
        jellyfinUrl: 'http://jf:8096',
        jellyfinApiKey: 'secret',
      });

      expect(result.jellyfinUrl).toBe('http://jf:8096');
      expect(result.jellyfinApiKey).toBe('••••••••');
    });

    it('should return undefined for null URL and API key', async () => {
      settingsService.updateJellyfinSettings.mockResolvedValue({
        jellyfinUrl: null,
        jellyfinApiKey: null,
        jellyfinRefreshOnComplete: false,
      });

      const result = await controller.updateJellyfinSettings({
        jellyfinUrl: '',
      });

      expect(result.jellyfinUrl).toBeUndefined();
      expect(result.jellyfinApiKey).toBeUndefined();
      expect(result.jellyfinRefreshOnComplete).toBe(false);
    });
  });

  describe('testJellyfinConnection', () => {
    it('should test with provided credentials', async () => {
      jellyfinService.testConnection.mockResolvedValue({
        success: true,
        serverName: 'My Jellyfin',
        version: '10.8.13',
      });

      const result = await controller.testJellyfinConnection({
        jellyfinUrl: 'http://jf:8096',
        jellyfinApiKey: 'key-123',
      });

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('My Jellyfin');
      expect(jellyfinService.testConnection).toHaveBeenCalledWith('http://jf:8096', 'key-123');
    });

    it('should fall back to stored credentials when not provided', async () => {
      settingsService.getJellyfinSettings.mockResolvedValue({
        jellyfinUrl: 'http://stored:8096',
        jellyfinApiKey: '••••••••',
        jellyfinRefreshOnComplete: true,
      });
      settingsService.getUnmaskedJellyfinApiKey.mockResolvedValue('stored-key');
      jellyfinService.testConnection.mockResolvedValue({
        success: true,
        serverName: 'Stored Server',
        version: '10.9.0',
      });

      const result = await controller.testJellyfinConnection({});

      expect(result.success).toBe(true);
      expect(jellyfinService.testConnection).toHaveBeenCalledWith(
        'http://stored:8096',
        'stored-key'
      );
    });

    it('should return error when no URL or API key available', async () => {
      settingsService.getJellyfinSettings.mockResolvedValue({
        jellyfinUrl: null,
        jellyfinApiKey: null,
        jellyfinRefreshOnComplete: true,
      });

      const result = await controller.testJellyfinConnection({});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Jellyfin URL and API key are required');
      expect(jellyfinService.testConnection).not.toHaveBeenCalled();
    });

    it('should use provided URL with stored API key', async () => {
      settingsService.getJellyfinSettings.mockResolvedValue({
        jellyfinUrl: 'http://old:8096',
        jellyfinApiKey: '••••••••',
        jellyfinRefreshOnComplete: true,
      });
      settingsService.getUnmaskedJellyfinApiKey.mockResolvedValue('stored-key');
      jellyfinService.testConnection.mockResolvedValue({ success: true });

      await controller.testJellyfinConnection({
        jellyfinUrl: 'http://new:8096',
      });

      expect(jellyfinService.testConnection).toHaveBeenCalledWith('http://new:8096', 'stored-key');
    });

    it('should return error when URL provided but no API key anywhere', async () => {
      settingsService.getJellyfinSettings.mockResolvedValue({
        jellyfinUrl: null,
        jellyfinApiKey: null,
        jellyfinRefreshOnComplete: true,
      });

      const result = await controller.testJellyfinConnection({
        jellyfinUrl: 'http://jf:8096',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Jellyfin URL and API key are required');
    });

    it('should use stored URL with provided API key', async () => {
      settingsService.getJellyfinSettings.mockResolvedValue({
        jellyfinUrl: 'http://stored:8096',
        jellyfinApiKey: null,
        jellyfinRefreshOnComplete: true,
      });
      jellyfinService.testConnection.mockResolvedValue({ success: true });

      const result = await controller.testJellyfinConnection({
        jellyfinApiKey: 'provided-key',
      });

      expect(result.success).toBe(true);
      expect(jellyfinService.testConnection).toHaveBeenCalledWith(
        'http://stored:8096',
        'provided-key'
      );
    });

    it('should return error when API key provided but no URL anywhere', async () => {
      settingsService.getJellyfinSettings.mockResolvedValue({
        jellyfinUrl: null,
        jellyfinApiKey: null,
        jellyfinRefreshOnComplete: true,
      });

      const result = await controller.testJellyfinConnection({
        jellyfinApiKey: 'some-key',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Jellyfin URL and API key are required');
    });
  });

  // ==========================================================================
  // ERROR CASES
  // ==========================================================================
  describe('error propagation', () => {
    it('should propagate error when getSecuritySettings throws', async () => {
      settingsService.getSecuritySettings.mockRejectedValue(new Error('DB unavailable'));

      await expect(controller.getSecuritySettings()).rejects.toThrow('DB unavailable');
    });

    it('should propagate error when updateSecuritySettings throws', async () => {
      settingsService.updateSecuritySettings.mockRejectedValue(new Error('Validation failed'));

      await expect(
        controller.updateSecuritySettings({ allowLocalNetworkWithoutAuth: true })
      ).rejects.toThrow('Validation failed');
    });

    it('should propagate error when getEnvironmentInfo throws', async () => {
      environmentService.getEnvironmentInfo.mockRejectedValue(
        new Error('Environment detection failed')
      );

      await expect(controller.getEnvironmentInfo()).rejects.toThrow('Environment detection failed');
    });

    it('should propagate error when updateJellyfinSettings throws', async () => {
      settingsService.updateJellyfinSettings.mockRejectedValue(new Error('Invalid Jellyfin URL'));

      await expect(controller.updateJellyfinSettings({ jellyfinUrl: 'bad-url' })).rejects.toThrow(
        'Invalid Jellyfin URL'
      );
    });
  });
});
