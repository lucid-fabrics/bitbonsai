import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { SecuritySettingsDto } from './dto/security-settings.dto';

/**
 * Settings Service
 *
 * Handles system-wide settings including security configuration.
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
}
