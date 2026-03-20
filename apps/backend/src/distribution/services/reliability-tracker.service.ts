import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Job, JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { NodeRepository } from '../../common/repositories/node.repository';
import { NodeFailureLogRepository } from '../../common/repositories/node-failure-log.repository';

/**
 * Reliability Tracker Service
 *
 * Tracks job failures per node to calculate reliability scores.
 * Maintains a 24-hour sliding window of failures.
 */
@Injectable()
export class ReliabilityTrackerService {
  private readonly logger = new Logger(ReliabilityTrackerService.name);

  constructor(
    private readonly nodeFailureLogRepository: NodeFailureLogRepository,
    private readonly nodeRepository: NodeRepository,
    private readonly jobRepository: JobRepository
  ) {}

  /**
   * Record a job failure for a node
   */
  async recordFailure(nodeId: string, job: Job, reason: string, errorCode?: string): Promise<void> {
    try {
      // Create failure log entry
      await this.nodeFailureLogRepository.createLog({
        nodeId,
        reason,
        errorCode,
        stage: job.stage as JobStage,
        progress: job.progress,
        jobId: job.id,
        filePath: job.filePath,
        fileSize: job.beforeSizeBytes,
      });

      // Update node's failure count
      await this.updateNodeFailureStats(nodeId);

      this.logger.warn(`Recorded failure for node ${nodeId}: ${reason} (job: ${job.id})`);
    } catch (error: unknown) {
      this.logger.error(`Failed to record failure for node ${nodeId}`, error);
    }
  }

  /**
   * Update failure statistics for a node
   */
  async updateNodeFailureStats(nodeId: string): Promise<void> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Count failures in last 24 hours
    const failureCount = await this.nodeFailureLogRepository.countForNodeSince(
      nodeId,
      twentyFourHoursAgo
    );

    // Get last failure
    const lastFailure = await this.nodeFailureLogRepository.findLastForNode(nodeId);

    // Calculate failure rate (failures per 100 jobs)
    const jobsCompleted24h = await this.jobRepository.countCompletedForNodeSince(
      nodeId,
      twentyFourHoursAgo
    );

    const totalJobs24h = jobsCompleted24h + failureCount;
    const failureRate = totalJobs24h > 0 ? (failureCount / totalJobs24h) * 100 : 0;

    // Update node
    await this.nodeRepository.updateById(nodeId, {
      recentFailureCount: failureCount,
      lastFailureAt: lastFailure?.createdAt || null,
      failureRate24h: Math.round(failureRate * 100) / 100,
    });

    this.logger.debug(
      `Updated failure stats for node ${nodeId}: count=${failureCount}, rate=${failureRate.toFixed(1)}%`
    );
  }

  /**
   * Get failure summary for a node
   */
  async getFailureSummary(nodeId: string): Promise<{
    count24h: number;
    failureRate: number;
    lastFailure: Date | null;
    topReasons: { reason: string; count: number }[];
  }> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get failures in last 24h
    const failures = await this.nodeFailureLogRepository.findRecentForNode(
      nodeId,
      twentyFourHoursAgo
    );

    // Count by reason
    const reasonCounts = new Map<string, number>();
    let lastFailure: Date | null = null;

    for (const failure of failures) {
      const count = reasonCounts.get(failure.reason) || 0;
      reasonCounts.set(failure.reason, count + 1);

      if (!lastFailure || failure.createdAt > lastFailure) {
        lastFailure = failure.createdAt;
      }
    }

    // Sort by count
    const topReasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Get node stats
    const node = await this.nodeRepository.findWithSelect<{ failureRate24h: number | null }>(
      nodeId,
      { failureRate24h: true }
    );

    return {
      count24h: failures.length,
      failureRate: node?.failureRate24h || 0,
      lastFailure,
      topReasons,
    };
  }

  /**
   * Cleanup old failure logs (keep 7 days)
   * Runs daily at 3 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupOldFailureLogs(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    try {
      const result = await this.nodeFailureLogRepository.deleteOlderThan(sevenDaysAgo);

      if (result.count > 0) {
        this.logger.log(`Cleaned up ${result.count} old failure logs`);
      }
    } catch (error: unknown) {
      this.logger.error('Failed to cleanup old failure logs', error);
    }
  }

  /**
   * Refresh failure stats for all nodes
   * Runs every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async refreshAllNodeStats(): Promise<void> {
    const nodes = await this.nodeRepository.findOnlineIds();

    for (const node of nodes) {
      await this.updateNodeFailureStats(node.id);
    }

    this.logger.debug(`Refreshed failure stats for ${nodes.length} nodes`);
  }

  /**
   * Check if a node is considered unreliable
   */
  isUnreliable(failureCount: number, failureRate: number): boolean {
    // Node is unreliable if:
    // - 5+ failures in 24h, OR
    // - Failure rate > 30%
    return failureCount >= 5 || failureRate > 30;
  }
}
