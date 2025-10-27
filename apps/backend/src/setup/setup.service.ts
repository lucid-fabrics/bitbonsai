import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import type { InitializeSetupDto } from './dto/initialize-setup.dto';
import type { SetupStatusDto } from './dto/setup-status.dto';

/**
 * Setup Service
 *
 * Handles first-time setup detection and initialization.
 * Ensures the system can only be initialized once by checking for existing users.
 */
@Injectable()
export class SetupService {
  // Security: bcrypt rounds (10 is recommended for production)
  private readonly BCRYPT_ROUNDS = 10;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if the initial setup has been completed
   *
   * Uses a combined check for reliability and recovery:
   * 1. If no users exist → setup is NOT complete (recovery mode, even if flag says true)
   * 2. If users exist → check the explicit flag
   *
   * This approach prevents lockout if all users are accidentally deleted.
   *
   * @returns Setup status indicating if setup is complete
   */
  async getSetupStatus(): Promise<SetupStatusDto> {
    const userCount = await this.prisma.user.count();

    // RECOVERY MODE: If no users exist, setup is NOT complete
    // This allows recovery even if the flag says setup is done
    if (userCount === 0) {
      return {
        isSetupComplete: false,
      };
    }

    // Normal mode: Check the explicit flag
    const settings = await this.prisma.settings.findFirst();

    return {
      isSetupComplete: settings?.isSetupComplete ?? false,
    };
  }

  /**
   * Initialize the system with the first admin user
   *
   * SECURITY FEATURES:
   * - Only allows initialization if no users exist (prevents re-initialization)
   * - Hashes password using bcrypt (10 rounds)
   * - Creates admin user with ADMIN role
   * - Updates security settings based on user preference
   *
   * @param dto Setup initialization data
   * @returns Success message
   * @throws BadRequestException if setup has already been completed
   */
  async initializeSetup(dto: InitializeSetupDto): Promise<{ message: string }> {
    // Check if setup has already been completed
    const userCount = await this.prisma.user.count();

    if (userCount > 0) {
      throw new BadRequestException('Setup has already been completed');
    }

    // Hash password using bcrypt
    const passwordHash = await bcrypt.hash(dto.password, this.BCRYPT_ROUNDS);

    // Create first admin user
    // Note: Using username as email since email is required in schema
    // This can be updated later through user management
    await this.prisma.user.create({
      data: {
        username: dto.username,
        email: `${dto.username}@local.bitbonsai`,
        passwordHash,
        role: 'ADMIN',
        isActive: true,
      },
    });

    // Update or create security settings and mark setup as complete
    const existingSettings = await this.prisma.settings.findFirst();

    if (existingSettings) {
      await this.prisma.settings.update({
        where: { id: existingSettings.id },
        data: {
          isSetupComplete: true,
          allowLocalNetworkWithoutAuth: dto.allowLocalNetworkWithoutAuth,
        },
      });
    } else {
      await this.prisma.settings.create({
        data: {
          isSetupComplete: true,
          allowLocalNetworkWithoutAuth: dto.allowLocalNetworkWithoutAuth,
        },
      });
    }

    return {
      message: 'Setup completed successfully',
    };
  }

  /**
   * Reset setup to allow first-time setup wizard to run again
   *
   * ⚠️ DEVELOPMENT ONLY - This method should only be called in development mode
   *
   * Actions performed:
   * - Deletes all users from the database
   * - Sets isSetupComplete flag to false
   * - Preserves other settings (like security preferences)
   *
   * @returns Success message
   * @throws Error if called in production environment
   */
  async resetSetup(): Promise<{ message: string }> {
    // Safety check: Only allow in development
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Reset setup is not allowed in production');
    }

    // Delete all users
    await this.prisma.user.deleteMany({});

    // Reset setup complete flag
    const settings = await this.prisma.settings.findFirst();
    if (settings) {
      await this.prisma.settings.update({
        where: { id: settings.id },
        data: { isSetupComplete: false },
      });
    }

    return {
      message: 'Setup reset successfully. You can now run first-time setup again.',
    };
  }
}
