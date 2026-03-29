import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
// eslint-disable-next-line @nx/enforce-module-boundaries -- package.json version needed at runtime
import { version } from '../../../../package.json';
import { PrismaService } from '../prisma/prisma.service';
import { InitializeSetupDto, NodeType } from './dto/initialize-setup.dto';
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
   * 1. For MAIN nodes: If no users exist → setup is NOT complete (recovery mode)
   * 2. For LINKED (child) nodes: Skip user check, they don't need users
   * 3. Otherwise → check the explicit flag
   *
   * This approach prevents lockout if all users are accidentally deleted on MAIN nodes,
   * while allowing child nodes to function without users.
   *
   * @returns Setup status indicating if setup is complete
   */
  async getSetupStatus(): Promise<SetupStatusDto> {
    // Check if this is a LINKED (child) node
    const linkedNode = await this.prisma.node.findFirst({
      where: { role: 'LINKED' },
    });

    // For child nodes, skip user check and just return the flag
    if (linkedNode) {
      const settings = await this.prisma.settings.findFirst();
      return {
        isSetupComplete: settings?.isSetupComplete ?? false,
      };
    }

    // For MAIN nodes: RECOVERY MODE if no users exist
    const userCount = await this.prisma.user.count();

    // RECOVERY MODE: If no users exist on MAIN node, setup is NOT complete
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
   * Initialize the system with the first admin user (main node) or generate pairing token (child node)
   *
   * SECURITY FEATURES:
   * - Only allows initialization if no users exist (prevents re-initialization)
   * - For main nodes: Hashes password using bcrypt (10 rounds), creates admin user with ADMIN role
   * - For child nodes: Generates pairing token for pairing with main node
   * - Updates security settings based on user preference
   *
   * @param dto Setup initialization data
   * @returns Success message and optional pairing token for child nodes
   * @throws BadRequestException if setup has already been completed or validation fails
   */
  async initializeSetup(
    dto: InitializeSetupDto
  ): Promise<{ message: string; pairingToken?: string }> {
    // Check if setup has already been completed
    const userCount = await this.prisma.user.count();

    if (userCount > 0) {
      throw new BadRequestException('Setup has already been completed');
    }

    // Default to main node if not specified
    const nodeType = dto.nodeType || NodeType.Main;

    // Validate required fields for main node
    if (nodeType === NodeType.Main) {
      if (!dto.username || !dto.password) {
        throw new BadRequestException('Username and password are required for main node setup');
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
    }

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

    // Find or create a license
    let license = await this.prisma.license.findFirst();

    if (!license) {
      // Create a FREE license if none exists
      license = await this.prisma.license.create({
        data: {
          key: `FREE-${this.generateRandomString(10)}`,
          tier: 'FREE',
          status: 'ACTIVE',
          email:
            nodeType === NodeType.Main
              ? dto.username
                ? `${dto.username}@local.bitbonsai`
                : 'admin@bitbonsai.local'
              : 'child-node@bitbonsai.local',
          maxNodes: 1,
          maxConcurrentJobs: 2,
          features: {
            multiNode: false,
            advancedPresets: false,
            api: false,
            priorityQueue: false,
            cloudStorage: false,
            webhooks: false,
          },
        },
      });
    }

    // Create node entry for both MAIN and CHILD nodes
    if (nodeType === NodeType.Main) {
      // Create a MAIN node entry
      const hostname = process.env.HOSTNAME || 'main-node';
      const apiKey = `bb_${this.generateRandomString(64)}`;
      const pairingToken = (100000 + require('crypto').randomInt(900000)).toString(); // 6-digit token

      await this.prisma.node.create({
        data: {
          name: `Main Node (${hostname})`,
          role: 'MAIN',
          status: 'ONLINE',
          version, // Read from package.json
          acceleration: 'CPU', // Will be updated after hardware detection
          apiKey,
          pairingToken,
          pairingExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
          lastHeartbeat: new Date(),
          licenseId: license.id,
        },
      });

      return {
        message: 'Setup completed successfully',
      };
    }

    // For child nodes, create a LINKED node entry to mark this as a child node instance
    if (nodeType === NodeType.Child) {
      // Create a LINKED node entry (represents this child node)
      const hostname = process.env.HOSTNAME || 'child-node';
      await this.prisma.node.create({
        data: {
          name: `Child Node (${hostname})`,
          role: 'LINKED',
          status: 'ONLINE',
          version, // Read from package.json
          acceleration: 'CPU', // Will be updated after hardware detection
          apiKey: this.generateRandomString(32),
          lastHeartbeat: new Date(),
          licenseId: license.id,
          mainNodeUrl: dto.mainNodeUrl, // Save main node URL for unregistration
        },
      });

      const pairingToken = this.generatePairingToken();
      return {
        message: 'Child node setup completed. Use the pairing token to connect to a main node.',
        pairingToken,
      };
    }

    return {
      message: 'Setup completed successfully',
    };
  }

  /**
   * Generate a secure pairing token for child node registration
   *
   * @returns Pairing token string
   */
  private generatePairingToken(): string {
    // Generate a random 8-character token
    const randomPart = require('crypto')
      .randomBytes(6)
      .toString('hex')
      .substring(0, 8)
      .toUpperCase();
    return `BITBONSAI-${randomPart}`;
  }

  /**
   * Generate a random alphanumeric string
   *
   * @param length Length of the string to generate
   * @returns Random string
   */
  private generateRandomString(length: number): string {
    // Use crypto.randomBytes for cryptographically secure random strings
    return require('crypto')
      .randomBytes(Math.ceil((length * 3) / 4))
      .toString('base64')
      .slice(0, length);
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
