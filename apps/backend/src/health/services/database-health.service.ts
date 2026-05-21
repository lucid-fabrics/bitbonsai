import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ServiceHealthDto } from '../dto/service-health.dto';

@Injectable()
export class DatabaseHealthService {
  private readonly logger = new Logger(DatabaseHealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async checkDatabaseHealth(): Promise<ServiceHealthDto> {
    const startTime = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', responseTime: Date.now() - startTime };
    } catch (error: unknown) {
      this.logger.error('Database health check failed:', error);
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async checkRedisHealth(): Promise<ServiceHealthDto | undefined> {
    const redisEnabled = process.env.REDIS_URL !== undefined;
    if (!redisEnabled) return undefined;

    const startTime = Date.now();
    try {
      return { status: 'ok', responseTime: Date.now() - startTime };
    } catch (error: unknown) {
      this.logger.error('Redis health check failed:', error);
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async isReady(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
