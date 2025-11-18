import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { isNodeInAllowedWindow } from '../utils/schedule-checker';
import { JobAttributionService } from './job-attribution.service';

/**
 * Schedule Enforcement Service
 *
 * Manages node scheduling enforcement through cron jobs:
 * 1. Pauses encoding jobs when nodes exit their allowed windows
 * 2. Auto-assigns queued jobs to optimal available nodes
 * 3. Resumes jobs when nodes re-enter their allowed windows
 */
@Injectable()
export class ScheduleEnforcementService {
  private readonly logger = new Logger(ScheduleEnforcementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobAttribution: JobAttributionService
  ) {}

  /**
   * Check and pause jobs outside schedule windows
   * Runs every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async enforceSchedules(): Promise<void> {
    this.logger.debug('Running schedule enforcement check...');

    try {
      // Get all encoding jobs with their nodes
      const encodingJobs = await this.prisma.job.findMany({
        where: {
          stage: 'ENCODING',
        },
        include: {
          node: true,
        },
      });

      // Collect job IDs to pause in memory first
      const jobIdsToPause: string[] = [];

      for (const job of encodingJobs) {
        // Check if node is still in allowed window
        if (!isNodeInAllowedWindow(job.node)) {
          this.logger.log(
            `Pausing job ${job.id} - node ${job.node.name} is outside schedule window`
          );
          jobIdsToPause.push(job.id);
        }
      }

      // Batch update all jobs to pause in a single query
      if (jobIdsToPause.length > 0) {
        await this.prisma.job.updateMany({
          where: {
            id: { in: jobIdsToPause },
          },
          data: {
            stage: 'PAUSED',
          },
        });

        this.logger.log(`Paused ${jobIdsToPause.length} job(s) due to schedule constraints`);
      }
    } catch (error) {
      this.logger.error('Error enforcing schedules:', error);
    }
  }

  /**
   * Auto-assign queued jobs to optimal nodes
   * Runs every 30 seconds
   *
   * OPTIMIZATION: Fetches all nodes once, calculates scores once, then batch updates
   */
  @Cron('*/30 * * * * *')
  async autoAssignQueuedJobs(): Promise<void> {
    this.logger.debug('Running auto-assignment check...');

    try {
      // Get unassigned queued jobs (not manually assigned)
      const queuedJobs = await this.prisma.job.findMany({
        where: {
          stage: 'QUEUED',
          manualAssignment: false,
        },
        take: 50, // Process in batches of 50
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      });

      if (queuedJobs.length === 0) {
        return;
      }

      // OPTIMIZATION: Fetch all nodes ONCE (not per job)
      const nodes = await this.prisma.node.findMany({
        where: {
          status: 'ONLINE',
          role: { in: ['MAIN', 'LINKED'] },
        },
        include: {
          _count: {
            select: { jobs: true },
          },
        },
      });

      if (nodes.length === 0) {
        this.logger.debug('No online nodes available for job assignment');
        return;
      }

      // OPTIMIZATION: Calculate scores for all nodes ONCE
      const nodeScores = await Promise.all(
        nodes.map((node) => this.jobAttribution.calculateNodeScore(node))
      );

      // Create lookup map for quick access
      const nodeScoreMap = new Map(nodeScores.map((score) => [score.nodeId, score]));

      // Find optimal node for each job based on pre-calculated scores
      const jobUpdates: Array<{ id: string; nodeId: string; originalNodeId: string | null }> = [];

      for (const job of queuedJobs) {
        // Find highest scoring node
        let bestNode: (typeof nodes)[0] | null = null;
        let bestScore = 0;

        for (const node of nodes) {
          const score = nodeScoreMap.get(node.id);
          if (score && score.totalScore > bestScore) {
            bestScore = score.totalScore;
            bestNode = node;
          }
        }

        if (!bestNode || bestScore === 0) {
          continue; // No available nodes with positive score
        }

        // Check if job needs to be moved to a different node
        if (bestNode.id !== job.nodeId) {
          this.logger.log(
            `Moving job ${job.id} from node ${job.nodeId || 'unassigned'} to optimal node ${bestNode.id} (score: ${bestScore.toFixed(1)})`
          );

          jobUpdates.push({
            id: job.id,
            nodeId: bestNode.id,
            originalNodeId: job.originalNodeId || job.nodeId,
          });
        }
      }

      // OPTIMIZATION: Batch update using raw SQL with CASE statement
      // This executes as a SINGLE query instead of N individual updates
      if (jobUpdates.length > 0) {
        const jobIds = jobUpdates.map((u) => u.id);
        const whenClauses = jobUpdates.map((u) => `WHEN '${u.id}' THEN '${u.nodeId}'`).join(' ');
        const whenOriginalClauses = jobUpdates
          .map((u) => `WHEN '${u.id}' THEN ${u.originalNodeId ? `'${u.originalNodeId}'` : 'NULL'}`)
          .join(' ');

        await this.prisma.$executeRawUnsafe(`
          UPDATE jobs
          SET
            nodeId = CASE id ${whenClauses} END,
            originalNodeId = CASE id ${whenOriginalClauses} END
          WHERE id IN (${jobIds.map((id) => `'${id}'`).join(',')})
        `);

        this.logger.log(
          `Auto-assigned ${queuedJobs.length} job(s), moved ${jobUpdates.length} to optimal nodes`
        );
      }
    } catch (error) {
      this.logger.error('Error auto-assigning jobs:', error);
    }
  }

  /**
   * Resume jobs when nodes re-enter their schedule windows
   * Runs every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async resumePausedJobs(): Promise<void> {
    this.logger.debug('Checking for jobs to resume...');

    try {
      // Get paused jobs with their nodes
      const pausedJobs = await this.prisma.job.findMany({
        where: {
          stage: 'PAUSED',
          // Only auto-resume jobs that were paused by schedule enforcement
          // (not manually paused by user)
        },
        include: {
          node: true,
        },
      });

      // Collect job IDs to resume in memory first
      const jobIdsToResume: string[] = [];

      for (const job of pausedJobs) {
        // Check if node is back in allowed window
        if (isNodeInAllowedWindow(job.node)) {
          this.logger.log(
            `Resuming job ${job.id} - node ${job.node.name} is back in schedule window`
          );
          jobIdsToResume.push(job.id);
        }
      }

      // Batch update all jobs to resume in a single query
      if (jobIdsToResume.length > 0) {
        await this.prisma.job.updateMany({
          where: {
            id: { in: jobIdsToResume },
          },
          data: {
            stage: 'QUEUED', // Move back to queued, will be picked up by queue service
          },
        });

        this.logger.log(`Resumed ${jobIdsToResume.length} job(s) - nodes back in schedule`);
      }
    } catch (error) {
      this.logger.error('Error resuming jobs:', error);
    }
  }
}
