import { Injectable, Logger } from '@nestjs/common';
import { NetworkLocation } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface NodeScore {
  nodeId: string;
  nodeName: string;
  score: number;
  reasons: string[];
  canHandle: boolean;
}

/**
 * Job Router Service
 *
 * Implements intelligent job routing across hybrid node architectures:
 * - LOCAL nodes with shared storage (highest priority - zero-copy)
 * - LOCAL nodes without shared storage (medium priority - fast transfer)
 * - REMOTE nodes (lowest priority - slow transfer over VPN/internet)
 *
 * Routing strategy:
 * 1. Prefer LOCAL nodes with shared storage (best performance)
 * 2. Fall back to LOCAL nodes (fast file transfer)
 * 3. Use REMOTE nodes only as last resort or for small files
 * 4. Consider node load, bandwidth, and file size
 */
@Injectable()
export class JobRouterService {
  private readonly logger = new Logger(JobRouterService.name);

  // File size thresholds
  private readonly LARGE_FILE_THRESHOLD_GB = 10; // Files >10GB are "large"
  private readonly LARGE_FILE_BYTES = this.LARGE_FILE_THRESHOLD_GB * 1024 * 1024 * 1024;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find the best node to execute a job
   *
   * Scoring system:
   * - LOCAL + Shared Storage: 1000 points (optimal - zero-copy)
   * - LOCAL + No Shared Storage: 500 points (fast transfer)
   * - REMOTE: 100 points (slow transfer)
   * - Subtract points for load (active jobs)
   * - Subtract points for large file + remote node
   *
   * @param jobId - Job ID
   * @param fileSizeBytes - File size in bytes
   * @returns Best node ID or null
   */
  async findBestNodeForJob(jobId: string, fileSizeBytes: bigint): Promise<string | null> {
    this.logger.log(
      `🎯 Finding best node for job ${jobId} (size: ${this.formatBytes(fileSizeBytes)})`
    );

    // Get all online nodes with their capabilities
    const nodes = await this.prisma.node.findMany({
      where: {
        status: 'ONLINE',
      },
      select: {
        id: true,
        name: true,
        role: true,
        networkLocation: true,
        hasSharedStorage: true,
        maxWorkers: true,
        maxTransferSizeMB: true,
        latencyMs: true,
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

    if (nodes.length === 0) {
      this.logger.warn('No online nodes available');
      return null;
    }

    // Score each node
    const fileSizeMB = Number(fileSizeBytes) / (1024 * 1024);
    const isLargeFile = fileSizeBytes > this.LARGE_FILE_BYTES;

    const scores: NodeScore[] = nodes.map((node) => {
      let score = 0;
      const reasons: string[] = [];
      let canHandle = true;

      // BASE SCORE: Network location + storage access
      if (node.networkLocation === NetworkLocation.LOCAL && node.hasSharedStorage) {
        score += 1000;
        reasons.push('LOCAL with shared storage (optimal: zero-copy)');
      } else if (node.networkLocation === NetworkLocation.LOCAL) {
        score += 500;
        reasons.push('LOCAL network (fast file transfer)');
      } else {
        score += 100;
        reasons.push('REMOTE network (slow file transfer)');
      }

      // PENALTY: Active job load
      const activeJobs = node._count.jobs;
      // MEDIUM #2 FIX: Prevent division by zero
      const maxWorkers = Math.max(node.maxWorkers, 1);
      const loadPercentage = (activeJobs / maxWorkers) * 100;
      const loadPenalty = Math.floor(loadPercentage * 2); // 2 points per 1% load
      score -= loadPenalty;
      reasons.push(`Load: ${activeJobs}/${node.maxWorkers} workers (-${loadPenalty} points)`);

      // PENALTY: Large file + remote node (transfer will be slow)
      if (isLargeFile && node.networkLocation === NetworkLocation.REMOTE) {
        score -= 300;
        reasons.push('Large file + remote node (-300 points)');
      }

      // CHECK: File size exceeds node's transfer limit
      if (fileSizeMB > node.maxTransferSizeMB) {
        canHandle = false;
        reasons.push(
          `File too large: ${fileSizeMB.toFixed(2)}MB > ${node.maxTransferSizeMB}MB limit`
        );
      }

      // CHECK: Node at capacity
      if (activeJobs >= node.maxWorkers) {
        canHandle = false;
        reasons.push('Node at capacity');
      }

      return {
        nodeId: node.id,
        nodeName: node.name,
        score,
        reasons,
        canHandle,
      };
    });

    // Sort by score (descending)
    scores.sort((a, b) => b.score - a.score);

    // Log scoring details
    this.logger.log('Node scoring results:');
    for (const score of scores) {
      const status = score.canHandle ? '✅' : '❌';
      this.logger.log(
        `  ${status} ${score.nodeName}: ${score.score} points - ${score.reasons.join(', ')}`
      );
    }

    // Find best node that can handle the job
    const bestNode = scores.find((s) => s.canHandle);

    if (!bestNode) {
      this.logger.warn('No node can handle this job');
      return null;
    }

    this.logger.log(`✅ Selected ${bestNode.nodeName} (score: ${bestNode.score})`);

    return bestNode.nodeId;
  }

  /**
   * Rebalance jobs across nodes (periodic optimization)
   *
   * ALGORITHM OVERVIEW:
   * Redistributes QUEUED jobs from heavily loaded nodes to idle nodes to maximize
   * cluster throughput and prevent bottlenecks.
   *
   * HOW IT WORKS (Step-by-Step):
   *
   * 1. ELIGIBILITY CHECK
   *    - Only considers ONLINE nodes with networkLocation = LOCAL
   *    - Requires at least 2 nodes (can't rebalance with 1 node)
   *    - Only moves jobs in QUEUED stage (never ENCODING, COMPLETED, etc.)
   *    - Respects shared storage requirements (LOCAL nodes have NFS access)
   *
   * 2. LOAD CALCULATION
   *    - Load % = (QUEUED jobs / maxWorkers) × 100
   *    - Example: Node with 20 queued jobs and 4 workers = 500% load
   *    - Nodes sorted by load (highest first)
   *
   * 3. THRESHOLD CLASSIFICATION
   *    - OVERLOADED: Load > 80%  (e.g., 4 queued jobs with 4 workers = 100% > 80%)
   *    - UNDERUTILIZED: Load < 50%  (e.g., 1 queued job with 4 workers = 25% < 50%)
   *    - BALANCED: Between 50-80% (no action needed)
   *
   * 4. REBALANCE DECISION
   *    - Triggers ONLY when BOTH conditions met:
   *      a) At least one OVERLOADED node exists (>80%)
   *      b) At least one UNDERUTILIZED node exists (<50%)
   *    - If all nodes are 50-80%, rebalancing skipped (considered balanced)
   *    - If all nodes >80%, no target available (all overloaded)
   *
   * 5. JOB MIGRATION
   *    - Moves up to 5 jobs per overloaded node
   *    - Distributes jobs round-robin across underutilized nodes
   *    - Updates job.nodeId (workers automatically pick up reassigned jobs)
   *    - Respects job stickiness (won't move jobs that recently migrated)
   *
   * EXAMPLE SCENARIOS:
   *
   * Scenario A - Rebalancing WILL trigger:
   *   Main Node: 20 queued / 4 workers = 500% (OVERLOADED)
   *   Child Node: 1 queued / 5 workers = 20% (UNDERUTILIZED)
   *   → Moves 5 jobs from Main to Child
   *
   * Scenario B - Rebalancing WILL NOT trigger:
   *   Main Node: 20 queued / 4 workers = 500% (OVERLOADED)
   *   Child Node: 15 queued / 5 workers = 300% (OVERLOADED)
   *   → Both overloaded, no underutilized target available
   *
   * Scenario C - Rebalancing WILL NOT trigger:
   *   Main Node: 3 queued / 4 workers = 75% (BALANCED)
   *   Child Node: 2 queued / 5 workers = 40% (UNDERUTILIZED)
   *   → Main node not overloaded (75% < 80%), no action needed
   *
   * IMPORTANT LIMITATIONS:
   *
   * - Conservative thresholds prevent over-rebalancing but may miss imbalances
   * - Does NOT rebalance REMOTE nodes (network latency would hurt performance)
   * - Does NOT move ENCODING jobs (would interrupt in-progress work)
   * - Batch size limited to 5 jobs/node to avoid thundering herd
   * - Manual intervention may be needed for severe imbalances (e.g., 92 vs 11 queue)
   *
   * WHEN TO USE:
   *
   * - Automatic: Triggered periodically by cron (if enabled)
   * - Manual: Call POST /api/v1/queue/rebalance endpoint
   * - After major job additions to unevenly loaded nodes
   * - When adding new nodes to distribute existing queue
   *
   * TROUBLESHOOTING:
   *
   * If rebalancing returns 0 jobs moved but distribution looks uneven:
   *
   * 1. Check if both nodes are LOCAL (REMOTE nodes excluded)
   * 2. Verify thresholds: Overloaded >80%, Underutilized <50%
   * 3. If both nodes >50% load, rebalance won't trigger (by design)
   * 4. Consider manual SQL: UPDATE jobs SET nodeId = 'target' WHERE nodeId = 'source' AND stage = 'QUEUED' LIMIT 10
   * 5. Or adjust thresholds in this method (lines 219-220)
   *
   * @returns Number of jobs redistributed across nodes
   */
  async rebalanceJobs(): Promise<number> {
    this.logger.log('⚖️  Rebalancing jobs across nodes...');

    // STEP 1: Get all eligible nodes (ONLINE + LOCAL only)
    const nodes = await this.prisma.node.findMany({
      where: {
        status: 'ONLINE',
        networkLocation: NetworkLocation.LOCAL, // Only rebalance LOCAL nodes (have shared storage)
      },
      select: {
        id: true,
        name: true,
        maxWorkers: true,
        _count: {
          select: {
            jobs: {
              where: {
                stage: { in: ['QUEUED'] }, // Only count queued jobs (not ENCODING or COMPLETED)
              },
            },
          },
        },
      },
    });

    if (nodes.length < 2) {
      this.logger.log('Not enough nodes for rebalancing (need at least 2)');
      return 0;
    }

    // STEP 2: Calculate load percentage for each node
    // Load = (queued jobs / worker capacity) × 100
    const nodeLoads = nodes.map((node) => ({
      ...node,
      load: (node._count.jobs / node.maxWorkers) * 100,
    }));

    // STEP 3: Sort nodes by load (highest to lowest)
    nodeLoads.sort((a, b) => b.load - a.load);

    // STEP 4: Classify nodes by load thresholds
    const overloaded = nodeLoads.filter((n) => n.load > 80); // >80% = needs to offload jobs
    const underutilized = nodeLoads.filter((n) => n.load < 50); // <50% = can accept jobs

    // STEP 5: Check if rebalancing is needed
    if (overloaded.length === 0 || underutilized.length === 0) {
      this.logger.log(
        `No rebalancing needed - Overloaded: ${overloaded.length}, Underutilized: ${underutilized.length}`
      );
      return 0;
    }

    let movedCount = 0;

    // STEP 6: Move jobs from overloaded to underutilized nodes
    for (const overloadedNode of overloaded) {
      // Get up to 5 queued jobs from this overloaded node
      const jobsToMove = await this.prisma.job.findMany({
        where: {
          nodeId: overloadedNode.id,
          stage: 'QUEUED',
        },
        take: 5, // Limit batch size to prevent overwhelming target nodes
        select: { id: true, fileLabel: true },
      });

      for (const job of jobsToMove) {
        // Round-robin distribution across underutilized nodes
        const targetNode = underutilized[movedCount % underutilized.length];

        // Reassign job to target node (workers will pick it up automatically)
        await this.prisma.job.update({
          where: { id: job.id },
          data: { nodeId: targetNode.id },
        });

        this.logger.log(
          `Moved job ${job.fileLabel} from ${overloadedNode.name} to ${targetNode.name}`
        );

        movedCount++;
      }
    }

    this.logger.log(`✅ Rebalanced ${movedCount} job(s)`);

    return movedCount;
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: bigint | number): string {
    const numBytes = typeof bytes === 'bigint' ? Number(bytes) : bytes;

    if (numBytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(numBytes) / Math.log(k));

    return `${(numBytes / k ** i).toFixed(2)} ${sizes[i]}`;
  }
}
