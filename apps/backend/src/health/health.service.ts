import { version as APP_VERSION } from '@bitbonsai/version';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { BasicHealthDto } from './dto/basic-health.dto';
import type { DetailedHealthDto } from './dto/detailed-health.dto';
import type { DiskHealthDto } from './dto/disk-health.dto';
import type { DiskSpaceMonitoringDto } from './dto/disk-space-monitoring.dto';
import type { HealthChecksDto } from './dto/health-checks.dto';
import type { LivenessDto } from './dto/liveness.dto';
import type { MemoryHealthDto } from './dto/memory-health.dto';
import type { NodeHealthDto } from './dto/node-health.dto';
import type { QueueHealthDto } from './dto/queue-health.dto';
import type { ReadinessDto } from './dto/readiness.dto';
import type { ServiceHealthDto } from './dto/service-health.dto';
import { DatabaseHealthService } from './services/database-health.service';
import { DiskHealthService } from './services/disk-health.service';
import { NodeHealthService } from './services/node-health.service';
import { SystemHealthService } from './services/system-health.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();
  private readonly version: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly databaseHealth: DatabaseHealthService,
    private readonly diskHealth: DiskHealthService,
    private readonly systemHealth: SystemHealthService,
    private readonly nodeHealth: NodeHealthService
  ) {
    this.version = APP_VERSION;
  }

  async getBasicHealth(): Promise<BasicHealthDto> {
    const dbOk = await this.databaseHealth.isReady();
    return {
      status: dbOk ? 'ok' : 'error',
      timestamp: new Date(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: this.version,
    };
  }

  async getDetailedHealth(): Promise<DetailedHealthDto> {
    const [checks, nodes, queue] = await Promise.all([
      this.getAllHealthChecks(),
      this.nodeHealth.checkNodeHealth(),
      this.nodeHealth.checkQueueHealth(),
    ]);

    let status: 'ok' | 'degraded' | 'error' = 'ok';
    if (checks.database.status === 'error') {
      status = 'error';
    } else if (
      checks.redis?.status === 'error' ||
      checks.disk.status === 'critical' ||
      checks.memory.status === 'critical' ||
      checks.ffmpeg.status === 'error'
    ) {
      status = 'degraded';
    }

    return { status, timestamp: new Date(), checks, nodes, queue };
  }

  private async getAllHealthChecks(): Promise<HealthChecksDto> {
    const [database, redis, disk, memory, ffmpeg] = await Promise.all([
      this.databaseHealth.checkDatabaseHealth(),
      this.databaseHealth.checkRedisHealth(),
      this.diskHealth.checkDiskHealth(),
      this.systemHealth.checkMemoryHealth(),
      this.systemHealth.checkFfmpegHealth(),
    ]);
    return { database, redis, disk, memory, ffmpeg };
  }

  async checkDatabaseHealth(): Promise<ServiceHealthDto> {
    return this.databaseHealth.checkDatabaseHealth();
  }

  async checkRedisHealth(): Promise<ServiceHealthDto | undefined> {
    return this.databaseHealth.checkRedisHealth();
  }

  async checkDiskHealth(): Promise<DiskHealthDto> {
    return this.diskHealth.checkDiskHealth();
  }

  async checkMemoryHealth(): Promise<MemoryHealthDto> {
    return this.systemHealth.checkMemoryHealth();
  }

  async checkFfmpegHealth(): Promise<ServiceHealthDto> {
    return this.systemHealth.checkFfmpegHealth();
  }

  async checkNodeHealth(): Promise<NodeHealthDto> {
    return this.nodeHealth.checkNodeHealth();
  }

  async checkQueueHealth(): Promise<QueueHealthDto> {
    return this.nodeHealth.checkQueueHealth();
  }

  async monitorLibraryDiskSpace(): Promise<DiskSpaceMonitoringDto> {
    return this.diskHealth.monitorLibraryDiskSpace();
  }

  async isReady(): Promise<ReadinessDto> {
    const ready = await this.databaseHealth.isReady();
    return ready ? { ready: true } : { ready: false, reason: 'Database connection failed' };
  }

  async isLive(): Promise<LivenessDto> {
    return { alive: true };
  }
}
