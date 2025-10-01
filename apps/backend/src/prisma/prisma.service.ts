import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService
 *
 * Provides a singleton Prisma client instance that integrates with NestJS lifecycle.
 * Automatically connects on module initialization and disconnects on module destruction.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Connect to the database when the module initializes
   */
  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database connection established');
    } catch (error) {
      this.logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  /**
   * Disconnect from the database when the module is destroyed
   */
  async onModuleDestroy() {
    try {
      await this.$disconnect();
      this.logger.log('Database connection closed');
    } catch (error) {
      this.logger.error('Error disconnecting from database', error);
    }
  }
}
