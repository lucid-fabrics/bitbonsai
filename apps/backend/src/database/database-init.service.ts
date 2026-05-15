import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { LicenseStatus, LicenseTier } from '@prisma/client';
// PrismaService is used directly here intentionally: this is a bootstrap/migration
// infrastructure service that must coordinate across License, Settings, and Node models
// in a single initialization pass. Repository abstraction would add no value here.
import { PrismaService } from '../prisma/prisma.service';

/**
 * Database Initialization Service
 *
 * Automatically initializes the database with default data on first startup:
 * - Creates a FREE license if no licenses exist
 * - Creates a MAIN node if no nodes exist
 *
 * This ensures the application works out-of-the-box without manual setup.
 */
@Injectable()
export class DatabaseInitService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseInitService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.initializeDatabase();
  }

  /**
   * Initialize database with default data if empty
   */
  private async initializeDatabase(): Promise<void> {
    try {
      // Check if any license exists
      const licenseCount = await this.prisma.license.count();

      if (licenseCount === 0) {
        // Don't auto-create nodes - let the setup wizard handle it
        // Just create a default license for the setup wizard to use
        this.logger.log('📦 No licenses found. Creating default FREE license...');
        await this.createDefaultLicense();
      } else {
        this.logger.log('✅ Database already initialized');
      }

      // RECOVERY: Ensure MAIN node exists if setup was completed but node is missing
      // This can happen if setup was done before node creation logic was added
      await this.ensureMainNodeExists();
    } catch (error: unknown) {
      this.logger.error('❌ Failed to initialize database:', error);
      // Don't throw - allow app to continue even if initialization fails
    }
  }

  /**
   * Ensure a MAIN node exists if setup is complete
   * This is a recovery mechanism for databases that completed setup before node creation was added
   */
  private async ensureMainNodeExists(): Promise<void> {
    // Check if setup is complete
    const settings = await this.prisma.settings.findFirst();
    if (!settings?.isSetupComplete) {
      return; // Setup not complete, don't create node
    }

    // Check if any node exists
    const nodeCount = await this.prisma.node.count();
    if (nodeCount > 0) {
      return; // Node already exists
    }

    // Find a license to associate with the node
    const license = await this.prisma.license.findFirst();
    if (!license) {
      this.logger.warn('⚠️ Cannot create MAIN node: no license found');
      return;
    }

    this.logger.log('🔧 RECOVERY: Creating missing MAIN node...');

    const hostname = process.env.HOSTNAME || 'main-node';
    const apiKey = `bb_${require('crypto').randomBytes(48).toString('base64').slice(0, 64)}`;
    const pairingToken = (100000 + require('crypto').randomInt(900000)).toString();

    await this.prisma.node.create({
      data: {
        name: `Main Node (${hostname})`,
        role: 'MAIN',
        status: 'ONLINE',
        version: require('../../../../package.json').version,
        acceleration: 'CPU',
        apiKey,
        pairingToken,
        pairingExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        lastHeartbeat: new Date(),
        licenseId: license.id,
      },
    });

    this.logger.log('✅ MAIN node created successfully');
  }

  /**
   * Create default FREE license only (no nodes - let setup wizard create them)
   */
  private async createDefaultLicense(): Promise<void> {
    const licenseKey = this.generateLicenseKey('FREE');

    // Create FREE license
    const license = await this.prisma.license.create({
      data: {
        key: licenseKey,
        tier: 'FREE' as LicenseTier,
        status: 'ACTIVE' as LicenseStatus,
        email: 'admin@localhost',
        maxNodes: 10,
        maxConcurrentJobs: 10,
        features: {},
      },
    });

    this.logger.log(`✅ Created FREE license: ${license.key}`);
    this.logger.log('🎉 Database initialization complete! Run setup wizard to create nodes.');
  }

  /**
   * Generate a license key in format: {tier}-{random}
   */
  private generateLicenseKey(tier: string): string {
    const randomPart = require('crypto')
      .randomBytes(10)
      .toString('hex')
      .substring(0, 13)
      .toUpperCase();
    return `${tier}-${randomPart}`;
  }
}
