import { Injectable, Logger } from '@nestjs/common';
import type { Node } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { NodeRepository } from '../../common/repositories/node.repository';
import { isNodeInAllowedWindow } from '../utils/schedule-checker';

/**
 * Node score result with detailed breakdown
 */
export interface NodeScore {
  nodeId: string;
  nodeName: string;
  totalScore: number;
  breakdown: {
    scheduleAvailable: boolean;
    loadScore: number;
    hardwareScore: number;
    performanceScore: number;
  };
}

/**
 * Job Attribution Service
 *
 * Implements weighted fair queuing algorithm for optimal job distribution across nodes.
 *
 * Scoring factors (total 100 points):
 * 1. Schedule availability (binary gate) - node must be in allowed window
 * 2. Current load (0-40 points) - based on active jobs vs maxWorkers
 * 3. Hardware capability (0-30 points) - GPU + CPU cores
 * 4. Historical performance (0-30 points) - average encoding speed
 *
 * Algorithm ensures jobs go to the most available, capable, and performant nodes.
 */
@Injectable()
export class JobAttributionService {
  private readonly logger = new Logger(JobAttributionService.name);

  // Cache node scores for 1 minute to avoid recalculation overhead
  private scoreCache = new Map<string, { score: NodeScore; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 60 * 1000; // 1 minute

  // CRITICAL FIX #1: Mutex locks to prevent cache race conditions
  // Prevents multiple workers from simultaneously calculating scores for same node
  private scoreLocks = new Map<string, Promise<NodeScore>>();

  // Cache max encoding speed for 5 minutes to avoid repeated queries
  private maxSpeedCache: { value: number; expiresAt: number } | null = null;
  private readonly MAX_SPEED_CACHE_TTL_MS = 300000; // 5 minutes

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly nodeRepository: NodeRepository
  ) {}

  /**
   * Find the optimal node for a job using weighted scoring
   */
  async findOptimalNode(jobId: string): Promise<Node | null> {
    const job = await this.jobRepository
      .findManyWithInclude<
        import('@prisma/client').Job & { library: import('@prisma/client').Library }
      >({
        where: { id: jobId },
        include: { library: true },
      })
      .then((results) => results[0] ?? null);

    if (!job) {
      this.logger.warn(`Job ${jobId} not found`);
      return null;
    }

    // Get all available nodes
    const nodes = await this.nodeRepository.findOnlineWithAllJobCount();

    if (nodes.length === 0) {
      this.logger.warn('No online nodes available');
      return null;
    }

    // Score all nodes
    const scores = await Promise.all(nodes.map((node) => this.calculateNodeScore(node)));

    // Filter out nodes with score 0 (outside schedule or unavailable)
    const availableScores = scores.filter((s) => s.totalScore > 0);

    if (availableScores.length === 0) {
      this.logger.warn('No nodes available within their schedule windows');
      return null;
    }

    // Sort by score (highest first)
    availableScores.sort((a, b) => b.totalScore - a.totalScore);

    const winner = availableScores[0];
    this.logger.log(
      `Optimal node for job ${jobId}: ${winner.nodeName} (score: ${winner.totalScore.toFixed(2)})`
    );

    // Return the winning node
    return nodes.find((n) => n.id === winner.nodeId) || null;
  }

  /**
   * Calculate weighted score for a node
   * CRITICAL FIX #1: Atomic cache operations to prevent race conditions
   */
  async calculateNodeScore(node: Node & { _count: { jobs: number } }): Promise<NodeScore> {
    // Check cache first (still fast path for hits)
    const cached = this.scoreCache.get(node.id);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.score;
    }

    // CRITICAL FIX #1: Check if calculation is already in progress (mutex pattern)
    const existingLock = this.scoreLocks.get(node.id);
    if (existingLock) {
      // Another worker is calculating this score - wait for it
      return existingLock;
    }

    // Start calculation and store promise as lock
    const calculationPromise = this.performScoreCalculation(node);
    this.scoreLocks.set(node.id, calculationPromise);

    try {
      const score = await calculationPromise;

      // CRITICAL #7 FIX: Write cache WHILE holding lock (before finally releases it)
      // performScoreCalculation already writes cache, but we ensure it's done atomically
      // This prevents race where two workers both calculate and write different cache entries
      this.scoreCache.set(node.id, {
        score,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      });

      return score;
    } finally {
      // Release lock after calculation AND cache write completes
      this.scoreLocks.delete(node.id);
    }
  }

  /**
   * Perform actual score calculation (called by calculateNodeScore with lock protection)
   * CRITICAL FIX #1: Separated from public method to enable mutex pattern
   */
  private async performScoreCalculation(
    node: Node & { _count: { jobs: number } }
  ): Promise<NodeScore> {
    let totalScore = 0;
    const breakdown = {
      scheduleAvailable: false,
      loadScore: 0,
      hardwareScore: 0,
      performanceScore: 0,
    };

    // Factor 1: Schedule availability (binary gate)
    const inSchedule = isNodeInAllowedWindow(node);
    breakdown.scheduleAvailable = inSchedule;

    if (!inSchedule) {
      // Node is outside schedule window - score is 0
      const score: NodeScore = {
        nodeId: node.id,
        nodeName: node.name,
        totalScore: 0,
        breakdown,
      };

      this.scoreCache.set(node.id, {
        score,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      });

      return score;
    }

    // Factor 2: Load score (0-40 points)
    // Lower load = higher score
    const currentJobs = node._count.jobs;
    const maxWorkers = node.maxWorkers || 1;
    const loadRatio = Math.min(currentJobs / maxWorkers, 1); // Cap at 1.0
    const loadScore = (1 - loadRatio) * 40;
    breakdown.loadScore = loadScore;
    totalScore += loadScore;

    // Factor 3: Hardware capability (0-30 points)
    let hardwareScore = 0;

    // GPU bonus: 15 points
    if (node.hasGpu) {
      hardwareScore += 15;
    }

    // CPU cores: 0-15 points (normalized to 16 cores max)
    if (node.cpuCores) {
      const cpuScore = Math.min(node.cpuCores / 16, 1) * 15;
      hardwareScore += cpuScore;
    }

    breakdown.hardwareScore = hardwareScore;
    totalScore += hardwareScore;

    // Factor 4: Historical performance (0-30 points)
    // Based on average encoding speed (FPS)
    let performanceScore = 0;

    if (node.avgEncodingSpeed) {
      // Get max speed across all nodes for normalization
      const maxSpeed = await this.getMaxEncodingSpeed();

      if (maxSpeed > 0) {
        const speedRatio = Math.min(node.avgEncodingSpeed / maxSpeed, 1);
        performanceScore = speedRatio * 30;
      }
    } else {
      // No performance data yet - give baseline score of 15 points
      performanceScore = 15;
    }

    breakdown.performanceScore = performanceScore;
    totalScore += performanceScore;

    const score: NodeScore = {
      nodeId: node.id,
      nodeName: node.name,
      totalScore,
      breakdown,
    };

    // Cache the result
    this.scoreCache.set(node.id, {
      score,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });

    return score;
  }

  /**
   * Get all node scores (for visualization)
   */
  async getAllNodeScores(): Promise<NodeScore[]> {
    const nodes = await this.nodeRepository.findOnlineWithAllJobCount();

    return Promise.all(nodes.map((node) => this.calculateNodeScore(node)));
  }

  /**
   * Get maximum encoding speed across all nodes (for normalization)
   */
  private async getMaxEncodingSpeed(): Promise<number> {
    // Check cache first
    if (this.maxSpeedCache && Date.now() < this.maxSpeedCache.expiresAt) {
      return this.maxSpeedCache.value;
    }

    // Cache miss or expired - fetch from database
    const maxSpeed = await this.nodeRepository.aggregateMaxEncodingSpeed();

    // Update cache
    this.maxSpeedCache = {
      value: maxSpeed,
      expiresAt: Date.now() + this.MAX_SPEED_CACHE_TTL_MS,
    };

    return maxSpeed;
  }

  /**
   * Clear score cache (useful after node configuration changes)
   * CRITICAL FIX #1: Also clear locks to prevent stale lock references
   */
  clearCache(): void {
    this.scoreCache.clear();
    this.scoreLocks.clear(); // CRITICAL FIX #1: Clear locks too
    this.maxSpeedCache = null;
    this.logger.debug('Score cache, locks, and max speed cache cleared');
  }
}
