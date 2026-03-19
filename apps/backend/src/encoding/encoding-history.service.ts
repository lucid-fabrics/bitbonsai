import { Injectable, Logger } from '@nestjs/common';
import { type AccelerationType, JobStage } from '@prisma/client';
import { JobRepository } from '../common/repositories/job.repository';

/**
 * Encoding Speed Profile
 */
export interface EncodingSpeedProfile {
  codec: string;
  accelerationType: AccelerationType;
  avgFps: number;
  avgBytesPerSecond: number;
  sampleCount: number;
  lastUpdated: Date;
}

/**
 * ETA Calculation Result
 */
export interface ETAResult {
  etaSeconds: number;
  etaFormatted: string;
  confidence: 'high' | 'medium' | 'low';
  basedOn: 'historical' | 'current_speed' | 'estimate';
  sampleCount: number;
}

/**
 * EncodingHistoryService
 *
 * Tracks historical encoding performance to improve ETA calculations.
 *
 * Features:
 * - Collects encoding speed data per codec/acceleration type
 * - Provides improved ETA based on historical data
 * - Handles cold-start with fallback estimates
 * - Updates statistics after job completion
 */
@Injectable()
export class EncodingHistoryService {
  private readonly logger = new Logger(EncodingHistoryService.name);

  // In-memory cache of encoding speed profiles
  private readonly speedProfiles = new Map<string, EncodingSpeedProfile>();

  // Minimum samples for high confidence
  private readonly MIN_SAMPLES_HIGH_CONFIDENCE = 10;
  private readonly MIN_SAMPLES_MEDIUM_CONFIDENCE = 3;

  constructor(private readonly jobRepository: JobRepository) {}

  /**
   * Load historical data on service initialization
   */
  async onModuleInit(): Promise<void> {
    await this.loadHistoricalData();
  }

  /**
   * Load historical encoding data from completed jobs
   */
  async loadHistoricalData(): Promise<void> {
    this.logger.log('Loading historical encoding data...');

    try {
      // Get completed jobs with timing data from the last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const completedJobs = await this.jobRepository.findManyWithInclude<{
        targetCodec: string;
        beforeSizeBytes: bigint;
        startedAt: Date | null;
        completedAt: Date | null;
        node: { acceleration: AccelerationType } | null;
      }>({
        where: {
          stage: JobStage.COMPLETED,
          startedAt: { not: null },
          completedAt: { not: null },
          beforeSizeBytes: { gt: 0 },
          updatedAt: { gte: thirtyDaysAgo },
        },
        select: {
          targetCodec: true,
          beforeSizeBytes: true,
          startedAt: true,
          completedAt: true,
          node: {
            select: {
              acceleration: true,
            },
          },
        },
      });

      // Group by codec + acceleration type
      const groupedData = new Map<
        string,
        {
          totalSeconds: number;
          totalBytes: number;
          count: number;
          acceleration: AccelerationType;
          codec: string;
        }
      >();

      for (const job of completedJobs) {
        if (!job.startedAt || !job.completedAt || !job.node?.acceleration) continue;

        const key = `${job.targetCodec}-${job.node.acceleration}`;
        const durationSeconds = (job.completedAt.getTime() - job.startedAt.getTime()) / 1000;
        const bytes = Number(job.beforeSizeBytes);

        if (durationSeconds <= 0 || bytes <= 0) continue;

        const existing = groupedData.get(key) || {
          totalSeconds: 0,
          totalBytes: 0,
          count: 0,
          acceleration: job.node.acceleration,
          codec: job.targetCodec,
        };

        existing.totalSeconds += durationSeconds;
        existing.totalBytes += bytes;
        existing.count++;
        groupedData.set(key, existing);
      }

      // Calculate averages and store profiles
      for (const [key, data] of groupedData) {
        const avgBytesPerSecond = data.totalBytes / data.totalSeconds;
        const avgFps = avgBytesPerSecond / (1024 * 1024); // Approximate FPS based on ~1MB per frame at 24fps

        this.speedProfiles.set(key, {
          codec: data.codec,
          accelerationType: data.acceleration,
          avgFps: Math.round(avgFps * 100) / 100,
          avgBytesPerSecond: Math.round(avgBytesPerSecond),
          sampleCount: data.count,
          lastUpdated: new Date(),
        });
      }

      this.logger.log(
        `Loaded ${this.speedProfiles.size} encoding speed profile(s) from ${completedJobs.length} historical job(s)`
      );
    } catch (error: unknown) {
      this.logger.error('Failed to load historical encoding data:', error);
    }
  }

  /**
   * Calculate ETA for a job based on historical data
   *
   * @param targetCodec - Target codec (HEVC, AV1, etc.)
   * @param accelerationType - Hardware acceleration type
   * @param remainingBytes - Remaining bytes to encode
   * @param currentFps - Current encoding FPS (if available)
   * @returns ETA calculation result
   */
  calculateETA(
    targetCodec: string,
    accelerationType: AccelerationType,
    remainingBytes: number,
    currentFps?: number
  ): ETAResult {
    const key = `${targetCodec}-${accelerationType}`;
    const profile = this.speedProfiles.get(key);

    // Strategy 1: Use current FPS if available and job is in progress
    if (currentFps && currentFps > 0) {
      // Estimate bytes per frame (rough: file size / frame count)
      // For a 2-hour movie at 24fps = ~172,800 frames
      const estimatedBytesPerFrame = remainingBytes / (currentFps * 60); // Rough estimate
      const etaSeconds = remainingBytes / (currentFps * estimatedBytesPerFrame);

      return {
        etaSeconds: Math.round(etaSeconds),
        etaFormatted: this.formatDuration(etaSeconds),
        confidence: 'high',
        basedOn: 'current_speed',
        sampleCount: 1,
      };
    }

    // Strategy 2: Use historical data
    if (profile && profile.avgBytesPerSecond > 0) {
      const etaSeconds = remainingBytes / profile.avgBytesPerSecond;
      const confidence =
        profile.sampleCount >= this.MIN_SAMPLES_HIGH_CONFIDENCE
          ? 'high'
          : profile.sampleCount >= this.MIN_SAMPLES_MEDIUM_CONFIDENCE
            ? 'medium'
            : 'low';

      return {
        etaSeconds: Math.round(etaSeconds),
        etaFormatted: this.formatDuration(etaSeconds),
        confidence,
        basedOn: 'historical',
        sampleCount: profile.sampleCount,
      };
    }

    // Strategy 3: Fallback estimate based on codec
    const fallbackBytesPerSecond = this.getFallbackSpeed(targetCodec, accelerationType);
    const etaSeconds = remainingBytes / fallbackBytesPerSecond;

    return {
      etaSeconds: Math.round(etaSeconds),
      etaFormatted: this.formatDuration(etaSeconds),
      confidence: 'low',
      basedOn: 'estimate',
      sampleCount: 0,
    };
  }

  /**
   * Update speed profile after job completion
   *
   * @param targetCodec - Target codec
   * @param accelerationType - Hardware acceleration type
   * @param durationSeconds - Encoding duration in seconds
   * @param sizeBytes - File size in bytes
   */
  async updateSpeedProfile(
    targetCodec: string,
    accelerationType: AccelerationType,
    durationSeconds: number,
    sizeBytes: number
  ): Promise<void> {
    if (durationSeconds <= 0 || sizeBytes <= 0) return;

    const key = `${targetCodec}-${accelerationType}`;
    const bytesPerSecond = sizeBytes / durationSeconds;

    const existing = this.speedProfiles.get(key);

    if (existing) {
      // Rolling average (give more weight to recent data)
      const weight = Math.min(existing.sampleCount, 10);
      const newAvgBytesPerSecond =
        (existing.avgBytesPerSecond * weight + bytesPerSecond) / (weight + 1);

      this.speedProfiles.set(key, {
        ...existing,
        avgBytesPerSecond: Math.round(newAvgBytesPerSecond),
        avgFps: Math.round((newAvgBytesPerSecond / (1024 * 1024)) * 100) / 100,
        sampleCount: existing.sampleCount + 1,
        lastUpdated: new Date(),
      });
    } else {
      this.speedProfiles.set(key, {
        codec: targetCodec,
        accelerationType,
        avgFps: Math.round((bytesPerSecond / (1024 * 1024)) * 100) / 100,
        avgBytesPerSecond: Math.round(bytesPerSecond),
        sampleCount: 1,
        lastUpdated: new Date(),
      });
    }

    this.logger.debug(`Updated speed profile for ${key}: ${bytesPerSecond.toFixed(0)} bytes/sec`);
  }

  /**
   * Get all speed profiles
   */
  getSpeedProfiles(): EncodingSpeedProfile[] {
    return Array.from(this.speedProfiles.values());
  }

  /**
   * Get fallback encoding speed estimate
   * @private
   */
  private getFallbackSpeed(codec: string, acceleration: AccelerationType): number {
    // Rough estimates in bytes per second
    const baseSpeed: Record<string, number> = {
      HEVC: 5 * 1024 * 1024, // ~5 MB/s
      AV1: 1 * 1024 * 1024, // ~1 MB/s (AV1 is slower)
      H264: 10 * 1024 * 1024, // ~10 MB/s
      VP9: 2 * 1024 * 1024, // ~2 MB/s
    };

    const accelerationMultiplier: Record<AccelerationType, number> = {
      CPU: 1.0,
      NVIDIA: 5.0, // NVENC is much faster
      INTEL_QSV: 3.0,
      AMD: 3.0,
      APPLE_M: 4.0,
    };

    const base = baseSpeed[codec] || 5 * 1024 * 1024;
    const multiplier = accelerationMultiplier[acceleration] || 1.0;

    return base * multiplier;
  }

  /**
   * Format duration in human-readable format
   * @private
   */
  private formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    }
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}
