import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { DefaultQueueViewDto } from './dto/default-queue-view.dto';
import type { ReadyFilesCacheTtlDto } from './dto/ready-files-cache-ttl.dto';
import type { SecuritySettingsDto } from './dto/security-settings.dto';

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
   */
  async getSecuritySettings(): Promise<SecuritySettingsDto> {
    let settings = await this.prisma.settings.findFirst();

    // Create default settings if they don't exist
    if (!settings) {
      settings = await this.prisma.settings.create({
        data: {
          allowLocalNetworkWithoutAuth: false,
        },
      });
    }

    return {
      allowLocalNetworkWithoutAuth: settings.allowLocalNetworkWithoutAuth,
    };
  }

  /**
   * Update security settings
   *
   * Updates the security settings and returns the updated values
   */
  async updateSecuritySettings(dto: SecuritySettingsDto): Promise<SecuritySettingsDto> {
    // Get existing settings or create if doesn't exist
    let settings = await this.prisma.settings.findFirst();

    if (!settings) {
      settings = await this.prisma.settings.create({
        data: {
          allowLocalNetworkWithoutAuth: dto.allowLocalNetworkWithoutAuth,
        },
      });
    } else {
      settings = await this.prisma.settings.update({
        where: { id: settings.id },
        data: {
          allowLocalNetworkWithoutAuth: dto.allowLocalNetworkWithoutAuth,
        },
      });
    }

    return {
      allowLocalNetworkWithoutAuth: settings.allowLocalNetworkWithoutAuth,
    };
  }

  /**
   * Get default queue view preference
   *
   * Returns the user's preferred default queue filter view (ENCODING, QUEUED, COMPLETED, etc.)
   */
  async getDefaultQueueView(): Promise<DefaultQueueViewDto> {
    let settings = await this.prisma.settings.findFirst();

    // Create default settings if they don't exist
    if (!settings) {
      settings = await this.prisma.settings.create({
        data: {
          defaultQueueView: 'ENCODING',
        },
      });
    }

    return {
      defaultQueueView: settings.defaultQueueView,
    };
  }

  /**
   * Update default queue view preference
   *
   * Updates the user's preferred default queue filter view
   */
  async updateDefaultQueueView(dto: DefaultQueueViewDto): Promise<DefaultQueueViewDto> {
    // Get existing settings or create if doesn't exist
    let settings = await this.prisma.settings.findFirst();

    if (!settings) {
      settings = await this.prisma.settings.create({
        data: {
          defaultQueueView: dto.defaultQueueView,
        },
      });
    } else {
      settings = await this.prisma.settings.update({
        where: { id: settings.id },
        data: {
          defaultQueueView: dto.defaultQueueView,
        },
      });
    }

    return {
      defaultQueueView: settings.defaultQueueView,
    };
  }

  /**
   * Get ready files cache TTL setting
   *
   * Returns the current cache TTL in minutes for the /api/v1/libraries/ready endpoint
   */
  async getReadyFilesCacheTtl(): Promise<ReadyFilesCacheTtlDto> {
    let settings = await this.prisma.settings.findFirst();

    // Create default settings if they don't exist
    if (!settings) {
      settings = await this.prisma.settings.create({
        data: {
          readyFilesCacheTtlMinutes: 5,
        },
      });
    }

    return {
      readyFilesCacheTtlMinutes: settings.readyFilesCacheTtlMinutes,
    };
  }

  /**
   * Update ready files cache TTL setting
   *
   * Updates the cache TTL in minutes for the /api/v1/libraries/ready endpoint
   * Minimum value is 5 minutes to prevent excessive file system scans
   */
  async updateReadyFilesCacheTtl(ttlMinutes: number): Promise<ReadyFilesCacheTtlDto> {
    // Validate minimum TTL
    if (ttlMinutes < 5) {
      throw new BadRequestException('Cache TTL must be at least 5 minutes');
    }

    // Get existing settings or create if doesn't exist
    let settings = await this.prisma.settings.findFirst();

    if (!settings) {
      settings = await this.prisma.settings.create({
        data: {
          readyFilesCacheTtlMinutes: ttlMinutes,
        },
      });
    } else {
      settings = await this.prisma.settings.update({
        where: { id: settings.id },
        data: {
          readyFilesCacheTtlMinutes: ttlMinutes,
        },
      });
    }

    return {
      readyFilesCacheTtlMinutes: settings.readyFilesCacheTtlMinutes,
    };
  }
}
