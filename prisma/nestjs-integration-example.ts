/**
 * BitBonsai - NestJS Prisma Integration Examples
 *
 * This file demonstrates how to integrate the Prisma schema with NestJS.
 * Copy these patterns into your actual NestJS services.
 */

import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { JobStage, LicenseStatus, PrismaClient } from '@prisma/client';
import type { AdvancedSettings, DeviceProfiles, LicenseFeatures } from './types';

// ============================================================================
// PRISMA SERVICE (Create in: apps/backend/src/prisma/prisma.service.ts)
// ============================================================================

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    console.log('✅ Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    console.log('👋 Database disconnected');
  }
}

// ============================================================================
// LICENSE SERVICE EXAMPLE
// ============================================================================

@Injectable()
export class LicenseService {
  constructor(private prisma: PrismaService) {}

  /**
   * Validate a license key
   */
  async validateLicense(key: string) {
    const license = await this.prisma.license.findUnique({
      where: { key },
      select: {
        id: true,
        tier: true,
        status: true,
        validUntil: true,
        maxNodes: true,
        maxConcurrentJobs: true,
        features: true,
        _count: {
          select: {
            nodes: { where: { status: 'ONLINE' } },
          },
        },
      },
    });

    if (!license) {
      throw new Error('License not found');
    }

    if (license.status !== LicenseStatus.ACTIVE) {
      throw new Error('License is not active');
    }

    if (license.validUntil && license.validUntil < new Date()) {
      throw new Error('License has expired');
    }

    const features = license.features as LicenseFeatures;

    return {
      ...license,
      features,
      canAddNode: license._count.nodes < license.maxNodes,
      activeNodes: license._count.nodes,
    };
  }

  /**
   * Create a new license
   */
  async createLicense(data: { tier: string; email: string; validUntil?: Date }) {
    const tierConfig = {
      FREE: { maxNodes: 1, maxConcurrentJobs: 2 },
      PATREON: { maxNodes: 2, maxConcurrentJobs: 5 },
      COMMERCIAL_PRO: { maxNodes: 20, maxConcurrentJobs: 50 },
    };

    const config = tierConfig[data.tier] || tierConfig.FREE;

    return this.prisma.license.create({
      data: {
        key: this.generateLicenseKey(data.tier),
        tier: data.tier as any,
        status: LicenseStatus.ACTIVE,
        email: data.email,
        maxNodes: config.maxNodes,
        maxConcurrentJobs: config.maxConcurrentJobs,
        features: {
          multiNode: data.tier !== 'FREE',
          advancedPresets: data.tier !== 'FREE',
          api: data.tier !== 'FREE',
          priorityQueue: data.tier.startsWith('COMMERCIAL'),
          cloudStorage: data.tier.startsWith('COMMERCIAL'),
          webhooks: data.tier.startsWith('COMMERCIAL'),
        },
        validUntil: data.validUntil || null,
      },
    });
  }

  private generateLicenseKey(tier: string): string {
    const prefix = tier.substring(0, 3).toUpperCase();
    const random = Math.random().toString(36).substring(2, 15);
    return `${prefix}-${random}`;
  }
}

// ============================================================================
// NODE SERVICE EXAMPLE
// ============================================================================

@Injectable()
export class NodeService {
  constructor(private prisma: PrismaService) {}

  /**
   * Register a new node
   */
  async registerNode(data: {
    name: string;
    licenseKey: string;
    version: string;
    acceleration: string;
  }) {
    // Validate license
    const license = await this.prisma.license.findUnique({
      where: { key: data.licenseKey },
      include: {
        _count: {
          select: { nodes: true },
        },
      },
    });

    if (!license || license.status !== 'ACTIVE') {
      throw new Error('Invalid license');
    }

    if (license._count.nodes >= license.maxNodes) {
      throw new Error('Maximum nodes reached for this license');
    }

    // Create node
    return this.prisma.node.create({
      data: {
        name: data.name,
        role: license._count.nodes === 0 ? 'MAIN' : 'LINKED',
        status: 'ONLINE',
        version: data.version,
        acceleration: data.acceleration as any,
        apiKey: this.generateApiKey(),
        lastHeartbeat: new Date(),
        licenseId: license.id,
      },
    });
  }

  /**
   * Record node heartbeat
   */
  async heartbeat(nodeId: string) {
    return this.prisma.node.update({
      where: { id: nodeId },
      data: {
        status: 'ONLINE',
        lastHeartbeat: new Date(),
        uptimeSeconds: { increment: 60 }, // Assuming 60s heartbeat interval
      },
    });
  }

  /**
   * Get node with statistics
   */
  async getNodeStats(nodeId: string) {
    return this.prisma.node.findUnique({
      where: { id: nodeId },
      include: {
        license: {
          select: {
            tier: true,
            maxConcurrentJobs: true,
          },
        },
        libraries: {
          select: {
            id: true,
            name: true,
            totalFiles: true,
          },
        },
        _count: {
          select: {
            jobs: {
              where: {
                stage: { in: ['QUEUED', 'ENCODING', 'VERIFYING'] },
              },
            },
          },
        },
      },
    });
  }

  private generateApiKey(): string {
    const random = require('crypto').randomBytes(32).toString('hex');
    return `bb_${random}`;
  }
}

// ============================================================================
// JOB SERVICE EXAMPLE
// ============================================================================

@Injectable()
export class JobService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get next job for a node
   */
  async getNextJob(nodeId: string) {
    // Check if node can accept more jobs
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      include: {
        license: true,
        _count: {
          select: {
            jobs: {
              where: {
                stage: { in: ['ENCODING', 'VERIFYING'] },
              },
            },
          },
        },
      },
    });

    if (!node) {
      throw new Error('Node not found');
    }

    if (node._count.jobs >= node.license.maxConcurrentJobs) {
      return null; // Node at capacity
    }

    // Get next queued job
    const job = await this.prisma.job.findFirst({
      where: {
        nodeId,
        stage: JobStage.QUEUED,
      },
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        policy: true,
        library: true,
      },
    });

    if (job) {
      // Update to encoding
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          stage: JobStage.ENCODING,
          startedAt: new Date(),
        },
      });
    }

    return job;
  }

  /**
   * Update job progress
   */
  async updateProgress(jobId: string, progress: number, etaSeconds: number) {
    return this.prisma.job.update({
      where: { id: jobId },
      data: {
        progress,
        etaSeconds,
      },
    });
  }

  /**
   * Complete a job
   */
  async completeJob(
    jobId: string,
    data: {
      afterSizeBytes: bigint;
      savedBytes: bigint;
      savedPercent: number;
    }
  ) {
    const job = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        stage: JobStage.COMPLETED,
        progress: 100,
        afterSizeBytes: data.afterSizeBytes,
        savedBytes: data.savedBytes,
        savedPercent: data.savedPercent,
        completedAt: new Date(),
      },
      include: {
        node: {
          include: {
            license: true,
          },
        },
      },
    });

    // Update metrics
    await this.updateMetrics(job);

    return job;
  }

  /**
   * Fail a job
   */
  async failJob(jobId: string, error: string) {
    return this.prisma.job.update({
      where: { id: jobId },
      data: {
        stage: JobStage.FAILED,
        completedAt: new Date(),
        error,
      },
    });
  }

  /**
   * Get job statistics
   */
  async getJobStats(nodeId?: string) {
    const where = nodeId ? { nodeId } : {};

    const [completed, failed, encoding, queued, totalSaved] = await Promise.all([
      this.prisma.job.count({
        where: { ...where, stage: JobStage.COMPLETED },
      }),
      this.prisma.job.count({ where: { ...where, stage: JobStage.FAILED } }),
      this.prisma.job.count({
        where: { ...where, stage: JobStage.ENCODING },
      }),
      this.prisma.job.count({ where: { ...where, stage: JobStage.QUEUED } }),
      this.prisma.job.aggregate({
        where: { ...where, stage: JobStage.COMPLETED },
        _sum: { savedBytes: true },
      }),
    ]);

    return {
      completed,
      failed,
      encoding,
      queued,
      totalSavedBytes: totalSaved._sum.savedBytes || BigInt(0),
    };
  }

  private async updateMetrics(job: any) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Node-specific metric
    await this.prisma.metric.upsert({
      where: {
        date_nodeId_licenseId: {
          date: today,
          nodeId: job.nodeId,
          licenseId: job.node.licenseId,
        },
      },
      create: {
        date: today,
        nodeId: job.nodeId,
        licenseId: job.node.licenseId,
        jobsCompleted: 1,
        totalSavedBytes: job.savedBytes || BigInt(0),
        avgThroughputFilesPerHour: 0,
        codecDistribution: {},
      },
      update: {
        jobsCompleted: { increment: 1 },
        totalSavedBytes: { increment: job.savedBytes || BigInt(0) },
      },
    });

    // License-wide metric
    await this.prisma.metric.upsert({
      where: {
        date_nodeId_licenseId: {
          date: today,
          nodeId: null,
          licenseId: job.node.licenseId,
        },
      },
      create: {
        date: today,
        nodeId: null,
        licenseId: job.node.licenseId,
        jobsCompleted: 1,
        totalSavedBytes: job.savedBytes || BigInt(0),
        avgThroughputFilesPerHour: 0,
        codecDistribution: {},
      },
      update: {
        jobsCompleted: { increment: 1 },
        totalSavedBytes: { increment: job.savedBytes || BigInt(0) },
      },
    });
  }
}

// ============================================================================
// LIBRARY SERVICE EXAMPLE
// ============================================================================

@Injectable()
export class LibraryService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new library
   */
  async createLibrary(data: { name: string; path: string; mediaType: string; nodeId: string }) {
    return this.prisma.library.create({
      data: {
        name: data.name,
        path: data.path,
        mediaType: data.mediaType as any,
        nodeId: data.nodeId,
      },
    });
  }

  /**
   * Scan library and update stats
   */
  async scanLibrary(libraryId: string) {
    // This would integrate with your file scanning logic
    // For now, just update the scan timestamp

    return this.prisma.library.update({
      where: { id: libraryId },
      data: {
        lastScanAt: new Date(),
      },
    });
  }

  /**
   * Get library with statistics
   */
  async getLibraryStats(libraryId: string) {
    return this.prisma.library.findUnique({
      where: { id: libraryId },
      include: {
        node: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
        policies: {
          select: {
            id: true,
            name: true,
            preset: true,
          },
        },
        _count: {
          select: {
            jobs: true,
          },
        },
      },
    });
  }
}

// ============================================================================
// POLICY SERVICE EXAMPLE
// ============================================================================

@Injectable()
export class PolicyService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new policy
   */
  async createPolicy(data: {
    name: string;
    preset: string;
    targetCodec: string;
    targetQuality: number;
    libraryId?: string;
  }) {
    const deviceProfiles: DeviceProfiles = {
      appleTv: true,
      roku: true,
      web: true,
      chromecast: true,
      ps5: true,
      xbox: true,
    };

    const advancedSettings: AdvancedSettings = {
      ffmpegFlags: ['-preset', 'medium'],
      hwaccel: 'auto',
      audioCodec: 'copy',
      subtitleHandling: 'copy',
    };

    return this.prisma.policy.create({
      data: {
        name: data.name,
        preset: data.preset as any,
        targetCodec: data.targetCodec as any,
        targetQuality: data.targetQuality,
        deviceProfiles,
        advancedSettings,
        atomicReplace: true,
        verifyOutput: true,
        skipSeeding: true,
        libraryId: data.libraryId,
      },
    });
  }

  /**
   * Get policy with job statistics
   */
  async getPolicyStats(policyId: string) {
    return this.prisma.policy.findUnique({
      where: { id: policyId },
      include: {
        library: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            jobs: {
              where: {
                stage: JobStage.COMPLETED,
              },
            },
          },
        },
      },
    });
  }
}

// ============================================================================
// METRIC SERVICE EXAMPLE
// ============================================================================

@Injectable()
export class MetricService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get time-series metrics
   */
  async getTimeSeriesMetrics(params: {
    startDate: Date;
    endDate: Date;
    nodeId?: string;
    licenseId?: string;
  }) {
    return this.prisma.metric.findMany({
      where: {
        date: {
          gte: params.startDate,
          lte: params.endDate,
        },
        nodeId: params.nodeId || null,
        licenseId: params.licenseId,
      },
      orderBy: {
        date: 'asc',
      },
    });
  }

  /**
   * Get aggregated statistics
   */
  async getAggregatedStats(licenseId?: string) {
    const where = licenseId ? { licenseId } : {};

    const result = await this.prisma.metric.aggregate({
      where,
      _sum: {
        jobsCompleted: true,
        jobsFailed: true,
        totalSavedBytes: true,
      },
      _avg: {
        avgThroughputFilesPerHour: true,
      },
    });

    return {
      totalJobsCompleted: result._sum.jobsCompleted || 0,
      totalJobsFailed: result._sum.jobsFailed || 0,
      totalSavedBytes: result._sum.totalSavedBytes || BigInt(0),
      avgThroughput: result._avg.avgThroughputFilesPerHour || 0,
    };
  }
}

// ============================================================================
// MODULE CONFIGURATION
// ============================================================================

/**
 * Create prisma.module.ts:
 *
 * import { Module } from '@nestjs/common';
 * import { PrismaService } from './prisma.service';
 *
 * @Module({
 *   providers: [PrismaService],
 *   exports: [PrismaService],
 * })
 * export class PrismaModule {}
 *
 * Then import PrismaModule in your feature modules:
 *
 * @Module({
 *   imports: [PrismaModule],
 *   providers: [LicenseService],
 *   controllers: [LicenseController],
 * })
 * export class LicenseModule {}
 */
