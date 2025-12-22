import { Injectable, Logger } from '@nestjs/common';
import type { Job, Node } from '@prisma/client';
import { isNodeInAllowedWindow } from '../../nodes/utils/schedule-checker';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  DistributionConfigData,
  HeartbeatLoadData,
  MigrationDecision,
  NodeScore,
  ScoringFactors,
} from '../interfaces/scoring-factors.interface';
import { LoadMonitorService } from './load-monitor.service';

type NodeWithCounts = Node & {
  _count: {
    jobs: number;
    failureLogs?: number;
  };
};

type JobWithRelations = Job & {
  library: { nodeId: string };
};

/**
 * Job Scorer Service (Distribution v2)
 *
 * Calculates comprehensive scores for node-job pairs using 12 factors:
 *
 * Positive Factors (add to score):
 * - Real-time Load (0-30): Based on actual CPU/memory from heartbeat
 * - Queue Depth (0-20): Based on pending job count
 * - Hardware (0-25): GPU + CPU cores
 * - Performance (0-25): Historical encoding speed
 * - Codec Match (0-20): HW acceleration for target codec
 * - Library Affinity (0-10): Same library bonus
 * - ETA Balance (0-15): Prefer nodes finishing sooner
 * - File Size Spread (0-15): Spread large files across nodes
 *
 * Negative Factors (subtract from score):
 * - Stickiness (-20 to 0): Penalty for job migration
 * - Transfer Cost (-25 to 0): Penalty if no shared storage
 * - Reliability (-15 to 0): Recent failure penalty
 */
@Injectable()
export class JobScorerService {
  private readonly logger = new Logger(JobScorerService.name);

  // Score cache (nodeId -> score)
  private scoreCache = new Map<string, { score: NodeScore; expiresAt: number }>();

  // Config cache
  private configCache: { config: DistributionConfigData; expiresAt: number } | null = null;

  // Max encoding speed cache
  private maxSpeedCache: { value: number; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly loadMonitor: LoadMonitorService
  ) {}

  /**
   * Calculate comprehensive score for a node-job pair
   */
  async calculateScore(node: NodeWithCounts, job: JobWithRelations): Promise<NodeScore> {
    const config = await this.getConfig();
    const factors = await this.calculateFactors(node, job, config);

    // Gate check: schedule must be available
    if (!factors.scheduleAvailable) {
      return {
        nodeId: node.id,
        nodeName: node.name,
        totalScore: 0,
        factors,
        computedAt: new Date(),
      };
    }

    // Calculate weighted total
    const totalScore = this.calculateWeightedTotal(factors, config);

    return {
      nodeId: node.id,
      nodeName: node.name,
      totalScore: Math.max(0, totalScore),
      factors,
      computedAt: new Date(),
    };
  }

  /**
   * Calculate all scoring factors
   */
  private async calculateFactors(
    node: NodeWithCounts,
    job: JobWithRelations,
    config: DistributionConfigData
  ): Promise<ScoringFactors> {
    // Get load data
    const loadData = await this.loadMonitor.getNodeLoad(node.id);

    // Calculate each factor
    const [
      realTimeLoad,
      queueDepth,
      hardware,
      performance,
      codecMatch,
      libraryAffinity,
      etaBalance,
      fileSizeSpread,
      stickiness,
      transferCost,
      reliability,
    ] = await Promise.all([
      this.calculateRealTimeLoad(node, loadData),
      this.calculateQueueDepth(node),
      this.calculateHardware(node),
      this.calculatePerformance(node),
      this.calculateCodecMatch(node, job),
      config.enableLibraryAffinity ? this.calculateLibraryAffinity(node, job) : 0,
      config.enableETABalancing ? this.calculateETABalance(node) : 0,
      config.enableFileSizeSpread ? this.calculateFileSizeSpread(node, job) : 0,
      this.calculateStickiness(node, job, config),
      this.calculateTransferCost(node, job),
      this.calculateReliability(node),
    ]);

    return {
      scheduleAvailable: isNodeInAllowedWindow(node),
      realTimeLoad,
      queueDepth,
      hardware,
      performance,
      codecMatch,
      libraryAffinity,
      etaBalance,
      fileSizeSpread,
      stickiness,
      transferCost,
      reliability,
    };
  }

  /**
   * Calculate weighted total score
   */
  private calculateWeightedTotal(factors: ScoringFactors, config: DistributionConfigData): number {
    return (
      factors.realTimeLoad * config.weightRealTimeLoad +
      factors.queueDepth * config.weightQueueDepth +
      factors.hardware * config.weightHardware +
      factors.performance * config.weightPerformance +
      factors.codecMatch * config.weightCodecMatch +
      factors.libraryAffinity * config.weightLibraryAffinity +
      factors.etaBalance * config.weightETABalance +
      factors.fileSizeSpread * config.weightFileSizeSpread +
      factors.stickiness * config.weightStickiness +
      factors.transferCost * config.weightTransferCost +
      factors.reliability * config.weightReliability
    );
  }

  // ============================================================================
  // POSITIVE FACTORS
  // ============================================================================

  /**
   * Factor 1: Real-time Load (0-30 points)
   * Based on actual CPU/memory from heartbeat
   */
  private async calculateRealTimeLoad(
    node: Node,
    loadData: HeartbeatLoadData | null
  ): Promise<number> {
    return this.loadMonitor.calculateLoadScore(node, loadData);
  }

  /**
   * Factor 2: Queue Depth (0-20 points)
   * Fewer queued jobs = higher score
   */
  private async calculateQueueDepth(node: NodeWithCounts): Promise<number> {
    const queuedJobs = await this.prisma.job.count({
      where: { nodeId: node.id, stage: 'QUEUED' },
    });

    const maxWorkers = node.maxWorkers || 1;

    // Calculate queue ratio (0 = empty, 1 = full queue)
    // Consider queue "full" at 2x maxWorkers
    const fullQueueSize = maxWorkers * 2;
    const queueRatio = Math.min(queuedJobs / fullQueueSize, 1);

    // Score: 20 points at 0 queued, 0 points at full queue
    return Math.round((1 - queueRatio) * 20);
  }

  /**
   * Factor 3: Hardware Capability (0-25 points)
   * GPU (15 pts) + CPU cores (10 pts)
   */
  private calculateHardware(node: Node): number {
    let score = 0;

    // GPU bonus: 15 points
    if (node.hasGpu) {
      score += 15;
    }

    // CPU cores: 0-10 points (normalized to 16 cores max)
    if (node.cpuCores) {
      score += Math.min(node.cpuCores / 16, 1) * 10;
    }

    return Math.round(score);
  }

  /**
   * Factor 4: Historical Performance (0-25 points)
   * Based on average encoding speed (FPS)
   */
  private async calculatePerformance(node: Node): Promise<number> {
    if (!node.avgEncodingSpeed) {
      // No performance data yet - give baseline score
      return 12;
    }

    const maxSpeed = await this.getMaxEncodingSpeed();
    if (maxSpeed <= 0) {
      return 12;
    }

    const speedRatio = Math.min(node.avgEncodingSpeed / maxSpeed, 1);
    return Math.round(speedRatio * 25);
  }

  /**
   * Factor 5: Codec Match (0-20 points)
   * Hardware acceleration bonus for target codec
   */
  private calculateCodecMatch(node: Node, job: Job): number {
    // No GPU = no bonus
    if (!node.hasGpu) {
      return 0;
    }

    const targetCodec = job.targetCodec?.toUpperCase();
    const acceleration = node.acceleration;

    // NVIDIA supports HEVC and AV1 (RTX 40+)
    if (acceleration === 'NVIDIA') {
      if (targetCodec === 'HEVC') return 20;
      if (targetCodec === 'AV1') return 15; // Limited AV1 support
      if (targetCodec === 'H264') return 20;
    }

    // Intel QSV supports HEVC and AV1 (Arc)
    if (acceleration === 'INTEL_QSV') {
      if (targetCodec === 'HEVC') return 18;
      if (targetCodec === 'AV1') return 18;
      if (targetCodec === 'H264') return 20;
    }

    // AMD supports HEVC and AV1 (RX 7000+)
    if (acceleration === 'AMD') {
      if (targetCodec === 'HEVC') return 18;
      if (targetCodec === 'AV1') return 15;
      if (targetCodec === 'H264') return 18;
    }

    // Apple Silicon
    if (acceleration === 'APPLE_M') {
      if (targetCodec === 'HEVC') return 20;
      if (targetCodec === 'H264') return 20;
    }

    return 0;
  }

  /**
   * Factor 6: Library Affinity (0-10 points)
   * Bonus for keeping jobs from same library together
   */
  private async calculateLibraryAffinity(node: Node, job: JobWithRelations): Promise<number> {
    // Count jobs from same library on this node
    const sameLibraryJobs = await this.prisma.job.count({
      where: {
        nodeId: node.id,
        libraryId: job.libraryId,
        stage: { in: ['QUEUED', 'ENCODING'] },
      },
    });

    // Bonus: 5 points if any jobs from same library, up to 10 for 3+
    if (sameLibraryJobs >= 3) return 10;
    if (sameLibraryJobs >= 1) return 5;
    return 0;
  }

  /**
   * Factor 7: ETA Balance (0-15 points)
   * Prefer nodes that will be free sooner
   */
  private async calculateETABalance(node: Node): Promise<number> {
    if (!node.estimatedFreeAt) {
      // No ETA = assume available now
      return 15;
    }

    const now = new Date();
    const hoursUntilFree = (node.estimatedFreeAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilFree <= 0) return 15; // Available now
    if (hoursUntilFree <= 1) return 12; // Free within 1 hour
    if (hoursUntilFree <= 2) return 9; // Free within 2 hours
    if (hoursUntilFree <= 4) return 5; // Free within 4 hours
    if (hoursUntilFree <= 8) return 2; // Free within 8 hours
    return 0; // Busy for 8+ hours
  }

  /**
   * Factor 8: File Size Spread (0-15 points)
   * Spread large files across nodes to balance workload
   */
  private async calculateFileSizeSpread(node: Node, job: Job): Promise<number> {
    const fileSizeGB = Number(job.beforeSizeBytes) / (1024 * 1024 * 1024);

    // Only consider for large files (>5GB)
    if (fileSizeGB < 5) {
      return 8; // Neutral score for small files
    }

    // Check how many large files are already on this node
    const largeFilesOnNode = await this.prisma.job.count({
      where: {
        nodeId: node.id,
        stage: { in: ['QUEUED', 'ENCODING'] },
        beforeSizeBytes: { gt: BigInt(5 * 1024 * 1024 * 1024) },
      },
    });

    // Penalty for nodes with many large files
    if (largeFilesOnNode >= 3) return 0;
    if (largeFilesOnNode >= 2) return 5;
    if (largeFilesOnNode >= 1) return 10;
    return 15; // No large files = preferred
  }

  // ============================================================================
  // NEGATIVE FACTORS
  // ============================================================================

  /**
   * Factor 9: Stickiness (-20 to 0 points)
   * Penalty for migrating jobs that are already assigned
   */
  private calculateStickiness(node: Node, job: Job, config: DistributionConfigData): number {
    // No penalty if job is not assigned yet
    if (!job.nodeId) return 0;

    // No penalty if assigning to same node
    if (job.nodeId === node.id) return 0;

    // Check if job is still in sticky period
    if (job.stickyUntil && new Date() < job.stickyUntil) {
      return -20; // Full penalty during sticky period
    }

    // Check migration count
    if (job.migrationCount >= config.maxMigrationsPerJob) {
      return -20; // Block further migrations
    }

    // Graduated penalty based on migration count
    return -(job.migrationCount * 5); // -5 per previous migration
  }

  /**
   * Factor 10: Transfer Cost (-25 to 0 points)
   * Penalty for cross-node file transfer
   */
  private calculateTransferCost(node: Node, job: JobWithRelations): number {
    // No penalty if node has shared storage
    if (node.hasSharedStorage) return 0;

    // No penalty if file is on this node's library
    if (job.library.nodeId === node.id) return 0;

    // Full penalty for requiring transfer
    return -25;
  }

  /**
   * Factor 11: Reliability (-15 to 0 points)
   * Penalty for nodes with recent failures
   */
  private async calculateReliability(node: Node): Promise<number> {
    // Use cached failure count if available
    const failureCount = node.recentFailureCount || 0;

    if (failureCount === 0) return 0;
    if (failureCount <= 2) return -5;
    if (failureCount <= 5) return -10;
    return -15; // 5+ failures in 24h
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Get distribution config (cached)
   */
  private async getConfig(): Promise<DistributionConfigData> {
    if (this.configCache && Date.now() < this.configCache.expiresAt) {
      return this.configCache.config;
    }

    let config = await this.prisma.distributionConfig.findFirst({
      where: { isActive: true },
    });

    if (!config) {
      // Create default config
      config = await this.prisma.distributionConfig.create({
        data: { id: 'default' },
      });
    }

    this.configCache = {
      config: config as DistributionConfigData,
      expiresAt: Date.now() + 60000, // Cache for 1 minute
    };

    return config as DistributionConfigData;
  }

  /**
   * Get max encoding speed across all nodes
   */
  private async getMaxEncodingSpeed(): Promise<number> {
    if (this.maxSpeedCache && Date.now() < this.maxSpeedCache.expiresAt) {
      return this.maxSpeedCache.value;
    }

    const result = await this.prisma.node.aggregate({
      _max: { avgEncodingSpeed: true },
      where: { avgEncodingSpeed: { not: null } },
    });

    const maxSpeed = result._max.avgEncodingSpeed || 0;

    this.maxSpeedCache = {
      value: maxSpeed,
      expiresAt: Date.now() + 300000, // Cache for 5 minutes
    };

    return maxSpeed;
  }

  /**
   * Decide if a job should migrate to a new node
   */
  async shouldMigrate(
    job: JobWithRelations,
    currentNode: NodeWithCounts,
    candidateNode: NodeWithCounts
  ): Promise<MigrationDecision> {
    const config = await this.getConfig();

    // Check migration count limit
    if (job.migrationCount >= config.maxMigrationsPerJob) {
      return {
        shouldMigrate: false,
        currentScore: 0,
        newScore: 0,
        scoreDelta: 0,
        reason: `Max migrations (${config.maxMigrationsPerJob}) reached`,
      };
    }

    // Check sticky period
    if (job.stickyUntil && new Date() < job.stickyUntil) {
      return {
        shouldMigrate: false,
        currentScore: 0,
        newScore: 0,
        scoreDelta: 0,
        reason: `In sticky period until ${job.stickyUntil.toISOString()}`,
      };
    }

    // Calculate scores
    const currentScore = await this.calculateScore(currentNode, job);
    const candidateScore = await this.calculateScore(candidateNode, job);
    const scoreDelta = candidateScore.totalScore - currentScore.totalScore;

    // Only migrate if score improvement exceeds threshold
    if (scoreDelta < config.migrationScoreThreshold) {
      return {
        shouldMigrate: false,
        currentScore: currentScore.totalScore,
        newScore: candidateScore.totalScore,
        scoreDelta,
        reason: `Score improvement (${scoreDelta.toFixed(1)}) below threshold (${config.migrationScoreThreshold})`,
      };
    }

    return {
      shouldMigrate: true,
      currentScore: currentScore.totalScore,
      newScore: candidateScore.totalScore,
      scoreDelta,
      reason: `Score improvement: ${scoreDelta.toFixed(1)} points`,
    };
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.scoreCache.clear();
    this.configCache = null;
    this.maxSpeedCache = null;
    this.logger.debug('All caches cleared');
  }
}
