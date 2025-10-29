import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * StuckJobRecoveryWorker
 *
 * Background service that monitors and recovers jobs stuck in invalid states.
 * This provides a safety net to ensure jobs never get permanently orphaned.
 *
 * Recovery Scenarios:
 * 1. HEALTH_CHECK stuck (>5 min) → Reset to DETECTED (health check worker will retry)
 * 2. ENCODING stuck (>60 min, no progress) → Reset to QUEUED (suspected node crash)
 * 3. VERIFYING stuck (>30 min) → Reset to QUEUED (verification timeout)
 *
 * Configuration:
 * - RECOVERY_INTERVAL_MS: How often to run recovery (default: 5 minutes)
 * - HEALTH_CHECK_TIMEOUT_MIN: Max time in HEALTH_CHECK before reset (default: 5 min)
 * - ENCODING_TIMEOUT_MIN: Max time in ENCODING without progress (default: 60 min)
 * - VERIFYING_TIMEOUT_MIN: Max time in VERIFYING (default: 30 min)
 */
@Injectable()
export class StuckJobRecoveryWorker implements OnModuleInit {
  private readonly logger = new Logger(StuckJobRecoveryWorker.name);
  private isRunning = false;

  // Configuration
  private readonly INTERVAL_MS = parseInt(
    process.env.RECOVERY_INTERVAL_MS || `${5 * 60 * 1000}`,
    10
  ); // 5 minutes
  private readonly HEALTH_CHECK_TIMEOUT_MIN = parseInt(
    process.env.HEALTH_CHECK_TIMEOUT_MIN || '5',
    10
  );
  private readonly ENCODING_TIMEOUT_MIN = parseInt(process.env.ENCODING_TIMEOUT_MIN || '60', 10);
  private readonly VERIFYING_TIMEOUT_MIN = parseInt(process.env.VERIFYING_TIMEOUT_MIN || '30', 10);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Start the recovery worker when module initializes
   */
  async onModuleInit(): Promise<void> {
    this.logger.log(`Starting StuckJobRecoveryWorker (interval: ${this.INTERVAL_MS / 1000}s)`);
    this.start();
  }

  /**
   * Start the worker loop
   */
  private start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.runWorkerLoop();
  }

  /**
   * Main worker loop
   */
  private async runWorkerLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.recoverStuckJobs();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Recovery worker error: ${errorMessage}`);
      }

      // Wait before next iteration
      await this.sleep(this.INTERVAL_MS);
    }
  }

  /**
   * Find and recover all stuck jobs
   */
  private async recoverStuckJobs(): Promise<void> {
    const now = new Date();

    // Scenario 1: Jobs stuck in HEALTH_CHECK for too long
    const healthCheckCutoff = new Date(now.getTime() - this.HEALTH_CHECK_TIMEOUT_MIN * 60 * 1000);
    const stuckHealthCheck = await this.prisma.job.findMany({
      where: {
        stage: JobStage.HEALTH_CHECK,
        updatedAt: {
          lt: healthCheckCutoff,
        },
      },
      select: {
        id: true,
        fileLabel: true,
        updatedAt: true,
      },
    });

    if (stuckHealthCheck.length > 0) {
      this.logger.warn(
        `Found ${stuckHealthCheck.length} job(s) stuck in HEALTH_CHECK for >${this.HEALTH_CHECK_TIMEOUT_MIN}min`
      );

      for (const job of stuckHealthCheck) {
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            stage: JobStage.DETECTED,
            healthCheckRetries: { increment: 1 },
          },
        });

        this.logger.log(
          `🔄 Recovered stuck HEALTH_CHECK job: ${job.fileLabel} (stuck for ${Math.round((now.getTime() - job.updatedAt.getTime()) / 1000 / 60)}min) → DETECTED`
        );
      }
    }

    // Scenario 2: Jobs stuck in ENCODING for too long without progress
    const encodingCutoff = new Date(now.getTime() - this.ENCODING_TIMEOUT_MIN * 60 * 1000);
    const stuckEncoding = await this.prisma.job.findMany({
      where: {
        stage: JobStage.ENCODING,
        updatedAt: {
          lt: encodingCutoff,
        },
      },
      select: {
        id: true,
        fileLabel: true,
        updatedAt: true,
        progress: true,
      },
    });

    if (stuckEncoding.length > 0) {
      this.logger.warn(
        `Found ${stuckEncoding.length} job(s) stuck in ENCODING for >${this.ENCODING_TIMEOUT_MIN}min`
      );

      for (const job of stuckEncoding) {
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            stage: JobStage.QUEUED,
            progress: 0,
            startedAt: null,
            error: `Encoding timed out (no progress for ${this.ENCODING_TIMEOUT_MIN}min). Suspected node crash. Job reset to queue.`,
          },
        });

        this.logger.log(
          `🔄 Recovered stuck ENCODING job: ${job.fileLabel} (progress: ${job.progress}%, stuck for ${Math.round((now.getTime() - job.updatedAt.getTime()) / 1000 / 60)}min) → QUEUED`
        );
      }
    }

    // Scenario 3: Jobs stuck in VERIFYING for too long
    const verifyingCutoff = new Date(now.getTime() - this.VERIFYING_TIMEOUT_MIN * 60 * 1000);
    const stuckVerifying = await this.prisma.job.findMany({
      where: {
        stage: JobStage.VERIFYING,
        updatedAt: {
          lt: verifyingCutoff,
        },
      },
      select: {
        id: true,
        fileLabel: true,
        updatedAt: true,
      },
    });

    if (stuckVerifying.length > 0) {
      this.logger.warn(
        `Found ${stuckVerifying.length} job(s) stuck in VERIFYING for >${this.VERIFYING_TIMEOUT_MIN}min`
      );

      for (const job of stuckVerifying) {
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            stage: JobStage.QUEUED,
            progress: 0,
            startedAt: null,
            error: `Verification timed out (${this.VERIFYING_TIMEOUT_MIN}min). Job reset to queue.`,
          },
        });

        this.logger.log(
          `🔄 Recovered stuck VERIFYING job: ${job.fileLabel} (stuck for ${Math.round((now.getTime() - job.updatedAt.getTime()) / 1000 / 60)}min) → QUEUED`
        );
      }
    }

    // Log summary
    const totalRecovered = stuckHealthCheck.length + stuckEncoding.length + stuckVerifying.length;
    if (totalRecovered > 0) {
      this.logger.log(`✅ Recovery complete: ${totalRecovered} job(s) recovered`);
    }
  }

  /**
   * Helper: Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Stop the worker (for cleanup)
   */
  stop(): void {
    this.logger.log('Stopping StuckJobRecoveryWorker');
    this.isRunning = false;
  }
}
