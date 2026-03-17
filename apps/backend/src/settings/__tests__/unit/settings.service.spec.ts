import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { SettingsService } from '../../settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let mockTx: Record<string, Record<string, jest.Mock>>;

  /**
   * Creates a mock transaction context with settings model methods.
   * The $transaction mock calls the provided function with this context.
   */
  function createMockTx() {
    return {
      settings: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
  }

  /** Base settings record returned by Prisma */
  function createSettingsRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: 'settings-1',
      isSetupComplete: true,
      allowLocalNetworkWithoutAuth: false,
      defaultQueueView: 'ENCODING',
      readyFilesCacheTtlMinutes: 5,
      maxAutoHealRetries: 15,
      advancedModeEnabled: false,
      jellyfinUrl: null,
      jellyfinApiKey: null,
      jellyfinRefreshOnComplete: true,
      jobStuckThresholdMinutes: 5,
      jobEncodingTimeoutHours: 2,
      recoveryIntervalMs: 120000,
      healthCheckTimeoutMin: 5,
      encodingTimeoutMin: 10,
      verifyingTimeoutMin: 30,
      healthCheckConcurrency: 10,
      healthCheckIntervalMs: 2000,
      maxRetryAttempts: 3,
      backupCleanupIntervalMs: 3600000,
      backupRetentionHours: 24,
      ...overrides,
    };
  }

  beforeEach(async () => {
    mockTx = createMockTx();

    const mockPrisma = {
      $transaction: jest
        .fn()
        .mockImplementation((fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
      settings: {
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SettingsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==========================================================================
  // SECURITY SETTINGS
  // ==========================================================================
  describe('getSecuritySettings', () => {
    it('should return existing security settings', async () => {
      const existing = createSettingsRecord({ allowLocalNetworkWithoutAuth: true });
      mockTx.settings.findFirst.mockResolvedValue(existing);

      const result = await service.getSecuritySettings();

      expect(result).toEqual({ allowLocalNetworkWithoutAuth: true });
      expect(mockTx.settings.create).not.toHaveBeenCalled();
    });

    it('should create default settings when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue(
        createSettingsRecord({ allowLocalNetworkWithoutAuth: false })
      );

      const result = await service.getSecuritySettings();

      expect(result).toEqual({ allowLocalNetworkWithoutAuth: false });
      expect(mockTx.settings.create).toHaveBeenCalledWith({
        data: { allowLocalNetworkWithoutAuth: false },
      });
    });
  });

  describe('updateSecuritySettings', () => {
    it('should update existing security settings', async () => {
      const existing = createSettingsRecord();
      mockTx.settings.findFirst.mockResolvedValue(existing);
      mockTx.settings.update.mockResolvedValue(
        createSettingsRecord({ allowLocalNetworkWithoutAuth: true })
      );

      const result = await service.updateSecuritySettings({
        allowLocalNetworkWithoutAuth: true,
      });

      expect(result).toEqual({ allowLocalNetworkWithoutAuth: true });
      expect(mockTx.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: { allowLocalNetworkWithoutAuth: true },
      });
    });

    it('should create settings when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue(
        createSettingsRecord({ allowLocalNetworkWithoutAuth: true })
      );

      const result = await service.updateSecuritySettings({
        allowLocalNetworkWithoutAuth: true,
      });

      expect(result).toEqual({ allowLocalNetworkWithoutAuth: true });
      expect(mockTx.settings.create).toHaveBeenCalledWith({
        data: { allowLocalNetworkWithoutAuth: true },
      });
    });
  });

  // ==========================================================================
  // DEFAULT QUEUE VIEW
  // ==========================================================================
  describe('getDefaultQueueView', () => {
    it('should return existing default queue view', async () => {
      const existing = createSettingsRecord({ defaultQueueView: 'COMPLETED' });
      mockTx.settings.findFirst.mockResolvedValue(existing);

      const result = await service.getDefaultQueueView();

      expect(result).toEqual({ defaultQueueView: 'COMPLETED' });
    });

    it('should create default settings with ENCODING view when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue(
        createSettingsRecord({ defaultQueueView: 'ENCODING' })
      );

      const result = await service.getDefaultQueueView();

      expect(result).toEqual({ defaultQueueView: 'ENCODING' });
      expect(mockTx.settings.create).toHaveBeenCalledWith({
        data: { defaultQueueView: 'ENCODING' },
      });
    });
  });

  describe('updateDefaultQueueView', () => {
    it('should update existing queue view', async () => {
      const existing = createSettingsRecord();
      mockTx.settings.findFirst.mockResolvedValue(existing);
      mockTx.settings.update.mockResolvedValue(
        createSettingsRecord({ defaultQueueView: 'FAILED' })
      );

      const result = await service.updateDefaultQueueView({ defaultQueueView: 'FAILED' });

      expect(result).toEqual({ defaultQueueView: 'FAILED' });
      expect(mockTx.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: { defaultQueueView: 'FAILED' },
      });
    });

    it('should create settings with specified queue view when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue(createSettingsRecord({ defaultQueueView: 'ALL' }));

      const result = await service.updateDefaultQueueView({ defaultQueueView: 'ALL' });

      expect(result).toEqual({ defaultQueueView: 'ALL' });
      expect(mockTx.settings.create).toHaveBeenCalledWith({
        data: { defaultQueueView: 'ALL' },
      });
    });
  });

  // ==========================================================================
  // READY FILES CACHE TTL
  // ==========================================================================
  describe('getReadyFilesCacheTtl', () => {
    it('should return existing cache TTL', async () => {
      const existing = createSettingsRecord({ readyFilesCacheTtlMinutes: 30 });
      mockTx.settings.findFirst.mockResolvedValue(existing);

      const result = await service.getReadyFilesCacheTtl();

      expect(result).toEqual({ readyFilesCacheTtlMinutes: 30 });
    });

    it('should create default settings with 5-minute TTL when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue(
        createSettingsRecord({ readyFilesCacheTtlMinutes: 5 })
      );

      const result = await service.getReadyFilesCacheTtl();

      expect(result).toEqual({ readyFilesCacheTtlMinutes: 5 });
      expect(mockTx.settings.create).toHaveBeenCalledWith({
        data: { readyFilesCacheTtlMinutes: 5 },
      });
    });
  });

  describe('updateReadyFilesCacheTtl', () => {
    it('should update existing cache TTL', async () => {
      const existing = createSettingsRecord();
      mockTx.settings.findFirst.mockResolvedValue(existing);
      mockTx.settings.update.mockResolvedValue(
        createSettingsRecord({ readyFilesCacheTtlMinutes: 60 })
      );

      const result = await service.updateReadyFilesCacheTtl(60);

      expect(result).toEqual({ readyFilesCacheTtlMinutes: 60 });
      expect(mockTx.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: { readyFilesCacheTtlMinutes: 60 },
      });
    });

    it('should create settings when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue(
        createSettingsRecord({ readyFilesCacheTtlMinutes: 10 })
      );

      const result = await service.updateReadyFilesCacheTtl(10);

      expect(result).toEqual({ readyFilesCacheTtlMinutes: 10 });
      expect(mockTx.settings.create).toHaveBeenCalledWith({
        data: { readyFilesCacheTtlMinutes: 10 },
      });
    });

    it('should throw BadRequestException when TTL is less than 5', async () => {
      await expect(service.updateReadyFilesCacheTtl(4)).rejects.toThrow(BadRequestException);
      await expect(service.updateReadyFilesCacheTtl(0)).rejects.toThrow(
        'Cache TTL must be at least 5 minutes'
      );
    });

    it('should accept exactly 5 minutes as minimum valid TTL', async () => {
      const existing = createSettingsRecord();
      mockTx.settings.findFirst.mockResolvedValue(existing);
      mockTx.settings.update.mockResolvedValue(
        createSettingsRecord({ readyFilesCacheTtlMinutes: 5 })
      );

      const result = await service.updateReadyFilesCacheTtl(5);

      expect(result).toEqual({ readyFilesCacheTtlMinutes: 5 });
    });
  });

  // ==========================================================================
  // AUTO-HEAL RETRY LIMIT
  // ==========================================================================
  describe('getAutoHealRetryLimit', () => {
    it('should return existing auto-heal retry limit', async () => {
      const existing = createSettingsRecord({ maxAutoHealRetries: 20 });
      mockTx.settings.findFirst.mockResolvedValue(existing);

      const result = await service.getAutoHealRetryLimit();

      expect(result).toEqual({ maxAutoHealRetries: 20 });
    });

    it('should create default settings with limit of 15 when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue(createSettingsRecord({ maxAutoHealRetries: 15 }));

      const result = await service.getAutoHealRetryLimit();

      expect(result).toEqual({ maxAutoHealRetries: 15 });
      expect(mockTx.settings.create).toHaveBeenCalledWith({
        data: { maxAutoHealRetries: 15 },
      });
    });
  });

  describe('updateAutoHealRetryLimit', () => {
    it('should update existing retry limit', async () => {
      const existing = createSettingsRecord();
      mockTx.settings.findFirst.mockResolvedValue(existing);
      mockTx.settings.update.mockResolvedValue(createSettingsRecord({ maxAutoHealRetries: 25 }));

      const result = await service.updateAutoHealRetryLimit(25);

      expect(result).toEqual({ maxAutoHealRetries: 25 });
      expect(mockTx.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: { maxAutoHealRetries: 25 },
      });
    });

    it('should create settings when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue(createSettingsRecord({ maxAutoHealRetries: 10 }));

      const result = await service.updateAutoHealRetryLimit(10);

      expect(result).toEqual({ maxAutoHealRetries: 10 });
      expect(mockTx.settings.create).toHaveBeenCalledWith({
        data: { maxAutoHealRetries: 10 },
      });
    });

    it('should throw BadRequestException when retry limit is less than 3', async () => {
      await expect(service.updateAutoHealRetryLimit(2)).rejects.toThrow(BadRequestException);
      await expect(service.updateAutoHealRetryLimit(0)).rejects.toThrow(
        'Auto-heal retry limit must be at least 3'
      );
    });

    it('should accept exactly 3 as minimum valid retry limit', async () => {
      const existing = createSettingsRecord();
      mockTx.settings.findFirst.mockResolvedValue(existing);
      mockTx.settings.update.mockResolvedValue(createSettingsRecord({ maxAutoHealRetries: 3 }));

      const result = await service.updateAutoHealRetryLimit(3);

      expect(result).toEqual({ maxAutoHealRetries: 3 });
    });
  });

  // ==========================================================================
  // ADVANCED MODE
  // ==========================================================================
  describe('getAdvancedMode', () => {
    it('should return existing advanced mode setting', async () => {
      const existing = createSettingsRecord({ advancedModeEnabled: true });
      mockTx.settings.findFirst.mockResolvedValue(existing);

      const result = await service.getAdvancedMode();

      expect(result).toEqual({ advancedModeEnabled: true });
    });

    it('should create default settings with advanced mode disabled when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue(
        createSettingsRecord({ advancedModeEnabled: false })
      );

      const result = await service.getAdvancedMode();

      expect(result).toEqual({ advancedModeEnabled: false });
      expect(mockTx.settings.create).toHaveBeenCalledWith({
        data: { advancedModeEnabled: false },
      });
    });
  });

  describe('updateAdvancedMode', () => {
    it('should enable advanced mode', async () => {
      const existing = createSettingsRecord();
      mockTx.settings.findFirst.mockResolvedValue(existing);
      mockTx.settings.update.mockResolvedValue(createSettingsRecord({ advancedModeEnabled: true }));

      const result = await service.updateAdvancedMode(true);

      expect(result).toEqual({ advancedModeEnabled: true });
      expect(mockTx.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: { advancedModeEnabled: true },
      });
    });

    it('should disable advanced mode', async () => {
      const existing = createSettingsRecord({ advancedModeEnabled: true });
      mockTx.settings.findFirst.mockResolvedValue(existing);
      mockTx.settings.update.mockResolvedValue(
        createSettingsRecord({ advancedModeEnabled: false })
      );

      const result = await service.updateAdvancedMode(false);

      expect(result).toEqual({ advancedModeEnabled: false });
    });

    it('should create settings when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue(createSettingsRecord({ advancedModeEnabled: true }));

      const result = await service.updateAdvancedMode(true);

      expect(result).toEqual({ advancedModeEnabled: true });
      expect(mockTx.settings.create).toHaveBeenCalledWith({
        data: { advancedModeEnabled: true },
      });
    });
  });

  // ==========================================================================
  // JELLYFIN SETTINGS
  // ==========================================================================
  describe('getJellyfinSettings', () => {
    it('should return Jellyfin settings with masked API key', async () => {
      const existing = createSettingsRecord({
        jellyfinUrl: 'http://192.168.1.100:8096',
        jellyfinApiKey: 'secret-api-key-123',
        jellyfinRefreshOnComplete: true,
      });
      mockTx.settings.findFirst.mockResolvedValue(existing);

      const result = await service.getJellyfinSettings();

      expect(result).toEqual({
        jellyfinUrl: 'http://192.168.1.100:8096',
        jellyfinApiKey: '••••••••',
        jellyfinRefreshOnComplete: true,
      });
    });

    it('should return null for empty Jellyfin settings', async () => {
      const existing = createSettingsRecord({
        jellyfinUrl: null,
        jellyfinApiKey: null,
        jellyfinRefreshOnComplete: true,
      });
      mockTx.settings.findFirst.mockResolvedValue(existing);

      const result = await service.getJellyfinSettings();

      expect(result).toEqual({
        jellyfinUrl: null,
        jellyfinApiKey: null,
        jellyfinRefreshOnComplete: true,
      });
    });

    it('should create default settings when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue(createSettingsRecord());

      const result = await service.getJellyfinSettings();

      expect(result.jellyfinUrl).toBeNull();
      expect(result.jellyfinApiKey).toBeNull();
      expect(result.jellyfinRefreshOnComplete).toBe(true);
    });

    it('should default jellyfinRefreshOnComplete to true when undefined', async () => {
      const existing = createSettingsRecord({
        jellyfinRefreshOnComplete: undefined,
      });
      mockTx.settings.findFirst.mockResolvedValue(existing);

      const result = await service.getJellyfinSettings();

      expect(result.jellyfinRefreshOnComplete).toBe(true);
    });

    it('should return null for empty string URL', async () => {
      const existing = createSettingsRecord({
        jellyfinUrl: '',
        jellyfinApiKey: '',
      });
      mockTx.settings.findFirst.mockResolvedValue(existing);

      const result = await service.getJellyfinSettings();

      expect(result.jellyfinUrl).toBeNull();
      expect(result.jellyfinApiKey).toBeNull();
    });
  });

  describe('getUnmaskedJellyfinApiKey', () => {
    let prisma: { settings: { findFirst: jest.Mock }; $transaction: jest.Mock };

    beforeEach(async () => {
      prisma = {
        settings: { findFirst: jest.fn() },
        $transaction: jest
          .fn()
          .mockImplementation((fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [SettingsService, { provide: PrismaService, useValue: prisma }],
      }).compile();

      service = module.get<SettingsService>(SettingsService);
    });

    it('should return the actual API key unmasked', async () => {
      prisma.settings.findFirst.mockResolvedValue(
        createSettingsRecord({ jellyfinApiKey: 'real-secret-key' })
      );

      const result = await service.getUnmaskedJellyfinApiKey();

      expect(result).toBe('real-secret-key');
    });

    it('should return null when no settings exist', async () => {
      prisma.settings.findFirst.mockResolvedValue(null);

      const result = await service.getUnmaskedJellyfinApiKey();

      expect(result).toBeNull();
    });

    it('should return null when API key is empty', async () => {
      prisma.settings.findFirst.mockResolvedValue(createSettingsRecord({ jellyfinApiKey: '' }));

      const result = await service.getUnmaskedJellyfinApiKey();

      expect(result).toBeNull();
    });
  });

  describe('updateJellyfinSettings', () => {
    it('should update URL, API key, and refresh setting', async () => {
      const existing = createSettingsRecord();
      mockTx.settings.findFirst.mockResolvedValue(existing);
      mockTx.settings.update.mockResolvedValue(
        createSettingsRecord({
          jellyfinUrl: 'http://jellyfin.local:8096',
          jellyfinApiKey: 'new-key',
          jellyfinRefreshOnComplete: false,
        })
      );

      const result = await service.updateJellyfinSettings({
        jellyfinUrl: 'http://jellyfin.local:8096',
        jellyfinApiKey: 'new-key',
        jellyfinRefreshOnComplete: false,
      });

      expect(result.jellyfinUrl).toBe('http://jellyfin.local:8096');
      expect(result.jellyfinApiKey).toBe('••••••••');
      expect(result.jellyfinRefreshOnComplete).toBe(false);
    });

    it('should only update provided fields', async () => {
      const existing = createSettingsRecord();
      mockTx.settings.findFirst.mockResolvedValue(existing);
      mockTx.settings.update.mockResolvedValue(
        createSettingsRecord({ jellyfinUrl: 'http://new-url:8096' })
      );

      await service.updateJellyfinSettings({
        jellyfinUrl: 'http://new-url:8096',
      });

      expect(mockTx.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: { jellyfinUrl: 'http://new-url:8096' },
      });
    });

    it('should set null when empty string URL provided', async () => {
      const existing = createSettingsRecord();
      mockTx.settings.findFirst.mockResolvedValue(existing);
      mockTx.settings.update.mockResolvedValue(createSettingsRecord({ jellyfinUrl: null }));

      await service.updateJellyfinSettings({ jellyfinUrl: '' });

      expect(mockTx.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: { jellyfinUrl: null },
      });
    });

    it('should create settings when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue(
        createSettingsRecord({
          jellyfinUrl: 'http://jf:8096',
          jellyfinApiKey: 'key',
        })
      );

      const result = await service.updateJellyfinSettings({
        jellyfinUrl: 'http://jf:8096',
        jellyfinApiKey: 'key',
      });

      expect(result.jellyfinUrl).toBe('http://jf:8096');
      expect(result.jellyfinApiKey).toBe('••••••••');
    });

    it('should skip undefined fields in update data', async () => {
      const existing = createSettingsRecord();
      mockTx.settings.findFirst.mockResolvedValue(existing);
      mockTx.settings.update.mockResolvedValue(
        createSettingsRecord({ jellyfinRefreshOnComplete: false })
      );

      await service.updateJellyfinSettings({
        jellyfinRefreshOnComplete: false,
      });

      // Only jellyfinRefreshOnComplete should be in updateData
      expect(mockTx.settings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: { jellyfinRefreshOnComplete: false },
      });
    });

    it('should handle jellyfinRefreshOnComplete undefined in response', async () => {
      const existing = createSettingsRecord();
      mockTx.settings.findFirst.mockResolvedValue(existing);
      mockTx.settings.update.mockResolvedValue(
        createSettingsRecord({ jellyfinRefreshOnComplete: undefined })
      );

      const result = await service.updateJellyfinSettings({
        jellyfinUrl: 'http://jf:8096',
      });

      // Should default to true via ?? operator
      expect(result.jellyfinRefreshOnComplete).toBe(true);
    });
  });

  // ==========================================================================
  // OPERATIONAL SETTINGS
  // ==========================================================================
  describe('getOperationalSettings', () => {
    it('should return all operational settings from DB', async () => {
      const existing = createSettingsRecord({
        jobStuckThresholdMinutes: 10,
        jobEncodingTimeoutHours: 4,
        recoveryIntervalMs: 240000,
        healthCheckTimeoutMin: 10,
        encodingTimeoutMin: 20,
        verifyingTimeoutMin: 60,
        healthCheckConcurrency: 20,
        healthCheckIntervalMs: 4000,
        maxRetryAttempts: 5,
        backupCleanupIntervalMs: 7200000,
        backupRetentionHours: 48,
      });
      mockTx.settings.findFirst.mockResolvedValue(existing);

      const result = await service.getOperationalSettings();

      expect(result).toEqual({
        jobStuckThresholdMinutes: 10,
        jobEncodingTimeoutHours: 4,
        recoveryIntervalMs: 240000,
        healthCheckTimeoutMin: 10,
        encodingTimeoutMin: 20,
        verifyingTimeoutMin: 60,
        healthCheckConcurrency: 20,
        healthCheckIntervalMs: 4000,
        maxRetryAttempts: 5,
        backupCleanupIntervalMs: 7200000,
        backupRetentionHours: 48,
      });
    });

    it('should use defaults for missing fields', async () => {
      // Simulate minimal settings record without operational fields
      const minimal = { id: 'settings-1' };
      mockTx.settings.findFirst.mockResolvedValue(minimal);

      const result = await service.getOperationalSettings();

      expect(result).toEqual({
        jobStuckThresholdMinutes: 5,
        jobEncodingTimeoutHours: 2,
        recoveryIntervalMs: 120000,
        healthCheckTimeoutMin: 5,
        encodingTimeoutMin: 10,
        verifyingTimeoutMin: 30,
        healthCheckConcurrency: 10,
        healthCheckIntervalMs: 2000,
        maxRetryAttempts: 3,
        backupCleanupIntervalMs: 3600000,
        backupRetentionHours: 24,
      });
    });

    it('should create default settings when none exist', async () => {
      mockTx.settings.findFirst.mockResolvedValue(null);
      mockTx.settings.create.mockResolvedValue({ id: 'settings-1' });

      const result = await service.getOperationalSettings();

      expect(mockTx.settings.create).toHaveBeenCalledWith({ data: {} });
      // Should still return defaults
      expect(result.jobStuckThresholdMinutes).toBe(5);
      expect(result.backupRetentionHours).toBe(24);
    });

    it('should use DB value when present and default when null', async () => {
      const partial = {
        id: 'settings-1',
        jobStuckThresholdMinutes: 15,
        // All other fields undefined/missing → should use defaults
      };
      mockTx.settings.findFirst.mockResolvedValue(partial);

      const result = await service.getOperationalSettings();

      expect(result.jobStuckThresholdMinutes).toBe(15);
      expect(result.jobEncodingTimeoutHours).toBe(2); // default
    });
  });
});
