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
      const loadPercentage = (activeJobs / node.maxWorkers) * 100;
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
   * Moves jobs from overloaded LOCAL nodes to underutilized LOCAL nodes
   * to maintain even load distribution.
   *
   * @returns Number of jobs rebalanced
   */
  async rebalanceJobs(): Promise<number> {
    this.logger.log('⚖️  Rebalancing jobs across nodes...');

    // Get all online nodes with their load
    const nodes = await this.prisma.node.findMany({
      where: {
        status: 'ONLINE',
        networkLocation: NetworkLocation.LOCAL, // Only rebalance LOCAL nodes
      },
      select: {
        id: true,
        name: true,
        maxWorkers: true,
        _count: {
          select: {
            jobs: {
              where: {
                stage: { in: ['QUEUED'] }, // Only move queued jobs
              },
            },
          },
        },
      },
    });

    if (nodes.length < 2) {
      this.logger.log('Not enough nodes for rebalancing');
      return 0;
    }

    // Calculate load percentage for each node
    const nodeLoads = nodes.map((node) => ({
      ...node,
      load: (node._count.jobs / node.maxWorkers) * 100,
    }));

    // Sort by load (descending)
    nodeLoads.sort((a, b) => b.load - a.load);

    // Find overloaded and underutilized nodes
    const overloaded = nodeLoads.filter((n) => n.load > 80);
    const underutilized = nodeLoads.filter((n) => n.load < 50);

    if (overloaded.length === 0 || underutilized.length === 0) {
      this.logger.log('No rebalancing needed (load is balanced)');
      return 0;
    }

    let movedCount = 0;

    // Move jobs from overloaded to underutilized nodes
    for (const overloadedNode of overloaded) {
      // Get queued jobs from overloaded node
      const jobsToMove = await this.prisma.job.findMany({
        where: {
          nodeId: overloadedNode.id,
          stage: 'QUEUED',
        },
        take: 5, // Move up to 5 jobs per node
        select: { id: true, fileLabel: true },
      });

      for (const job of jobsToMove) {
        // Find best underutilized node
        const targetNode = underutilized[movedCount % underutilized.length];

        // Move job to target node
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
