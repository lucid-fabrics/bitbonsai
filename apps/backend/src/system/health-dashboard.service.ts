import * as fs from 'node:fs';
import * as os from 'node:os';
import { Injectable, Logger } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { LibrariesService } from '../libraries/libraries.service';
import { PrismaService } from '../prisma/prisma.service';
import { HardwareDetectionService } from './hardware-detection.service';

/**
 * System Health Status
 */
export enum HealthStatus {
  HEALTHY = 'HEALTHY',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Health Check Result
 */
export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message: string;
  value?: number | string;
  threshold?: number | string;
}

/**
 * Queue Statistics
 */
export interface QueueStats {
  total: number;
  byStage: Record<string, number>;
  activeWorkers: number;
  avgProcessingTimeMs: number;
  avgWaitTimeMs: number;
  throughputPerHour: number;
}

/**
 * Storage Statistics
 */
export interface StorageStats {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
}

/**
 * System Dashboard Response
 */
export interface SystemDashboard {
  timestamp: string;
  overallStatus: HealthStatus;
  checks: HealthCheckResult[];
  system: {
    platform: string;
    hostname: string;
    uptime: number;
    loadAverage: number[];
    cpuUsage: number;
    memoryUsed: number;
    memoryTotal: number;
    memoryPercent: number;
  };
  queue: QueueStats;
  storage: StorageStats[];
  nodes: {
    total: number;
    online: number;
    offline: number;
    byRole: Record<string, number>;
  };
  encoding: {
    totalProcessed: number;
    totalSavedBytes: string;
    avgSavedPercent: number;
    failureRate: number;
    last24hCompleted: number;
    last24hFailed: number;
  };
  hardware: {
    accelerationType: string;
    cpuCores: number;
    cpuModel: string;
    gpuDetected: boolean;
    gpuModel?: string;
  };
}

/**
 * HealthDashboardService
 *
 * Provides comprehensive system health monitoring and dashboard data.
 *
 * Features:
 * - Real-time system metrics (CPU, memory, load)
 * - Queue statistics and throughput
 * - Storage space monitoring
 * - Node status tracking
 * - Encoding performance metrics
 * - Health check aggregation
 */
@Injectable()
export class HealthDashboardService {
  private readonly logger = new Logger(HealthDashboardService.name);
  private readonly MEMORY_WARNING_THRESHOLD = 85;
  private readonly MEMORY_CRITICAL_THRESHOLD = 95;
  private readonly LOAD_WARNING_MULTIPLIER = 1.5;
  private readonly LOAD_CRITICAL_MULTIPLIER = 2.0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hardwareDetection: HardwareDetectionService,
    private readonly librariesService: LibrariesService
  ) {}

  /**
   * Get comprehensive system dashboard
   */
  async getDashboard(): Promise<SystemDashboard> {
    const [checks, system, queue, storage, nodes, encoding, hardware] = await Promise.all([
      this.runHealthChecks(),
      this.getSystemMetrics(),
      this.getQueueStats(),
      this.getStorageStats(),
      this.getNodeStats(),
      this.getEncodingStats(),
      this.getHardwareInfo(),
    ]);

    // Determine overall status from health checks
    const overallStatus = this.calculateOverallStatus(checks);

    return {
      timestamp: new Date().toISOString(),
      overallStatus,
      checks,
      system,
      queue,
      storage,
      nodes,
      encoding,
      hardware,
    };
  }

  /**
   * Run all health checks
   */
  async runHealthChecks(): Promise<HealthCheckResult[]> {
    const checks: HealthCheckResult[] = [];

    // CPU Load Check
    const loadAvg = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    const loadRatio = loadAvg / cpuCount;

    checks.push({
      name: 'CPU Load',
      status:
        loadRatio >= this.LOAD_CRITICAL_MULTIPLIER
          ? HealthStatus.CRITICAL
          : loadRatio >= this.LOAD_WARNING_MULTIPLIER
            ? HealthStatus.WARNING
            : HealthStatus.HEALTHY,
      message:
        loadRatio >= this.LOAD_CRITICAL_MULTIPLIER
          ? `Critical CPU load: ${loadAvg.toFixed(2)} (${cpuCount} cores)`
          : loadRatio >= this.LOAD_WARNING_MULTIPLIER
            ? `High CPU load: ${loadAvg.toFixed(2)} (${cpuCount} cores)`
            : `Normal CPU load: ${loadAvg.toFixed(2)} (${cpuCount} cores)`,
      value: loadAvg,
      threshold: cpuCount * this.LOAD_WARNING_MULTIPLIER,
    });

    // Memory Check
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memPercent = ((totalMem - freeMem) / totalMem) * 100;

    checks.push({
      name: 'Memory Usage',
      status:
        memPercent >= this.MEMORY_CRITICAL_THRESHOLD
          ? HealthStatus.CRITICAL
          : memPercent >= this.MEMORY_WARNING_THRESHOLD
            ? HealthStatus.WARNING
            : HealthStatus.HEALTHY,
      message:
        memPercent >= this.MEMORY_CRITICAL_THRESHOLD
          ? `Critical memory usage: ${memPercent.toFixed(1)}%`
          : memPercent >= this.MEMORY_WARNING_THRESHOLD
            ? `High memory usage: ${memPercent.toFixed(1)}%`
            : `Normal memory usage: ${memPercent.toFixed(1)}%`,
      value: memPercent,
      threshold: this.MEMORY_WARNING_THRESHOLD,
    });

    // Database Check
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.push({
        name: 'Database',
        status: HealthStatus.HEALTHY,
        message: 'Database connection healthy',
      });
    } catch (error) {
      checks.push({
        name: 'Database',
        status: HealthStatus.CRITICAL,
        message: `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }

    // Queue Health Check
    const stuckJobs = await this.prisma.job.count({
      where: {
        stage: JobStage.ENCODING,
        updatedAt: {
          lt: new Date(Date.now() - 10 * 60 * 1000), // Not updated in 10 minutes
        },
      },
    });

    checks.push({
      name: 'Queue Health',
      status:
        stuckJobs > 5
          ? HealthStatus.CRITICAL
          : stuckJobs > 0
            ? HealthStatus.WARNING
            : HealthStatus.HEALTHY,
      message:
        stuckJobs > 0
          ? `${stuckJobs} potentially stuck job(s) detected`
          : 'Queue processing normally',
      value: stuckJobs,
      threshold: 1,
    });

    // Node Status Check
    const offlineNodes = await this.prisma.node.count({
      where: { status: 'OFFLINE' },
    });

    checks.push({
      name: 'Node Status',
      status: offlineNodes > 0 ? HealthStatus.WARNING : HealthStatus.HEALTHY,
      message: offlineNodes > 0 ? `${offlineNodes} node(s) offline` : 'All nodes online',
      value: offlineNodes,
      threshold: 0,
    });

    return checks;
  }

  /**
   * Get system metrics
   */
  private async getSystemMetrics() {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Calculate CPU usage (simplified)
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    }
    const cpuUsage = (1 - totalIdle / totalTick) * 100;

    return {
      platform: process.platform,
      hostname: os.hostname(),
      uptime: os.uptime(),
      loadAverage: os.loadavg(),
      cpuUsage: Math.round(cpuUsage),
      memoryUsed: usedMem,
      memoryTotal: totalMem,
      memoryPercent: Math.round((usedMem / totalMem) * 100),
    };
  }

  /**
   * Get queue statistics
   */
  private async getQueueStats(): Promise<QueueStats> {
    // Count by stage
    const byStage: Record<string, number> = {};
    for (const stage of Object.values(JobStage)) {
      byStage[stage] = await this.prisma.job.count({
        where: { stage },
      });
    }

    // Active workers (jobs currently encoding)
    const activeWorkers = byStage[JobStage.ENCODING] || 0;

    // Calculate average processing time (completed jobs in last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const completedJobs = await this.prisma.job.findMany({
      where: {
        stage: JobStage.COMPLETED,
        completedAt: { gte: oneDayAgo },
        startedAt: { not: null },
      },
      select: {
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });

    let avgProcessingTimeMs = 0;
    let avgWaitTimeMs = 0;

    if (completedJobs.length > 0) {
      const processingTimes = completedJobs
        .filter((j) => j.startedAt && j.completedAt)
        .map((j) => j.completedAt!.getTime() - j.startedAt!.getTime());

      const waitTimes = completedJobs
        .filter((j) => j.startedAt)
        .map((j) => j.startedAt!.getTime() - j.createdAt.getTime());

      if (processingTimes.length > 0) {
        avgProcessingTimeMs = processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
      }
      if (waitTimes.length > 0) {
        avgWaitTimeMs = waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length;
      }
    }

    // Throughput (jobs completed per hour in last 24h)
    const throughputPerHour = completedJobs.length / 24;

    const total = Object.values(byStage).reduce((a, b) => a + b, 0);

    return {
      total,
      byStage,
      activeWorkers,
      avgProcessingTimeMs: Math.round(avgProcessingTimeMs),
      avgWaitTimeMs: Math.round(avgWaitTimeMs),
      throughputPerHour: Math.round(throughputPerHour * 100) / 100,
    };
  }

  /**
   * Get storage statistics for media paths
   * UX PHILOSOPHY: Derives paths from libraries in database
   */
  private async getStorageStats(): Promise<StorageStats[]> {
    const stats: StorageStats[] = [];

    // Get media paths from libraries in database (eliminates MEDIA_PATHS env var)
    const mediaPaths = await this.librariesService.getAllLibraryPaths();

    for (const mediaPath of mediaPaths) {
      try {
        if (!fs.existsSync(mediaPath)) continue;

        const statfs = await fs.promises.statfs(mediaPath);
        const totalBytes = statfs.blocks * statfs.bsize;
        const freeBytes = statfs.bavail * statfs.bsize;
        const usedBytes = totalBytes - freeBytes;
        const usedPercent = (usedBytes / totalBytes) * 100;

        stats.push({
          path: mediaPath,
          totalBytes,
          freeBytes,
          usedBytes,
          usedPercent: Math.round(usedPercent * 10) / 10,
        });
      } catch (error) {
        this.logger.warn(`Failed to get storage stats for ${mediaPath}: ${error}`);
      }
    }

    return stats;
  }

  /**
   * Get node statistics
   */
  private async getNodeStats() {
    const nodes = await this.prisma.node.findMany({
      select: {
        status: true,
        role: true,
      },
    });

    const byRole: Record<string, number> = {};
    let online = 0;
    let offline = 0;

    for (const node of nodes) {
      byRole[node.role] = (byRole[node.role] || 0) + 1;
      if (node.status === 'ONLINE') {
        online++;
      } else {
        offline++;
      }
    }

    return {
      total: nodes.length,
      online,
      offline,
      byRole,
    };
  }

  /**
   * Get encoding statistics
   */
  private async getEncodingStats() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Total processed
    const totalProcessed = await this.prisma.job.count({
      where: { stage: JobStage.COMPLETED },
    });

    // Total saved bytes
    const savedAgg = await this.prisma.job.aggregate({
      where: { stage: JobStage.COMPLETED },
      _sum: { savedBytes: true },
      _avg: { savedPercent: true },
    });

    // Last 24h stats
    const last24hCompleted = await this.prisma.job.count({
      where: {
        stage: JobStage.COMPLETED,
        completedAt: { gte: oneDayAgo },
      },
    });

    const last24hFailed = await this.prisma.job.count({
      where: {
        stage: JobStage.FAILED,
        updatedAt: { gte: oneDayAgo },
      },
    });

    // Failure rate
    const totalAttempted = last24hCompleted + last24hFailed;
    const failureRate = totalAttempted > 0 ? (last24hFailed / totalAttempted) * 100 : 0;

    return {
      totalProcessed,
      totalSavedBytes: (savedAgg._sum.savedBytes || BigInt(0)).toString(),
      avgSavedPercent: Math.round((savedAgg._avg.savedPercent || 0) * 100) / 100,
      failureRate: Math.round(failureRate * 100) / 100,
      last24hCompleted,
      last24hFailed,
    };
  }

  /**
   * Get hardware information
   */
  private async getHardwareInfo() {
    try {
      const hwInfo = await this.hardwareDetection.detectHardware();
      const gpus = hwInfo.gpus || [];

      return {
        accelerationType: hwInfo.accelerationType,
        cpuCores: hwInfo.cpu.cores,
        cpuModel: hwInfo.cpu.model,
        gpuDetected: gpus.length > 0,
        gpuModel: gpus.length > 0 ? gpus[0].model : undefined,
      };
    } catch (_error) {
      return {
        accelerationType: 'CPU',
        cpuCores: os.cpus().length,
        cpuModel: os.cpus()[0]?.model || 'Unknown',
        gpuDetected: false,
      };
    }
  }

  /**
   * Calculate overall health status from checks
   */
  private calculateOverallStatus(checks: HealthCheckResult[]): HealthStatus {
    if (checks.some((c) => c.status === HealthStatus.CRITICAL)) {
      return HealthStatus.CRITICAL;
    }
    if (checks.some((c) => c.status === HealthStatus.WARNING)) {
      return HealthStatus.WARNING;
    }
    if (checks.some((c) => c.status === HealthStatus.UNKNOWN)) {
      return HealthStatus.UNKNOWN;
    }
    return HealthStatus.HEALTHY;
  }
}
