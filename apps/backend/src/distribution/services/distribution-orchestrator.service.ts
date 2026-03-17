import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Job, Node } from '@prisma/client';
// HIGH #3 FIX: Import at top level instead of dynamic require in hot loop
import * as scheduleChecker from '../../nodes/utils/schedule-checker';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  JobAssignmentResult,
  NodeScore,
  ScoreBreakdownDisplay,
} from '../interfaces/scoring-factors.interface';
import { EtaCalculatorService } from './eta-calculator.service';
import { JobScorerService } from './job-scorer.service';
import { LoadMonitorService } from './load-monitor.service';
import { ReliabilityTrackerService } from './reliability-tracker.service';

type NodeWithCounts = Node & {
  _count: {
    jobs: number;
  };
};

type JobWithRelations = Job & {
  library: { nodeId: string };
};

/**
 * Distribution Orchestrator Service
 *
 * Main coordinator for the Distribution v2 algorithm.
 * Handles job assignment, rebalancing, and provides scoring visibility.
 */
@Injectable()
export class DistributionOrchestratorService {
  private readonly logger = new Logger(DistributionOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scorer: JobScorerService,
    readonly _loadMonitor: LoadMonitorService,
    private readonly etaCalculator: EtaCalculatorService,
    private readonly reliabilityTracker: ReliabilityTrackerService
  ) {}

  /**
   * Find the optimal node for a job
   * Returns the best node and the scoring breakdown
   */
  async findOptimalNode(jobId: string): Promise<JobAssignmentResult | null> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { library: { select: { nodeId: true } } },
    });

    if (!job) {
      this.logger.warn(`Job ${jobId} not found`);
      return null;
    }

    // Get all online nodes
    const nodes = await this.prisma.node.findMany({
      where: { status: 'ONLINE' },
      include: {
        _count: {
          select: { jobs: { where: { stage: { in: ['ENCODING', 'VERIFYING'] } } } },
        },
      },
    });

    if (nodes.length === 0) {
      this.logger.warn('No online nodes available');
      return null;
    }

    // Score all nodes in parallel for better performance
    const scores = await Promise.all(
      nodes.map((node) =>
        this.scorer.calculateScore(node as NodeWithCounts, job as JobWithRelations)
      )
    );

    // Sort by score descending
    scores.sort((a, b) => b.totalScore - a.totalScore);

    const bestNode = scores[0];
    if (bestNode.totalScore === 0) {
      this.logger.warn(`No eligible nodes for job ${jobId} (all scores are 0)`);
      return null;
    }

    const wasMigrated = job.nodeId !== null && job.nodeId !== bestNode.nodeId;

    return {
      jobId,
      nodeId: bestNode.nodeId,
      nodeName: bestNode.nodeName,
      score: bestNode.totalScore,
      factors: bestNode.factors,
      reason: this.generateAssignmentReason(bestNode),
      wasMigrated,
      previousNodeId: wasMigrated ? job.nodeId || undefined : undefined,
    };
  }

  /**
   * Assign a job to a node (or migrate if already assigned)
   */
  async assignJob(jobId: string, nodeId?: string): Promise<JobAssignmentResult | null> {
    // If nodeId not specified, find optimal
    if (!nodeId) {
      const optimal = await this.findOptimalNode(jobId);
      if (!optimal) return null;
      nodeId = optimal.nodeId;
    }

    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { library: { select: { nodeId: true } } },
    });

    if (!job) return null;

    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      include: {
        _count: {
          select: { jobs: { where: { stage: { in: ['ENCODING', 'VERIFYING'] } } } },
        },
      },
    });

    if (!node) return null;

    // Calculate score for the assignment
    const score = await this.scorer.calculateScore(node as NodeWithCounts, job as JobWithRelations);

    const wasMigrated = job.nodeId !== null && job.nodeId !== nodeId;
    const now = new Date();
    const stickyUntil = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

    // Get duration estimate
    const durationEstimate = await this.etaCalculator.estimateDuration(job);

    // CRITICAL #1 FIX: Atomic job assignment with optimistic locking
    // Use updatedAt timestamp to prevent race conditions
    const updateResult = await this.prisma.job.updateMany({
      where: {
        id: jobId,
        nodeId: job.nodeId, // Exact match prevents race if job was reassigned
        updatedAt: job.updatedAt, // Optimistic lock - fails if job modified elsewhere
      },
      data: {
        nodeId,
        assignedAt: now,
        stickyUntil,
        migrationCount: wasMigrated ? { increment: 1 } : undefined,
        estimatedDuration: durationEstimate.estimatedSeconds,
        lastScoreBreakdown: score.factors as object,
        assignmentReason: this.generateAssignmentReason(score),
      },
    });

    // Check if update succeeded (count === 1 means we won the race)
    if (updateResult.count === 0) {
      // Another distribution run claimed this job between findUnique and update
      this.logger.debug(`Job ${jobId} was reassigned by another distribution process, skipping`);
      return null;
    }

    // Update node's queued job count
    await this.updateNodeQueueCount(nodeId);

    // Update ETAs for the node
    await this.etaCalculator.updateNodeETAs(nodeId);

    // If migrated, update old node too
    if (wasMigrated && job.nodeId) {
      await this.updateNodeQueueCount(job.nodeId);
      await this.etaCalculator.updateNodeETAs(job.nodeId);
    }

    this.logger.log(
      `Assigned job ${jobId} to node ${node.name} (score: ${score.totalScore.toFixed(1)}, migrated: ${wasMigrated})`
    );

    return {
      jobId,
      nodeId,
      nodeName: node.name,
      score: score.totalScore,
      factors: score.factors,
      reason: this.generateAssignmentReason(score),
      wasMigrated,
      previousNodeId: wasMigrated ? job.nodeId || undefined : undefined,
    };
  }

  /**
   * Get scores for all online nodes (for a specific job)
   */
  async getAllNodeScores(jobId: string): Promise<NodeScore[]> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { library: { select: { nodeId: true } } },
    });

    if (!job) return [];

    const nodes = await this.prisma.node.findMany({
      where: { status: 'ONLINE' },
      include: {
        _count: {
          select: { jobs: { where: { stage: { in: ['ENCODING', 'VERIFYING'] } } } },
        },
      },
    });

    // Score all nodes in parallel for better performance
    const scores = await Promise.all(
      nodes.map((node) =>
        this.scorer.calculateScore(node as NodeWithCounts, job as JobWithRelations)
      )
    );

    return scores.sort((a, b) => b.totalScore - a.totalScore);
  }

  /**
   * Get score breakdown for UI display
   */
  getScoreBreakdown(score: NodeScore): ScoreBreakdownDisplay[] {
    const factors = score.factors;
    return [
      {
        factor: 'realTimeLoad',
        label: 'Real-time Load',
        value: factors.realTimeLoad,
        maxValue: 30,
        percentage: (factors.realTimeLoad / 30) * 100,
        description: 'Based on actual CPU/memory usage',
      },
      {
        factor: 'queueDepth',
        label: 'Queue Depth',
        value: factors.queueDepth,
        maxValue: 20,
        percentage: (factors.queueDepth / 20) * 100,
        description: 'Fewer queued jobs = higher score',
      },
      {
        factor: 'hardware',
        label: 'Hardware',
        value: factors.hardware,
        maxValue: 25,
        percentage: (factors.hardware / 25) * 100,
        description: 'GPU and CPU capability',
      },
      {
        factor: 'performance',
        label: 'Performance',
        value: factors.performance,
        maxValue: 25,
        percentage: (factors.performance / 25) * 100,
        description: 'Historical encoding speed',
      },
      {
        factor: 'codecMatch',
        label: 'Codec Match',
        value: factors.codecMatch,
        maxValue: 20,
        percentage: (factors.codecMatch / 20) * 100,
        description: 'Hardware acceleration support',
      },
      {
        factor: 'libraryAffinity',
        label: 'Library Affinity',
        value: factors.libraryAffinity,
        maxValue: 10,
        percentage: (factors.libraryAffinity / 10) * 100,
        description: 'Same library bonus',
      },
      {
        factor: 'etaBalance',
        label: 'ETA Balance',
        value: factors.etaBalance,
        maxValue: 15,
        percentage: (factors.etaBalance / 15) * 100,
        description: 'Prefers nodes finishing sooner',
      },
      {
        factor: 'fileSizeSpread',
        label: 'File Size Spread',
        value: factors.fileSizeSpread,
        maxValue: 15,
        percentage: (factors.fileSizeSpread / 15) * 100,
        description: 'Spreads large files',
      },
      {
        factor: 'stickiness',
        label: 'Stickiness',
        value: factors.stickiness,
        maxValue: 0,
        percentage: factors.stickiness === 0 ? 100 : ((20 + factors.stickiness) / 20) * 100,
        description: 'Migration penalty',
      },
      {
        factor: 'transferCost',
        label: 'Transfer Cost',
        value: factors.transferCost,
        maxValue: 0,
        percentage: factors.transferCost === 0 ? 100 : ((25 + factors.transferCost) / 25) * 100,
        description: 'File transfer penalty',
      },
      {
        factor: 'reliability',
        label: 'Reliability',
        value: factors.reliability,
        maxValue: 0,
        percentage: factors.reliability === 0 ? 100 : ((15 + factors.reliability) / 15) * 100,
        description: 'Recent failure penalty',
      },
    ];
  }

  /**
   * Rebalance queued jobs across nodes
   * Returns number of jobs migrated
   */
  async rebalanceJobs(): Promise<{ migratedCount: number; reasons: string[] }> {
    const reasons: string[] = [];
    let migratedCount = 0;

    // Get all QUEUED jobs that can be migrated
    const eligibleJobs = await this.prisma.job.findMany({
      where: {
        stage: 'QUEUED',
        OR: [{ stickyUntil: null }, { stickyUntil: { lt: new Date() } }],
      },
      include: { library: { select: { nodeId: true } } },
      take: 500, // Process larger batches for faster distribution
    });

    for (const job of eligibleJobs) {
      const optimal = await this.findOptimalNode(job.id);
      if (!optimal) continue;

      // Skip if already on optimal node
      if (optimal.nodeId === job.nodeId) continue;

      // Check if current node exists
      if (!job.nodeId) {
        // Job not assigned yet, assign it
        await this.assignJob(job.id, optimal.nodeId);
        migratedCount++;
        reasons.push(`Assigned ${job.fileLabel} to ${optimal.nodeName}`);
        continue;
      }

      // Get current node score
      const currentNode = await this.prisma.node.findUnique({
        where: { id: job.nodeId },
        include: {
          _count: {
            select: { jobs: { where: { stage: { in: ['ENCODING', 'VERIFYING'] } } } },
          },
        },
      });

      if (!currentNode) continue;

      const candidateNode = await this.prisma.node.findUnique({
        where: { id: optimal.nodeId },
        include: {
          _count: {
            select: { jobs: { where: { stage: { in: ['ENCODING', 'VERIFYING'] } } } },
          },
        },
      });

      if (!candidateNode) continue;

      // Check migration decision
      const decision = await this.scorer.shouldMigrate(
        job as JobWithRelations,
        currentNode as NodeWithCounts,
        candidateNode as NodeWithCounts
      );

      if (decision.shouldMigrate) {
        await this.assignJob(job.id, optimal.nodeId);
        migratedCount++;
        reasons.push(
          `Migrated ${job.fileLabel} from ${currentNode.name} to ${optimal.nodeName} (+${decision.scoreDelta.toFixed(1)} pts)`
        );
      }
    }

    this.logger.log(`Rebalance complete: ${migratedCount} jobs migrated`);
    return { migratedCount, reasons };
  }

  /**
   * Automatic job distribution - runs every 30 seconds
   * Fills empty slots on idle/underutilized nodes
   */
  @Interval(30000)
  async autoDistributeJobs(): Promise<void> {
    try {
      // Get nodes with available slots (not at capacity)
      const nodes = await this.prisma.node.findMany({
        where: { status: 'ONLINE' },
        include: {
          _count: {
            select: {
              jobs: {
                where: { stage: { in: ['QUEUED', 'ENCODING', 'VERIFYING'] } },
              },
            },
          },
        },
      });

      // Find nodes with available capacity
      const nodesWithSlots = nodes.filter((node) => {
        const maxWorkers = node.maxWorkers || 1;
        return node._count.jobs < maxWorkers;
      });

      if (nodesWithSlots.length === 0) {
        return; // All nodes at capacity
      }

      // For each node with available slots, try to fill them
      for (const targetNode of nodesWithSlots) {
        const maxWorkers = targetNode.maxWorkers || 1;
        const currentJobs = targetNode._count.jobs;
        const availableSlots = maxWorkers - currentJobs;

        if (availableSlots <= 0) continue;

        // HIGH #3 FIX: Use top-level import instead of dynamic require
        if (!scheduleChecker.isNodeInAllowedWindow(targetNode)) continue;

        // Find QUEUED jobs from OTHER nodes that can be moved here
        // Prioritize moving from overloaded nodes
        const jobsToMove = await this.prisma.job.findMany({
          where: {
            stage: 'QUEUED',
            nodeId: { not: targetNode.id }, // From other nodes
            OR: [{ stickyUntil: null }, { stickyUntil: { lt: new Date() } }],
          },
          orderBy: { createdAt: 'asc' }, // FIFO
          take: availableSlots,
        });

        if (jobsToMove.length === 0) continue;

        // CRITICAL #1 FIX: Move jobs with optimistic locking to prevent race conditions
        // Re-validate schedule immediately before assignment to avoid TOCTOU
        if (!scheduleChecker.isNodeInAllowedWindow(targetNode)) {
          this.logger.debug(
            `Node ${targetNode.name} left schedule window during distribution, skipping`
          );
          continue;
        }

        for (const job of jobsToMove) {
          // Atomic update with optimistic lock - prevents double assignment
          const result = await this.prisma.job.updateMany({
            where: {
              id: job.id,
              nodeId: { not: targetNode.id }, // Skip if already moved
              updatedAt: job.updatedAt, // Optimistic lock
              stage: 'QUEUED', // Only QUEUED jobs
            },
            data: {
              nodeId: targetNode.id,
              assignedAt: new Date(),
              stickyUntil: new Date(Date.now() + 5 * 60 * 1000), // 5 min sticky
            },
          });

          if (result.count === 0) {
            this.logger.debug(`Job ${job.id} already reassigned by another process, skipping`);
            continue;
          }

          this.logger.log(
            `⚡ Auto-distributed: ${job.fileLabel} → ${targetNode.name} (filling empty slot)`
          );
        }

        // Update node queue count
        await this.updateNodeQueueCount(targetNode.id);
      }
    } catch (error) {
      this.logger.error('Auto-distribute error:', error);
    }
  }

  /**
   * Record a job failure and update reliability
   */
  async recordJobFailure(job: Job, reason: string, errorCode?: string): Promise<void> {
    if (!job.nodeId) return;

    await this.reliabilityTracker.recordFailure(job.nodeId, job, reason, errorCode);
  }

  /**
   * Update node's queued job count
   */
  private async updateNodeQueueCount(nodeId: string): Promise<void> {
    const count = await this.prisma.job.count({
      where: { nodeId, stage: 'QUEUED' },
    });

    await this.prisma.node.update({
      where: { id: nodeId },
      data: { queuedJobCount: count },
    });
  }

  /**
   * Generate human-readable assignment reason
   */
  private generateAssignmentReason(score: NodeScore): string {
    const factors = score.factors;
    const reasons: string[] = [];

    // Highlight top positive factors
    if (factors.realTimeLoad >= 25) reasons.push('Low load');
    if (factors.hardware >= 20) reasons.push('Strong hardware');
    if (factors.codecMatch >= 15) reasons.push('HW acceleration');
    if (factors.queueDepth >= 15) reasons.push('Short queue');
    if (factors.libraryAffinity >= 5) reasons.push('Same library');

    // Note negative factors
    if (factors.transferCost < 0) reasons.push('Transfer required');
    if (factors.reliability < 0) reasons.push('Recent failures');

    if (reasons.length === 0) {
      reasons.push('Best available');
    }

    return reasons.join(', ');
  }

  /**
   * Get or create the active distribution config
   */
  async getActiveConfig() {
    let config = await this.prisma.distributionConfig.findFirst({
      where: { isActive: true },
    });

    if (!config) {
      config = await this.prisma.distributionConfig.create({
        data: { id: 'default' },
      });
    }

    return config;
  }

  /**
   * Update distribution config weights
   */
  async updateConfig(dto: Record<string, unknown>) {
    const config = await this.getActiveConfig();

    return this.prisma.distributionConfig.update({
      where: { id: config.id },
      data: dto,
    });
  }

  /**
   * Get capacity status for all online nodes
   */
  async getNodesCapacity(): Promise<{ nodes: unknown[] }> {
    const nodes = await this.prisma.node.findMany({
      where: { status: 'ONLINE' },
      select: { id: true, name: true },
    });

    const capacities = [];
    for (const node of nodes) {
      const capacity = await this._loadMonitor.getNodeCapacity(node.id);
      if (capacity) {
        capacities.push(capacity);
      }
    }

    return { nodes: capacities };
  }

  /**
   * Get distribution summary for dashboard
   */
  async getDistributionSummary(): Promise<{
    totalNodes: number;
    onlineNodes: number;
    totalQueuedJobs: number;
    jobsPerNode: { nodeId: string; nodeName: string; queued: number; encoding: number }[];
  }> {
    const nodes = await this.prisma.node.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        _count: {
          select: {
            jobs: true,
          },
        },
      },
    });

    // Get job counts per node and stage in parallel for better performance
    const jobsPerNode = await Promise.all(
      nodes.map(async (node) => {
        const [queued, encoding] = await Promise.all([
          this.prisma.job.count({
            where: { nodeId: node.id, stage: 'QUEUED' },
          }),
          this.prisma.job.count({
            where: { nodeId: node.id, stage: { in: ['ENCODING', 'VERIFYING'] } },
          }),
        ]);

        return {
          nodeId: node.id,
          nodeName: node.name,
          queued,
          encoding,
        };
      })
    );

    return {
      totalNodes: nodes.length,
      onlineNodes: nodes.filter((n) => n.status === 'ONLINE').length,
      totalQueuedJobs: jobsPerNode.reduce((sum, n) => sum + n.queued, 0),
      jobsPerNode,
    };
  }

  /**
   * Find the best node for a NEW job (before job exists)
   * Uses simplified scoring based on capacity and load
   *
   * @param libraryNodeId - The library's home node (fallback if no better option)
   * @param hasSharedStoragePreference - Prefer nodes with shared storage
   * @returns nodeId of the best available node
   */
  async findBestNodeForNewJob(
    libraryNodeId: string,
    hasSharedStoragePreference = true
  ): Promise<string> {
    // Get all online nodes with schedule check
    const nodes = await this.prisma.node.findMany({
      where: { status: 'ONLINE' },
      include: {
        _count: {
          select: {
            jobs: {
              where: { stage: { in: ['QUEUED', 'ENCODING', 'VERIFYING'] } },
            },
          },
        },
      },
    });

    if (nodes.length === 0) {
      this.logger.warn('No online nodes, falling back to library node');
      return libraryNodeId;
    }

    // Score each node
    const scored = nodes.map((node) => {
      let score = 100; // Base score

      // Check schedule availability (gate)
      // HIGH #3 FIX: Use top-level import instead of dynamic require
      if (!scheduleChecker.isNodeInAllowedWindow(node)) {
        score = 0; // Node not available due to schedule
        return { node, score, reason: 'Outside schedule' };
      }

      // Capacity check - must have available slots
      const activeJobs = node._count.jobs;
      const maxWorkers = node.maxWorkers || 1;
      if (activeJobs >= maxWorkers) {
        score -= 50; // Heavy penalty for at-capacity nodes
      }

      // Queue depth - prefer nodes with fewer queued jobs (load balancing)
      const queueRatio = activeJobs / maxWorkers;
      score -= queueRatio * 30; // Up to -30 for full queue

      // Shared storage bonus - avoid file transfers
      if (hasSharedStoragePreference && node.hasSharedStorage) {
        score += 20;
      }

      // Library affinity - small bonus for staying on same node
      if (node.id === libraryNodeId) {
        score += 5;
      }

      // Hardware bonus
      if (node.hasGpu) {
        score += 10;
      }

      return {
        node,
        score,
        reason: `slots:${maxWorkers - activeJobs}/${maxWorkers}, queue:${queueRatio.toFixed(2)}`,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Log distribution decision
    const best = scored[0];
    if (best.score > 0) {
      this.logger.debug(
        `Distribution: Best node for new job: ${best.node.name} (score: ${best.score.toFixed(1)}, ${best.reason})`
      );
      return best.node.id;
    }

    // Fallback to library node if all nodes are unavailable
    this.logger.debug(`Distribution: All nodes busy/unavailable, using library node`);
    return libraryNodeId;
  }
}
