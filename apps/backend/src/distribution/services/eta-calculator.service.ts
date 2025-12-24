import { Injectable, Logger } from '@nestjs/common';
import type { Job } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { DurationEstimate } from '../interfaces/scoring-factors.interface';

/**
 * ETA Calculator Service
 *
 * Estimates encoding duration and calculates completion times for jobs.
 * Uses historical data when available, falls back to file size estimation.
 */
@Injectable()
export class EtaCalculatorService {
  private readonly logger = new Logger(EtaCalculatorService.name);

  // Historical encoding rates cache (codec -> GB/hour)
  private encodingRatesCache: Map<string, number> | null = null;
  private cacheExpiresAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Estimate encoding duration for a job
   */
  async estimateDuration(job: Job): Promise<DurationEstimate> {
    const fileSizeGB = Number(job.beforeSizeBytes) / (1024 * 1024 * 1024);
    const sourceCodec = job.sourceCodec?.toUpperCase() || 'UNKNOWN';
    const targetCodec = job.targetCodec?.toUpperCase() || 'HEVC';

    // Try historical data first
    const historicalEstimate = await this.estimateFromHistory(sourceCodec, targetCodec, fileSizeGB);
    if (historicalEstimate) {
      return historicalEstimate;
    }

    // Fall back to file size estimation
    return this.estimateFromFileSize(fileSizeGB, sourceCodec, targetCodec);
  }

  /**
   * Estimate from historical encoding data
   */
  private async estimateFromHistory(
    sourceCodec: string,
    targetCodec: string,
    fileSizeGB: number
  ): Promise<DurationEstimate | null> {
    const rates = await this.getEncodingRates();
    const key = `${sourceCodec}->${targetCodec}`;
    const rate = rates.get(key);

    if (!rate || rate <= 0) {
      return null;
    }

    const estimatedSeconds = Math.round((fileSizeGB / rate) * 3600);

    return {
      estimatedSeconds,
      confidence: 'HIGH',
      basedOn: 'HISTORICAL',
      factors: {
        fileSizeGB,
        sourceCodec,
        targetCodec,
      },
    };
  }

  /**
   * Estimate from file size using default rates
   */
  private estimateFromFileSize(
    fileSizeGB: number,
    sourceCodec: string,
    targetCodec: string
  ): DurationEstimate {
    // Default encoding rates (GB per hour)
    // These are conservative estimates for CPU encoding
    const baseRates: Record<string, number> = {
      HEVC: 1.5, // ~1.5 GB/hour for HEVC
      AV1: 0.5, // ~0.5 GB/hour for AV1 (very slow)
      H264: 3.0, // ~3 GB/hour for H264
      VP9: 0.8, // ~0.8 GB/hour for VP9
    };

    const rate = baseRates[targetCodec] || 1.5;
    const estimatedSeconds = Math.round((fileSizeGB / rate) * 3600);

    return {
      estimatedSeconds,
      confidence: 'LOW',
      basedOn: 'FILE_SIZE',
      factors: {
        fileSizeGB,
        sourceCodec,
        targetCodec,
      },
    };
  }

  /**
   * Get historical encoding rates from completed jobs
   */
  private async getEncodingRates(): Promise<Map<string, number>> {
    // Check cache
    if (this.encodingRatesCache && Date.now() < this.cacheExpiresAt) {
      return this.encodingRatesCache;
    }

    const rates = new Map<string, number>();

    try {
      // Get completed jobs from last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const completedJobs = await this.prisma.job.findMany({
        where: {
          stage: 'COMPLETED',
          completedAt: { gte: thirtyDaysAgo },
          startedAt: { not: null },
          beforeSizeBytes: { gt: 0 },
        },
        select: {
          sourceCodec: true,
          targetCodec: true,
          beforeSizeBytes: true,
          startedAt: true,
          completedAt: true,
        },
        take: 1000,
      });

      // Group by codec pair and calculate average rate
      const codecData = new Map<string, { totalGB: number; totalHours: number }>();

      for (const job of completedJobs) {
        if (!job.startedAt || !job.completedAt) continue;

        const key = `${job.sourceCodec?.toUpperCase() || 'UNKNOWN'}->${job.targetCodec?.toUpperCase() || 'HEVC'}`;
        const sizeGB = Number(job.beforeSizeBytes) / (1024 * 1024 * 1024);
        const durationHours =
          (job.completedAt.getTime() - job.startedAt.getTime()) / (1000 * 60 * 60);

        if (durationHours > 0 && sizeGB > 0) {
          const existing = codecData.get(key) || { totalGB: 0, totalHours: 0 };
          existing.totalGB += sizeGB;
          existing.totalHours += durationHours;
          codecData.set(key, existing);
        }
      }

      // Calculate rates (GB/hour)
      for (const [key, data] of codecData) {
        if (data.totalHours > 0) {
          rates.set(key, data.totalGB / data.totalHours);
        }
      }

      this.logger.debug(`Calculated encoding rates for ${rates.size} codec pairs`);
    } catch (error) {
      this.logger.error('Failed to calculate encoding rates', error);
    }

    // Cache for 1 hour
    this.encodingRatesCache = rates;
    this.cacheExpiresAt = Date.now() + 3600000;

    return rates;
  }

  /**
   * Calculate when a node will be free (all queued jobs complete)
   */
  async calculateNodeFreeAt(nodeId: string): Promise<Date | null> {
    // Get all active and queued jobs for this node
    const jobs = await this.prisma.job.findMany({
      where: {
        nodeId,
        stage: { in: ['ENCODING', 'QUEUED', 'VERIFYING'] },
      },
      orderBy: { priority: 'desc' },
    });

    if (jobs.length === 0) {
      return null; // Already free
    }

    let totalRemainingSeconds = 0;

    for (const job of jobs) {
      // For encoding jobs, use remaining time based on progress
      if (job.stage === 'ENCODING' && job.etaSeconds) {
        totalRemainingSeconds += job.etaSeconds;
      } else if (job.estimatedDuration) {
        // Use pre-calculated estimate
        totalRemainingSeconds += job.estimatedDuration;
      } else {
        // Calculate estimate
        const estimate = await this.estimateDuration(job);
        totalRemainingSeconds += estimate.estimatedSeconds;
      }
    }

    // Get node worker count
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: { maxWorkers: true },
    });

    const workers = node?.maxWorkers || 1;

    // Divide by workers (parallel processing)
    const effectiveSeconds = Math.ceil(totalRemainingSeconds / workers);

    return new Date(Date.now() + effectiveSeconds * 1000);
  }

  /**
   * Update estimated completion times for all jobs on a node
   */
  async updateNodeETAs(nodeId: string): Promise<void> {
    const jobs = await this.prisma.job.findMany({
      where: {
        nodeId,
        stage: { in: ['QUEUED', 'ENCODING'] },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: { maxWorkers: true },
    });

    const workers = node?.maxWorkers || 1;
    const currentTime = new Date();
    const _activeSlots = 0;

    // Track when each slot becomes free
    const slotFreeTimes: Date[] = new Array(workers).fill(currentTime);

    for (const job of jobs) {
      // Find earliest free slot
      const slotTimes = slotFreeTimes.map((d) => d.getTime());
      const minTime = Math.min(...slotTimes);
      const earliestSlot = slotTimes.indexOf(minTime);
      const earliestFreeTime = slotFreeTimes[earliestSlot] || currentTime;
      const startTime = new Date(Math.max(earliestFreeTime.getTime(), currentTime.getTime()));

      // Get duration
      let durationSeconds = job.estimatedDuration;
      if (!durationSeconds) {
        const estimate = await this.estimateDuration(job);
        durationSeconds = estimate.estimatedSeconds;
      }

      // Adjust for progress if encoding
      if (job.stage === 'ENCODING' && job.progress > 0) {
        durationSeconds = Math.round(durationSeconds * (1 - job.progress / 100));
      }

      const endTime = new Date(startTime.getTime() + durationSeconds * 1000);

      // Update job
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          estimatedDuration: durationSeconds,
          estimatedStartAt: startTime,
          estimatedCompleteAt: endTime,
        },
      });

      // Update slot free time
      slotFreeTimes[earliestSlot] = endTime;
    }

    // Update node's estimated free time
    const latestSlotFree = new Date(Math.max(...slotFreeTimes.map((d) => d.getTime())));
    await this.prisma.node.update({
      where: { id: nodeId },
      data: { estimatedFreeAt: latestSlotFree },
    });

    this.logger.debug(`Updated ETAs for ${jobs.length} jobs on node ${nodeId}`);
  }

  /**
   * Clear rate cache (useful after significant changes)
   */
  clearCache(): void {
    this.encodingRatesCache = null;
    this.cacheExpiresAt = 0;
  }
}
