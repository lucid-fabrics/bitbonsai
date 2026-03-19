import { BadRequestException, Injectable } from '@nestjs/common';
import type { SystemSettings } from '../common/interfaces/system-settings.interface';
import { SettingsRepository } from '../common/repositories/settings.repository';
import type { AutoHealRetryLimitDto } from './dto/auto-heal-retry-limit.dto';
import type { DefaultQueueViewDto } from './dto/default-queue-view.dto';
import type { ReadyFilesCacheTtlDto } from './dto/ready-files-cache-ttl.dto';
import type { SecuritySettingsDto } from './dto/security-settings.dto';

/**
 * Operational Settings Interface
 * Contains all timeout and worker configuration settings
 * UX Philosophy: Eliminates env vars, single source of truth in database
 */
export interface OperationalSettings {
  // Job cleanup
  jobStuckThresholdMinutes: number;
  jobEncodingTimeoutHours: number;
  // Stuck job recovery
  recoveryIntervalMs: number;
  healthCheckTimeoutMin: number;
  encodingTimeoutMin: number;
  verifyingTimeoutMin: number;
  // Health check worker
  healthCheckConcurrency: number;
  healthCheckIntervalMs: number;
  maxRetryAttempts: number;
  // Backup cleanup
  backupCleanupIntervalMs: number;
  backupRetentionHours: number;
}

/**
 * Settings Service
 *
 * Handles system-wide settings including security configuration and user preferences.
 * Settings are stored as a singleton record in the database.
 */
@Injectable()
export class SettingsService {
  private static readonly DEFAULT_RECOVERY_INTERVAL_MS = 120000; // 2 minutes
  private static readonly DEFAULT_HEALTH_CHECK_INTERVAL_MS = 2000; // 2 seconds
  private static readonly DEFAULT_BACKUP_CLEANUP_INTERVAL_MS = 3600000; // 1 hour

  constructor(private readonly settingsRepository: SettingsRepository) {}

  /**
   * Get security settings
   *
   * Returns the current security settings, or creates default settings if none exist
   * RACE CONDITION FIX: Uses transaction to atomically check and create if needed
   */
  async getSecuritySettings(): Promise<SecuritySettingsDto> {
    const settings = await this.settingsRepository.findOrCreateWithDefaults({
      allowLocalNetworkWithoutAuth: false,
    });

    return {
      allowLocalNetworkWithoutAuth: settings.allowLocalNetworkWithoutAuth,
    };
  }

  /**
   * Update security settings
   *
   * Updates the security settings and returns the updated values
   * RACE CONDITION FIX: Uses transaction to atomically check and create/update
   */
  async updateSecuritySettings(dto: SecuritySettingsDto): Promise<SecuritySettingsDto> {
    const settings = await this.settingsRepository.upsertSettings({
      allowLocalNetworkWithoutAuth: dto.allowLocalNetworkWithoutAuth,
    });

    return {
      allowLocalNetworkWithoutAuth: settings.allowLocalNetworkWithoutAuth,
    };
  }

  /**
   * Get default queue view preference
   *
   * Returns the user's preferred default queue filter view (ENCODING, QUEUED, COMPLETED, etc.)
   * RACE CONDITION FIX: Uses transaction to atomically check and create if needed
   */
  async getDefaultQueueView(): Promise<DefaultQueueViewDto> {
    const settings = await this.settingsRepository.findOrCreateWithDefaults({
      defaultQueueView: 'ENCODING',
    });

    return {
      defaultQueueView: settings.defaultQueueView,
    };
  }

  /**
   * Update default queue view preference
   *
   * Updates the user's preferred default queue filter view
   * RACE CONDITION FIX: Uses transaction to atomically check and create/update
   */
  async updateDefaultQueueView(dto: DefaultQueueViewDto): Promise<DefaultQueueViewDto> {
    const settings = await this.settingsRepository.upsertSettings({
      defaultQueueView: dto.defaultQueueView,
    });

    return {
      defaultQueueView: settings.defaultQueueView,
    };
  }

  /**
   * Get ready files cache TTL setting
   *
   * Returns the current cache TTL in minutes for the /api/v1/libraries/ready endpoint
   * RACE CONDITION FIX: Uses transaction to atomically check and create if needed
   */
  async getReadyFilesCacheTtl(): Promise<ReadyFilesCacheTtlDto> {
    const settings = await this.settingsRepository.findOrCreateWithDefaults({
      readyFilesCacheTtlMinutes: 5,
    });

    return {
      readyFilesCacheTtlMinutes: settings.readyFilesCacheTtlMinutes,
    };
  }

  /**
   * Update ready files cache TTL setting
   *
   * Updates the cache TTL in minutes for the /api/v1/libraries/ready endpoint
   * Minimum value is 5 minutes to prevent excessive file system scans
   * RACE CONDITION FIX: Uses transaction to atomically check and create/update
   */
  async updateReadyFilesCacheTtl(ttlMinutes: number): Promise<ReadyFilesCacheTtlDto> {
    // Validate minimum TTL
    if (ttlMinutes < 5) {
      throw new BadRequestException('Cache TTL must be at least 5 minutes');
    }

    const settings = await this.settingsRepository.upsertSettings({
      readyFilesCacheTtlMinutes: ttlMinutes,
    });

    return {
      readyFilesCacheTtlMinutes: settings.readyFilesCacheTtlMinutes,
    };
  }

  /**
   * Get auto-heal retry limit setting
   *
   * Returns the maximum retry count for auto-heal to resurrect failed jobs.
   * Jobs exceeding this limit will not be automatically healed on backend restart.
   * RACE CONDITION FIX: Uses transaction to atomically check and create if needed
   */
  async getAutoHealRetryLimit(): Promise<AutoHealRetryLimitDto> {
    const settings = await this.settingsRepository.findOrCreateWithDefaults({
      maxAutoHealRetries: 15,
    });

    return {
      maxAutoHealRetries: settings.maxAutoHealRetries,
    };
  }

  /**
   * Update auto-heal retry limit setting
   *
   * Updates the maximum retry count for auto-heal.
   * Minimum value is 3 to prevent overly aggressive auto-healing.
   * RACE CONDITION FIX: Uses transaction to atomically check and create/update
   */
  async updateAutoHealRetryLimit(maxRetries: number): Promise<AutoHealRetryLimitDto> {
    // Validate minimum retry limit
    if (maxRetries < 3) {
      throw new BadRequestException('Auto-heal retry limit must be at least 3');
    }

    const settings = await this.settingsRepository.upsertSettings({
      maxAutoHealRetries: maxRetries,
    });

    return {
      maxAutoHealRetries: settings.maxAutoHealRetries,
    };
  }

  // ============================================================================
  // ADVANCED MODE SETTING (UI Simplification)
  // ============================================================================

  /**
   * Get advanced mode setting
   *
   * Returns whether advanced UI controls should be shown (default: false for minimal UX)
   * RACE CONDITION FIX: Uses transaction to atomically check and create if needed
   */
  async getAdvancedMode(): Promise<{ advancedModeEnabled: boolean }> {
    const settings = await this.settingsRepository.findOrCreateWithDefaults({
      advancedModeEnabled: false,
    });

    return {
      advancedModeEnabled: settings.advancedModeEnabled,
    };
  }

  /**
   * Update advanced mode setting
   *
   * Toggles visibility of advanced UI controls in the queue and other pages
   * RACE CONDITION FIX: Uses transaction to atomically check and create/update
   */
  async updateAdvancedMode(enabled: boolean): Promise<{ advancedModeEnabled: boolean }> {
    const settings = await this.settingsRepository.upsertSettings({
      advancedModeEnabled: enabled,
    });

    return {
      advancedModeEnabled: settings.advancedModeEnabled,
    };
  }

  // ============================================================================
  // QUALITY METRICS SETTING
  // ============================================================================

  async getQualityMetrics(): Promise<{ qualityMetricsEnabled: boolean }> {
    const settings = await this.settingsRepository.findOrCreateWithDefaults({
      qualityMetricsEnabled: false,
    });
    return { qualityMetricsEnabled: settings.qualityMetricsEnabled };
  }

  async updateQualityMetrics(enabled: boolean): Promise<{ qualityMetricsEnabled: boolean }> {
    const settings = await this.settingsRepository.upsertSettings({
      qualityMetricsEnabled: enabled,
    });
    return { qualityMetricsEnabled: settings.qualityMetricsEnabled };
  }

  // ============================================================================
  // JELLYFIN INTEGRATION SETTINGS
  // ============================================================================

  /**
   * Get Jellyfin integration settings
   */
  async getJellyfinSettings(): Promise<{
    jellyfinUrl: string | null;
    jellyfinApiKey: string | null;
    jellyfinRefreshOnComplete: boolean;
  }> {
    const settings = await this.settingsRepository.findOrCreate();

    const s = settings as SystemSettings;

    return {
      jellyfinUrl: s.jellyfinUrl || null,
      jellyfinApiKey: s.jellyfinApiKey ? '••••••••' : null, // Mask API key
      jellyfinRefreshOnComplete: s.jellyfinRefreshOnComplete ?? true,
    };
  }

  /**
   * Get unmasked Jellyfin API key (for internal use only)
   */
  async getUnmaskedJellyfinApiKey(): Promise<string | null> {
    const settings = await this.settingsRepository.findFirst();
    return (settings as SystemSettings | null)?.jellyfinApiKey || null;
  }

  /**
   * Update Jellyfin integration settings
   */
  async updateJellyfinSettings(dto: {
    jellyfinUrl?: string;
    jellyfinApiKey?: string;
    jellyfinRefreshOnComplete?: boolean;
  }): Promise<{
    jellyfinUrl: string | null;
    jellyfinApiKey: string | null;
    jellyfinRefreshOnComplete: boolean;
  }> {
    const updateData: Record<string, unknown> = {};
    if (dto.jellyfinUrl !== undefined) {
      updateData.jellyfinUrl = dto.jellyfinUrl || null;
    }
    if (dto.jellyfinApiKey !== undefined) {
      updateData.jellyfinApiKey = dto.jellyfinApiKey || null;
    }
    if (dto.jellyfinRefreshOnComplete !== undefined) {
      updateData.jellyfinRefreshOnComplete = dto.jellyfinRefreshOnComplete;
    }

    const settings = await this.settingsRepository.upsertSettings(updateData);

    const s = settings as SystemSettings;

    return {
      jellyfinUrl: s.jellyfinUrl || null,
      jellyfinApiKey: s.jellyfinApiKey ? '••••••••' : null,
      jellyfinRefreshOnComplete: s.jellyfinRefreshOnComplete ?? true,
    };
  }

  // ============================================================================
  // OPERATIONAL SETTINGS (eliminates env vars)
  // ============================================================================

  /**
   * Get operational settings
   *
   * Returns timeout and worker configuration settings.
   * Falls back to defaults if settings don't exist.
   * Priority: DB value -> Default (no env var fallback for simplicity)
   */
  async getOperationalSettings(): Promise<OperationalSettings> {
    const settings = await this.settingsRepository.findOrCreate();

    // Type assertion for new fields that may not be in Prisma client yet
    const s = settings as typeof settings & Partial<OperationalSettings>;

    return {
      // Job cleanup (with fallbacks to defaults)
      jobStuckThresholdMinutes: s.jobStuckThresholdMinutes ?? 5,
      jobEncodingTimeoutHours: s.jobEncodingTimeoutHours ?? 2,
      // Stuck job recovery
      recoveryIntervalMs: s.recoveryIntervalMs ?? SettingsService.DEFAULT_RECOVERY_INTERVAL_MS,
      healthCheckTimeoutMin: s.healthCheckTimeoutMin ?? 5,
      encodingTimeoutMin: s.encodingTimeoutMin ?? 10,
      verifyingTimeoutMin: s.verifyingTimeoutMin ?? 30,
      // Health check worker
      healthCheckConcurrency: s.healthCheckConcurrency ?? 10,
      healthCheckIntervalMs:
        s.healthCheckIntervalMs ?? SettingsService.DEFAULT_HEALTH_CHECK_INTERVAL_MS,
      maxRetryAttempts: s.maxRetryAttempts ?? 3,
      // Backup cleanup
      backupCleanupIntervalMs:
        s.backupCleanupIntervalMs ?? SettingsService.DEFAULT_BACKUP_CLEANUP_INTERVAL_MS,
      backupRetentionHours: s.backupRetentionHours ?? 24,
    };
  }
}
