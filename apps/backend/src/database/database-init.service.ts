import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { LicenseStatus, LicenseTier } from '@prisma/client';
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
    } catch (error) {
      this.logger.error('❌ Failed to initialize database:', error);
      // Don't throw - allow app to continue even if initialization fails
    }
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
    const randomPart = require('crypto').randomBytes(10).toString('hex').substring(0, 13).toUpperCase();
    return `${tier}-${randomPart}`;
  }
}
