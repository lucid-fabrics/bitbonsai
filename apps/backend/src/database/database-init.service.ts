import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
// PrismaService is used directly here intentionally: this is a bootstrap/migration
// infrastructure service that must coordinate across Settings and Node models.
import { PrismaService } from '../prisma/prisma.service';

/**
 * Database Initialization Service
 *
 * Ensures a MAIN node exists if setup is complete (recovery mechanism).
 */
@Injectable()
export class DatabaseInitService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseInitService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.initializeDatabase();
  }

  private async initializeDatabase(): Promise<void> {
    try {
      this.logger.log('Checking database state...');
      await this.ensureMainNodeExists();
    } catch (error: unknown) {
      this.logger.error('Failed to initialize database:', error);
      // Don't throw - allow app to continue even if initialization fails
    }
  }

  /**
   * Ensure a MAIN node exists if setup is complete.
   * Recovery mechanism for databases that completed setup before node creation was added.
   */
  private async ensureMainNodeExists(): Promise<void> {
    const settings = await this.prisma.settings.findFirst();
    if (!settings?.isSetupComplete) {
      return;
    }

    const nodeCount = await this.prisma.node.count();
    if (nodeCount > 0) {
      return;
    }

    this.logger.log('RECOVERY: Creating missing MAIN node...');

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
      },
    });

    this.logger.log('MAIN node created successfully');
  }
}
