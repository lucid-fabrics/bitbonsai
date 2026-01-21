import { BadRequestException, Injectable } from '@nestjs/common';
import type { SystemSettings } from '../common/interfaces/system-settings.interface';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get security settings
   *
   * Returns the current security settings, or creates default settings if none exist
   * RACE CONDITION FIX: Uses transaction to atomically check and create if needed
   */
  async getSecuritySettings(): Promise<SecuritySettingsDto> {
    const settings = await this.prisma.$transaction(async (tx) => {
      let s = await tx.settings.findFirst();

      // Create default settings if they don't exist
      if (!s) {
        s = await tx.settings.create({
          data: {
            allowLocalNetworkWithoutAuth: false,
          },
        });
      }

      return s;
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
    const settings = await this.prisma.$transaction(async (tx) => {
      // Get existing settings or create if doesn't exist
      let s = await tx.settings.findFirst();

      if (!s) {
        s = await tx.settings.create({
          data: {
            allowLocalNetworkWithoutAuth: dto.allowLocalNetworkWithoutAuth,
          },
        });
      } else {
        s = await tx.settings.update({
          where: { id: s.id },
          data: {
            allowLocalNetworkWithoutAuth: dto.allowLocalNetworkWithoutAuth,
          },
        });
      }

      return s;
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
    const settings = await this.prisma.$transaction(async (tx) => {
      let s = await tx.settings.findFirst();

      // Create default settings if they don't exist
      if (!s) {
        s = await tx.settings.create({
          data: {
            defaultQueueView: 'ENCODING',
          },
        });
      }

      return s;
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
    const settings = await this.prisma.$transaction(async (tx) => {
      // Get existing settings or create if doesn't exist
      let s = await tx.settings.findFirst();

      if (!s) {
        s = await tx.settings.create({
          data: {
            defaultQueueView: dto.defaultQueueView,
          },
        });
      } else {
        s = await tx.settings.update({
          where: { id: s.id },
          data: {
            defaultQueueView: dto.defaultQueueView,
          },
        });
      }

      return s;
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
    const settings = await this.prisma.$transaction(async (tx) => {
      let s = await tx.settings.findFirst();

      // Create default settings if they don't exist
      if (!s) {
        s = await tx.settings.create({
          data: {
            readyFilesCacheTtlMinutes: 5,
          },
        });
      }

      return s;
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

    const settings = await this.prisma.$transaction(async (tx) => {
      // Get existing settings or create if doesn't exist
      let s = await tx.settings.findFirst();

      if (!s) {
        s = await tx.settings.create({
          data: {
            readyFilesCacheTtlMinutes: ttlMinutes,
          },
        });
      } else {
        s = await tx.settings.update({
          where: { id: s.id },
          data: {
            readyFilesCacheTtlMinutes: ttlMinutes,
          },
        });
      }

      return s;
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
    const settings = await this.prisma.$transaction(async (tx) => {
      let s = await tx.settings.findFirst();

      // Create default settings if they don't exist
      if (!s) {
        s = await tx.settings.create({
          data: {
            maxAutoHealRetries: 15,
          },
        });
      }

      return s;
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

    const settings = await this.prisma.$transaction(async (tx) => {
      // Get existing settings or create if doesn't exist
      let s = await tx.settings.findFirst();

      if (!s) {
        s = await tx.settings.create({
          data: {
            maxAutoHealRetries: maxRetries,
          },
        });
      } else {
        s = await tx.settings.update({
          where: { id: s.id },
          data: {
            maxAutoHealRetries: maxRetries,
          },
        });
      }

      return s;
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
    const settings = await this.prisma.$transaction(async (tx) => {
      let s = await tx.settings.findFirst();

      // Create default settings if they don't exist
      if (!s) {
        s = await tx.settings.create({
          data: {
            advancedModeEnabled: false,
          },
        });
      }

      return s;
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
    const settings = await this.prisma.$transaction(async (tx) => {
      // Get existing settings or create if doesn't exist
      let s = await tx.settings.findFirst();

      if (!s) {
        s = await tx.settings.create({
          data: {
            advancedModeEnabled: enabled,
          },
        });
      } else {
        s = await tx.settings.update({
          where: { id: s.id },
          data: {
            advancedModeEnabled: enabled,
          },
        });
      }

      return s;
    });

    return {
      advancedModeEnabled: settings.advancedModeEnabled,
    };
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
    const settings = await this.prisma.$transaction(async (tx) => {
      let s = await tx.settings.findFirst();

      if (!s) {
        s = await tx.settings.create({
          data: {},
        });
      }

      return s;
    });

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
    const settings = await this.prisma.settings.findFirst();
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
    const settings = await this.prisma.$transaction(async (tx) => {
      let s = await tx.settings.findFirst();

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

      if (!s) {
        s = await tx.settings.create({
          data: updateData,
        });
      } else {
        s = await tx.settings.update({
          where: { id: s.id },
          data: updateData,
        });
      }

      return s;
    });

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
    const settings = await this.prisma.$transaction(async (tx) => {
      let s = await tx.settings.findFirst();

      // Create default settings if they don't exist
      if (!s) {
        s = await tx.settings.create({
          data: {},
        });
      }

      return s;
    });

    // Type assertion for new fields that may not be in Prisma client yet
    const s = settings as typeof settings & Partial<OperationalSettings>;

    return {
      // Job cleanup (with fallbacks to defaults)
      jobStuckThresholdMinutes: s.jobStuckThresholdMinutes ?? 5,
      jobEncodingTimeoutHours: s.jobEncodingTimeoutHours ?? 2,
      // Stuck job recovery
      recoveryIntervalMs: s.recoveryIntervalMs ?? 120000,
      healthCheckTimeoutMin: s.healthCheckTimeoutMin ?? 5,
      encodingTimeoutMin: s.encodingTimeoutMin ?? 10,
      verifyingTimeoutMin: s.verifyingTimeoutMin ?? 30,
      // Health check worker
      healthCheckConcurrency: s.healthCheckConcurrency ?? 10,
      healthCheckIntervalMs: s.healthCheckIntervalMs ?? 2000,
      maxRetryAttempts: s.maxRetryAttempts ?? 3,
      // Backup cleanup
      backupCleanupIntervalMs: s.backupCleanupIntervalMs ?? 3600000,
      backupRetentionHours: s.backupRetentionHours ?? 24,
    };
  }
}
