import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FileHealthStatus, JobStage } from '@prisma/client';
import { FileHealthService } from '../encoding/file-health.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * HealthCheckWorker
 *
 * Background service that performs just-in-time health validation on DETECTED jobs.
 * Implements parallel processing with configurable concurrency for optimal performance.
 *
 * Flow:
 * 1. Find jobs with stage = DETECTED
 * 2. Update to HEALTH_CHECK (visible in UI immediately)
 * 3. Perform FFprobe health analysis in parallel
 * 4. Update job with health results
 * 5. Move to QUEUED if healthy (score >= 40)
 * 6. Move to FAILED if corrupted (score < 40)
 * 7. Retry failed checks up to 3 times (transient failures)
 *
 * Configuration:
 * - HEALTH_CHECK_CONCURRENCY: Number of parallel checks (default: 10)
 * - HEALTH_CHECK_INTERVAL_MS: Polling interval (default: 2000ms)
 * - MIN_HEALTH_SCORE: Minimum score to queue (default: 40)
 * - MAX_RETRY_ATTEMPTS: Max retry attempts (default: 3)
 */
@Injectable()
export class HealthCheckWorker implements OnModuleInit {
  private readonly logger = new Logger(HealthCheckWorker.name);
  private isRunning = false;
  private currentlyChecking = new Set<string>(); // Track in-progress checks

  // Configuration (can be moved to Settings later)
  private readonly CONCURRENCY = parseInt(process.env.HEALTH_CHECK_CONCURRENCY || '10', 10);
  private readonly INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '2000', 10);
  private readonly MIN_HEALTH_SCORE = parseInt(process.env.MIN_HEALTH_SCORE || '40', 10);
  private readonly MAX_RETRY_ATTEMPTS = parseInt(process.env.MAX_RETRY_ATTEMPTS || '3', 10);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileHealthService: FileHealthService
  ) {}

  /**
   * Start the health check worker when the module initializes
   */
  async onModuleInit(): Promise<void> {
    this.logger.log(`Starting HealthCheckWorker with concurrency=${this.CONCURRENCY}`);
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
   * Main worker loop - runs continuously
   */
  private async runWorkerLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.processHealthChecks();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Worker loop error: ${errorMessage}`);
      }

      // Wait before next iteration
      await this.sleep(this.INTERVAL_MS);
    }
  }

  /**
   * Process a batch of health checks with parallel execution
   */
  private async processHealthChecks(): Promise<void> {
    // Calculate how many slots are available
    const availableSlots = this.CONCURRENCY - this.currentlyChecking.size;

    if (availableSlots <= 0) {
      // All slots busy, wait for next iteration
      return;
    }

    // Find jobs that need health checking
    const jobs = await this.prisma.job.findMany({
      where: {
        stage: JobStage.DETECTED,
        id: {
          notIn: Array.from(this.currentlyChecking),
        },
      },
      take: availableSlots,
      orderBy: {
        createdAt: 'asc', // FIFO order
      },
    });

    if (jobs.length === 0) {
      return; // No jobs to process
    }

    this.logger.debug(
      `Processing ${jobs.length} health checks (${this.currentlyChecking.size}/${this.CONCURRENCY} slots busy)`
    );

    // Process jobs in parallel (fire and forget)
    const promises = jobs.map((job) => this.checkJobHealth(job.id));
    await Promise.allSettled(promises);
  }

  /**
   * Perform health check on a single job
   *
   * @param jobId - Job ID to check
   */
  private async checkJobHealth(jobId: string): Promise<void> {
    // Mark as in-progress
    this.currentlyChecking.add(jobId);

    try {
      // Get job details
      const job = await this.prisma.job.findUnique({
        where: { id: jobId },
      });

      if (!job) {
        this.logger.warn(`Job ${jobId} not found, skipping health check`);
        return;
      }

      // Update stage to HEALTH_CHECK (visible in UI)
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          stage: JobStage.HEALTH_CHECK,
        },
      });

      this.logger.debug(`Health checking: ${job.fileLabel}`);

      // Perform health analysis
      const healthResult = await this.fileHealthService.analyzeFile(job.filePath);

      // Determine next stage based on health result
      let nextStage: JobStage;
      let errorMessage: string | null = null;

      if (healthResult.canEncode && healthResult.score >= this.MIN_HEALTH_SCORE) {
        // Healthy enough to encode
        nextStage = JobStage.QUEUED;
        this.logger.log(`✓ ${job.fileLabel} - HEALTHY (score: ${healthResult.score}/100) → QUEUED`);
      } else {
        // Too corrupted to encode
        nextStage = JobStage.FAILED;
        errorMessage = `Health check failed: ${healthResult.issues.join(', ')}`;
        this.logger.warn(
          `✗ ${job.fileLabel} - CORRUPTED (score: ${healthResult.score}/100) → FAILED`
        );
      }

      // Build health message
      const healthMessage = this.buildHealthMessage(healthResult);

      // Update job with health results
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          stage: nextStage,
          healthStatus: healthResult.status,
          healthScore: healthResult.score,
          healthMessage,
          healthCheckedAt: new Date(),
          error: errorMessage,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Health check failed for job ${jobId}: ${errorMessage}`);

      // Get current retry count
      const job = await this.prisma.job.findUnique({
        where: { id: jobId },
        select: { healthCheckRetries: true, fileLabel: true },
      });

      if (!job) {
        return;
      }

      const retries = job.healthCheckRetries + 1;

      if (retries >= this.MAX_RETRY_ATTEMPTS) {
        // Max retries reached, mark as failed
        await this.prisma.job.update({
          where: { id: jobId },
          data: {
            stage: JobStage.FAILED,
            healthStatus: FileHealthStatus.CORRUPTED,
            healthScore: 0,
            healthMessage: `Health check failed after ${retries} attempts`,
            healthCheckRetries: retries,
            error: `Health check error: ${errorMessage}`,
          },
        });
        this.logger.error(`Job ${job.fileLabel} failed health check after ${retries} attempts`);
      } else {
        // Retry later - reset to DETECTED
        await this.prisma.job.update({
          where: { id: jobId },
          data: {
            stage: JobStage.DETECTED,
            healthCheckRetries: retries,
          },
        });
        this.logger.debug(
          `Job ${job.fileLabel} health check retry ${retries}/${this.MAX_RETRY_ATTEMPTS}`
        );
      }
    } finally {
      // Remove from in-progress set
      this.currentlyChecking.delete(jobId);
    }
  }

  /**
   * Build a user-friendly health message
   *
   * @param result - Health check result
   * @returns Formatted health message
   */
  private buildHealthMessage(result: {
    status: FileHealthStatus;
    score: number;
    issues: string[];
    warnings: string[];
  }): string {
    const parts: string[] = [];

    // Add status emoji
    const emoji = {
      [FileHealthStatus.HEALTHY]: '✅',
      [FileHealthStatus.WARNING]: '⚠️',
      [FileHealthStatus.AT_RISK]: '⚠️',
      [FileHealthStatus.CORRUPTED]: '❌',
      [FileHealthStatus.UNKNOWN]: '❓',
    };

    parts.push(`${emoji[result.status]} Score: ${result.score}/100`);

    // Add issues
    if (result.issues.length > 0) {
      parts.push(`Issues: ${result.issues.join('; ')}`);
    }

    // Add warnings
    if (result.warnings.length > 0) {
      parts.push(`Warnings: ${result.warnings.join('; ')}`);
    }

    return parts.join(' | ');
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
    this.logger.log('Stopping HealthCheckWorker');
    this.isRunning = false;
  }
}
