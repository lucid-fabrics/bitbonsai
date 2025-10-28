import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type {
  AccelerationType,
  LicenseStatus,
  LicenseTier,
  NodeRole,
  NodeStatus,
} from '@prisma/client';
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
        this.logger.log('📦 No licenses found. Initializing database with default data...');
        await this.createDefaultLicenseAndNode();
      } else {
        this.logger.log('✅ Database already initialized');
      }
    } catch (error) {
      this.logger.error('❌ Failed to initialize database:', error);
      // Don't throw - allow app to continue even if initialization fails
    }
  }

  /**
   * Create default FREE license and MAIN node
   */
  private async createDefaultLicenseAndNode(): Promise<void> {
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

    // Create MAIN node
    const hostname = process.env.HOSTNAME || 'bitbonsai-main';
    const apiUrl = process.env.API_URL || 'http://localhost:3000';

    const node = await this.prisma.node.create({
      data: {
        name: 'Main Node',
        role: 'MAIN' as NodeRole,
        status: 'ONLINE' as NodeStatus,
        version: '0.1.0',
        acceleration: 'CPU' as AccelerationType,
        apiKey: this.generateApiKey(),
        lastHeartbeat: new Date(),
        licenseId: license.id,
      },
    });

    this.logger.log(`✅ Created MAIN node: ${node.name} (${node.id})`);
    this.logger.log('🎉 Database initialization complete!');
  }

  /**
   * Generate a license key in format: {tier}-{random}
   */
  private generateLicenseKey(tier: string): string {
    const randomPart = Math.random().toString(36).substring(2, 15).toUpperCase();
    return `${tier}-${randomPart}`;
  }

  /**
   * Generate a secure API key
   */
  private generateApiKey(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 15);
    return `bitbonsai_${timestamp}_${randomPart}`;
  }
}
