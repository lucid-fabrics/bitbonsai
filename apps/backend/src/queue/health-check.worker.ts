import * as path from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FileHealthStatus, JobStage } from '@prisma/client';
import { FileRelocatorService } from '../core/services/file-relocator.service';
import { ContainerCompatibilityService } from '../encoding/container-compatibility.service';
import { FfmpegService } from '../encoding/ffmpeg.service';
import { FileHealthService } from '../encoding/file-health.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  HealthCheckIssue,
  HealthCheckIssueCategory,
  HealthCheckIssueSeverity,
  HealthCheckSuggestedAction,
} from './models/health-check-issue.model';

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
  // AUDIT #2 ISSUE #25 FIX: Store loop promise for graceful shutdown
  private loopPromise?: Promise<void>;

  // Configuration (can be moved to Settings later)
  // DEEP AUDIT P1-3: Reduced default concurrency from 10 to 5 to prevent DB pool exhaustion
  private readonly CONCURRENCY = parseInt(process.env.HEALTH_CHECK_CONCURRENCY || '5', 10);
  private readonly INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '2000', 10);
  private readonly MIN_HEALTH_SCORE = parseInt(process.env.MIN_HEALTH_SCORE || '40', 10);
  private readonly MAX_RETRY_ATTEMPTS = parseInt(process.env.MAX_RETRY_ATTEMPTS || '3', 10);
  // DEEP AUDIT P1-3: Maximum pool utilization before applying backpressure (0-1)
  private readonly MAX_POOL_UTILIZATION = 0.8;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileHealthService: FileHealthService,
    private readonly containerCompatibilityService: ContainerCompatibilityService,
    private readonly ffmpegService: FfmpegService,
    private readonly fileRelocatorService: FileRelocatorService
  ) {}

  /**
   * Start the health check worker when the module initializes
   */
  async onModuleInit(): Promise<void> {
    this.logger.log(`Starting HealthCheckWorker with concurrency=${this.CONCURRENCY}`);
    this.start();
  }

  // HIGH #5 FIX: Track cron execution to prevent overlap
  private cronRunning = false;
  private cronLockExpiry = 0;

  /**
   * Auto-requeue CORRUPTED jobs for re-validation
   *
   * UX Philosophy: Self-healing system - users shouldn't need to manually reset jobs
   *
   * Runs hourly to find jobs marked CORRUPTED (often false positives from NFS hiccups)
   * and resets them to DETECTED so they get re-checked automatically.
   *
   * This prevents permanent job blockage from transient file system issues.
   *
   * MEDIUM #2 FIX: Stale lock detection prevents permanent lock if process crashes
   * HIGH #5 FIX: Lock prevents overlapping executions if previous run takes > 1 hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async autoRequeueCorruptedJobs(): Promise<void> {
    const now = Date.now();

    // MEDIUM #2 FIX: Check if lock is stale (>2h old)
    if (this.cronRunning && now - this.cronLockExpiry < 2 * 60 * 60 * 1000) {
      this.logger.warn('Auto-requeue: Previous execution still running, skipping this cycle');
      return;
    }

    if (this.cronRunning) {
      this.logger.warn(
        `Auto-requeue: Stale lock detected (${Math.round((now - this.cronLockExpiry) / 1000 / 60)}m old), forcing reset`
      );
    }

    this.cronRunning = true;
    this.cronLockExpiry = now;

    try {
      await this._autoRequeueCorruptedJobsImpl();
    } finally {
      this.cronRunning = false;
    }
  }

  private async _autoRequeueCorruptedJobsImpl(): Promise<void> {
    try {
      // Find CORRUPTED jobs that are stuck (not actively being processed)
      const corruptedJobs = await this.prisma.job.findMany({
        where: {
          healthStatus: FileHealthStatus.CORRUPTED,
          stage: {
            in: [JobStage.QUEUED, JobStage.FAILED, JobStage.DETECTED],
          },
        },
        select: {
          id: true,
          fileLabel: true,
          healthMessage: true,
          healthCheckedAt: true,
        },
      });

      if (corruptedJobs.length === 0) {
        this.logger.debug('Auto-requeue: No CORRUPTED jobs found');
        return;
      }

      this.logger.log(
        `🔄 Auto-requeue: Found ${corruptedJobs.length} CORRUPTED job(s) - resetting for re-validation`
      );

      // Reset jobs to DETECTED with UNKNOWN health status for re-check
      // Note: healthScore, healthMessage, healthCheckedAt will be updated by health check worker
      const result = await this.prisma.job.updateMany({
        where: {
          id: { in: corruptedJobs.map((j) => j.id) },
        },
        data: {
          stage: JobStage.DETECTED,
          healthStatus: FileHealthStatus.UNKNOWN,
          error:
            'Auto-requeued for re-validation (previous health check may have been a false positive)',
        },
      });

      this.logger.log(
        `✅ Auto-requeue: Reset ${result.count} job(s) to DETECTED for re-validation`
      );

      // Log sample of affected files for debugging
      const sampleFiles = corruptedJobs.slice(0, 5).map((j) => j.fileLabel);
      if (sampleFiles.length > 0) {
        this.logger.debug(
          `Auto-requeue sample: ${sampleFiles.join(', ')}${corruptedJobs.length > 5 ? '...' : ''}`
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Auto-requeue failed: ${errorMessage}`);
    }
  }

  /**
   * MEDIUM #2 FIX: Calculate dynamic timeout based on file size
   * Formula: min(60, 10 + (sizeGB / 2)) minutes
   * MEDIUM #2 FIX: Handle zero-byte files explicitly
   *
   * @param fileSizeBytes - File size in bytes
   * @returns Timeout threshold date
   * @private
   */
  private calculateHealthCheckTimeout(fileSizeBytes: bigint): Date {
    // MEDIUM #2 FIX: Zero-byte files are corrupted, use minimum timeout
    if (fileSizeBytes <= 0n) {
      return new Date(Date.now() - 1 * 60 * 1000); // 1 minute for corrupted files
    }

    // MEDIUM #1 FIX: Use BigInt arithmetic throughout to prevent precision loss
    // Safe for files up to 2^53 bytes (~9 petabytes)
    const sizeGB = fileSizeBytes / BigInt(1024 ** 3);

    // Calculate timeout: 10 min base + 0.5 min per GB, capped at 60 min
    let timeoutMinutes: number;
    if (sizeGB > 100n) {
      timeoutMinutes = 60; // Cap at 60 min for files > 100GB
    } else {
      timeoutMinutes = Math.min(60, Number(10n + sizeGB / 2n));
    }

    return new Date(Date.now() - timeoutMinutes * 60 * 1000);
  }

  /**
   * Start the worker loop
   */
  private start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    // AUDIT #2 ISSUE #25 FIX: Store loop promise for graceful shutdown
    this.loopPromise = this.runWorkerLoop();
  }

  /**
   * Main worker loop - runs continuously
   */
  private async runWorkerLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // CRITICAL FIX: Timeout watchdog for stuck health checks (10 min max)
        await this.timeoutStuckHealthChecks();
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
   * CRITICAL FIX: Fail health checks that have been running for more than 10 minutes
   * This prevents jobs from being stuck indefinitely in HEALTH_CHECK stage
   */
  private async timeoutStuckHealthChecks(): Promise<void> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const stuckJobs = await this.prisma.job.findMany({
      where: {
        stage: JobStage.HEALTH_CHECK,
        healthCheckStartedAt: {
          lt: tenMinutesAgo,
        },
      },
      select: {
        id: true,
        fileLabel: true,
        healthCheckStartedAt: true,
        retryCount: true,
      },
    });

    for (const job of stuckJobs) {
      const stuckMinutes = job.healthCheckStartedAt
        ? Math.round((Date.now() - job.healthCheckStartedAt.getTime()) / 60000)
        : 10;

      // If retries exhausted, fail the job
      if (job.retryCount >= this.MAX_RETRY_ATTEMPTS) {
        this.logger.warn(
          `⏱️ Health check timeout: ${job.fileLabel} stuck for ${stuckMinutes}min, max retries (${this.MAX_RETRY_ATTEMPTS}) exhausted - marking FAILED`
        );
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            stage: JobStage.FAILED,
            failedAt: new Date(),
            error: `Health check timed out after ${stuckMinutes} minutes (${this.MAX_RETRY_ATTEMPTS} retries exhausted)`,
            healthStatus: FileHealthStatus.CORRUPTED,
          },
        });
      } else {
        // Retry by resetting to DETECTED with exponential backoff
        const backoffMs = Math.min(30000 * 2 ** job.retryCount, 300000); // 30s, 60s, 120s, max 5min
        const nextRetryAt = new Date(Date.now() + backoffMs);

        this.logger.warn(
          `⏱️ Health check timeout: ${job.fileLabel} stuck for ${stuckMinutes}min - resetting to DETECTED (retry ${job.retryCount + 1}/${this.MAX_RETRY_ATTEMPTS}, next retry in ${backoffMs / 1000}s)`
        );
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            stage: JobStage.DETECTED,
            retryCount: job.retryCount + 1,
            healthCheckStartedAt: null,
            error: `Health check timed out after ${stuckMinutes} minutes, retrying...`,
            nextRetryAt,
          },
        });
      }

      // Remove from currentlyChecking if present
      this.currentlyChecking.delete(job.id);
    }
  }

  /**
   * Process a batch of health checks with parallel execution
   *
   * HIGH PRIORITY FIX: Exclude recently started health checks from orphan detection
   * DEEP AUDIT P1-3: Added DB pool backpressure monitoring
   */
  private async processHealthChecks(): Promise<void> {
    // Calculate how many slots are available
    const availableSlots = this.CONCURRENCY - this.currentlyChecking.size;

    if (availableSlots <= 0) {
      // All slots busy, wait for next iteration
      return;
    }

    // DEEP AUDIT P1-3: Simple backpressure based on concurrent check count
    // This prevents overwhelming the system under heavy load
    // Note: Using currentlyChecking.size as a proxy for DB pool pressure
    // since Prisma $metrics may not be available in all configurations
    if (this.currentlyChecking.size >= this.CONCURRENCY * this.MAX_POOL_UTILIZATION) {
      // Already at 80% of max concurrency, apply backpressure
      this.logger.debug(
        `Backpressure: ${this.currentlyChecking.size}/${this.CONCURRENCY} checks in progress (>${Math.round(this.MAX_POOL_UTILIZATION * 100)}%)`
      );
      return;
    }

    // MEDIUM #1 FIX: Exponential timeout based on file size
    // Formula: min(60, 10 + (sizeGB / 2)) minutes
    // Examples: 5GB=12.5min, 10GB=15min, 50GB=35min, 100GB=60min (capped)
    // Old: 10min for <10GB, 20min for >=10GB (too rigid)
    const _tenGB = BigInt(10 * 1024 * 1024 * 1024);

    // We'll use the old timeouts as fallback for the WHERE clause
    // Actual timeout validation happens per-job in the check loop
    const _tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const _twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);

    // Find jobs that need health checking
    // Include both DETECTED and HEALTH_CHECK stages:
    // - DETECTED: New jobs waiting for health check
    // - HEALTH_CHECK: Orphaned jobs stuck in this stage (safety net for recovery)
    //   BUT: Exclude recently started checks (dynamic timeout based on file size)
    const jobs = await this.prisma.job.findMany({
      where: {
        AND: [
          {
            stage: {
              in: [JobStage.DETECTED, JobStage.HEALTH_CHECK],
            },
          },
          {
            id: {
              notIn: Array.from(this.currentlyChecking),
            },
          },
          {
            // MEDIUM #1 FIX: Use conservative 60min timeout in WHERE clause
            // Dynamic per-file timeout filtering happens in-memory after fetch
            OR: [
              {
                stage: JobStage.DETECTED, // Always include DETECTED jobs
              },
              {
                // For HEALTH_CHECK stage, fetch all started >60min ago (conservative)
                stage: JobStage.HEALTH_CHECK,
                OR: [
                  { healthCheckStartedAt: null }, // No start time (orphaned before fix)
                  { healthCheckStartedAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } }, // 60min
                ],
              },
            ],
          },
        ],
      },
      take: availableSlots,
      orderBy: {
        createdAt: 'asc', // FIFO order
      },
    });

    if (jobs.length === 0) {
      return; // No jobs to process
    }

    // MEDIUM #1 FIX: Filter jobs using dynamic timeout based on file size
    const filteredJobs = jobs.filter((job) => {
      if (job.stage === JobStage.DETECTED) {
        return true; // Always process DETECTED jobs
      }

      if (job.stage === JobStage.HEALTH_CHECK && !job.healthCheckStartedAt) {
        return true; // Orphaned jobs with no start time
      }

      if (job.healthCheckStartedAt) {
        const timeout = this.calculateHealthCheckTimeout(job.beforeSizeBytes);
        return job.healthCheckStartedAt < timeout; // Exceeded dynamic timeout
      }

      return false;
    });

    if (filteredJobs.length === 0) {
      return; // No jobs exceed their dynamic timeout
    }

    this.logger.debug(
      `Processing ${filteredJobs.length} health checks (filtered from ${jobs.length}, ${this.currentlyChecking.size}/${this.CONCURRENCY} slots busy)`
    );

    // Process jobs in parallel (fire and forget)
    const promises = filteredJobs.map((job) => this.checkJobHealth(job.id));
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
      // Get job details including policy for allowSameCodec and minSavingsPercent check
      const job = await this.prisma.job.findUnique({
        where: { id: jobId },
        include: {
          policy: {
            select: {
              allowSameCodec: true,
              minSavingsPercent: true,
            },
          },
        },
      });

      if (!job) {
        this.logger.warn(`Job ${jobId} not found, skipping health check`);
        return;
      }

      // AUDIT #3 FIX: Validate file exists before attempting health analysis
      // This provides better error context when source files are deleted
      // FIX: Add retry logic for NFS mount recovery (prevents false CORRUPTED status)
      const fs = await import('fs/promises');
      const FILE_ACCESS_MAX_RETRIES = 5;
      const FILE_ACCESS_RETRY_DELAY_MS = 2000;
      let fileAccessible = false;

      for (let attempt = 1; attempt <= FILE_ACCESS_MAX_RETRIES; attempt++) {
        try {
          await fs.access(job.filePath);
          fileAccessible = true;
          break;
        } catch {
          if (attempt < FILE_ACCESS_MAX_RETRIES) {
            this.logger.debug(
              `File access attempt ${attempt}/${FILE_ACCESS_MAX_RETRIES} failed for ${job.fileLabel}, retrying in ${FILE_ACCESS_RETRY_DELAY_MS}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, FILE_ACCESS_RETRY_DELAY_MS));
          }
        }
      }

      if (!fileAccessible) {
        // SELF-HEALING: Try to relocate file if it was moved/renamed by media server
        this.logger.warn(`File not accessible for ${job.fileLabel}, attempting auto-relocation...`);
        const relocationResult = await this.fileRelocatorService.relocateFile(
          job.filePath,
          job.beforeSizeBytes
        );

        if (relocationResult.found && relocationResult.newPath) {
          // File was relocated - update job and continue with health check
          this.logger.log(
            `✅ AUTO-RELOCATED: ${job.fileLabel} found at new location (${relocationResult.matchType}, ${relocationResult.confidence}% confidence)`
          );

          // Update job path in database
          await this.prisma.job.update({
            where: { id: jobId },
            data: {
              filePath: relocationResult.newPath,
              fileLabel: path.basename(relocationResult.newPath),
            },
          });

          // Update local job object for the rest of this health check
          job.filePath = relocationResult.newPath;
          job.fileLabel = path.basename(relocationResult.newPath);
        } else {
          // Could not relocate - mark as FAILED
          await this.prisma.job.update({
            where: { id: jobId },
            data: {
              stage: JobStage.FAILED,
              healthStatus: FileHealthStatus.CORRUPTED,
              healthScore: 0,
              healthMessage: '❌ Source file was deleted before health check could run',
              healthCheckedAt: new Date(),
              error: `File not found at expected path: ${job.filePath}\n\nThe file may have been moved or deleted after the job was created. (Checked ${FILE_ACCESS_MAX_RETRIES} times over ${(FILE_ACCESS_MAX_RETRIES * FILE_ACCESS_RETRY_DELAY_MS) / 1000}s)\n\n(Auto-relocation searched ${relocationResult.searchedPaths} files but could not find a match)`,
            },
          });
          this.logger.error(
            `✗ ${job.fileLabel} - FILE MISSING after ${FILE_ACCESS_MAX_RETRIES} retries and auto-relocation → FAILED`
          );
          return;
        }
      }

      // CRITICAL #2 FIX: Atomically claim job with database-level locking
      // Use raw SQL to ensure true atomicity - prevents double-claim race
      const claimResult = await this.prisma.$executeRaw`
        UPDATE jobs
        SET stage = 'HEALTH_CHECK',
            "healthCheckStartedAt" = NOW()
        WHERE id = ${jobId}
          AND stage IN ('DETECTED', 'HEALTH_CHECK')
          AND (
            "healthCheckStartedAt" IS NULL
            OR "healthCheckStartedAt" < NOW() - INTERVAL '10 minutes'
          )
      `;

      // Check if we successfully claimed the job (returns affected row count)
      if (claimResult === 0) {
        // Another worker already claimed this job for health check
        this.logger.debug(`Job ${jobId} already claimed by another health check worker, skipping`);
        return;
      }

      this.logger.debug(`Health checking: ${job.fileLabel}`);

      // Perform health analysis
      const healthResult = await this.fileHealthService.analyzeFile(job.filePath);

      // Check for container compatibility issues (AC3/DTS with MP4, etc.)
      const compatibilityIssues = await this.containerCompatibilityService.checkCompatibility(
        job.filePath,
        job.targetContainer || 'mp4' // Use job's target container, fallback to mp4
      );

      // Check for codec match (file already in target codec)
      // Skip this check if policy has allowSameCodec enabled AND expected savings meets threshold
      const allowSameCodec = job.policy?.allowSameCodec ?? false;
      const minSavingsPercent = job.policy?.minSavingsPercent ?? 0;

      if (!allowSameCodec) {
        // allowSameCodec is disabled - always check for codec match
        const codecMatchIssue = this.checkCodecMatch(job.sourceCodec, job.targetCodec);
        if (codecMatchIssue) {
          compatibilityIssues.push(codecMatchIssue);
        }
      } else if (minSavingsPercent > 0) {
        // allowSameCodec is enabled but has a savings threshold
        // Calculate expected savings and compare against threshold
        const expectedSavings = this.calculateExpectedSavingsPercent(
          job.sourceCodec,
          job.targetCodec,
          job.beforeSizeBytes
        );

        if (expectedSavings < minSavingsPercent) {
          // Expected savings is below threshold - show NEEDS_DECISION
          const codecMatchIssue = this.checkCodecMatchWithThreshold(
            job.sourceCodec,
            job.targetCodec,
            expectedSavings,
            minSavingsPercent
          );
          if (codecMatchIssue) {
            compatibilityIssues.push(codecMatchIssue);
          }
        }
        // If expectedSavings >= minSavingsPercent, skip the codec match check (allow encoding)
      }
      // If allowSameCodec is true and minSavingsPercent is 0, skip the codec match check entirely

      // Determine next stage based on health result and compatibility
      let nextStage: JobStage;
      let errorMessage: string | null = null;

      // Check if there are BLOCKER issues requiring user decision
      const blockerIssues = compatibilityIssues.filter(
        (issue) => issue.severity === HealthCheckIssueSeverity.BLOCKER
      );

      if (blockerIssues.length > 0) {
        // Has blocker issues - requires user decision
        nextStage = JobStage.NEEDS_DECISION;
        this.logger.warn(
          `⚠️ ${job.fileLabel} - NEEDS DECISION (${blockerIssues.length} blocker issue(s)) → NEEDS_DECISION`
        );
      } else if (healthResult.canEncode && healthResult.score >= this.MIN_HEALTH_SCORE) {
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

      // Prepare decision data if there are compatibility issues
      const decisionData: {
        decisionRequired?: boolean;
        decisionIssues?: string;
      } = {};

      if (blockerIssues.length > 0) {
        decisionData.decisionRequired = true;
        decisionData.decisionIssues = JSON.stringify(blockerIssues);
      }

      // Update job with health results
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          stage: nextStage,
          healthStatus: healthResult.status,
          healthScore: Math.min(100, healthResult.score),
          healthMessage,
          healthCheckedAt: new Date(),
          error: errorMessage,
          ...decisionData,
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
   * Check if the source codec already matches the target codec
   *
   * When a file is already encoded in the target codec, encoding it again would be wasteful.
   * This can happen when:
   * - User changed the policy's target codec after jobs were created
   * - File was manually renamed and re-added to queue
   * - Policy was originally set incorrectly
   *
   * @param sourceCodec - The file's current codec
   * @param targetCodec - The job's target codec
   * @returns A BLOCKER issue if codecs match, null otherwise
   */
  private checkCodecMatch(sourceCodec: string, targetCodec: string): HealthCheckIssue | null {
    const normalizedSource = this.ffmpegService.normalizeCodec(sourceCodec);
    const normalizedTarget = this.ffmpegService.normalizeCodec(targetCodec);

    if (normalizedSource === normalizedTarget) {
      const codecDisplayName = this.getCodecDisplayName(normalizedSource);

      const suggestedActions: HealthCheckSuggestedAction[] = [
        {
          id: 'skip_encoding',
          label: 'Skip Encoding',
          description: `Mark this job as completed without encoding - the file is already in ${codecDisplayName} format`,
          impact: 'Job will be marked as COMPLETED with no changes to the file',
          recommended: true,
          config: {
            action: 'skip',
            reason: 'codec_already_matches',
          },
        },
        {
          id: 'force_reencode',
          label: 'Force Re-encode Anyway',
          description: `Re-encode the file from ${codecDisplayName} to ${codecDisplayName} (same codec)`,
          impact:
            'File will be re-encoded, potentially resulting in quality loss with no size benefit',
          recommended: false,
          config: {
            action: 'force_encode',
            reason: 'user_requested',
          },
        },
        {
          id: 'cancel_job',
          label: 'Cancel Job',
          description: 'Remove this job from the queue entirely',
          impact: 'Job will be cancelled and the file left unchanged',
          recommended: false,
          config: {
            action: 'cancel',
            reason: 'codec_already_matches',
          },
        },
      ];

      return {
        category: HealthCheckIssueCategory.CODEC,
        severity: HealthCheckIssueSeverity.BLOCKER,
        code: 'CODEC_ALREADY_MATCHES_TARGET',
        message: `This file is already encoded in ${codecDisplayName} format`,
        technicalDetails: `
Source codec: ${sourceCodec} (normalized: ${normalizedSource})
Target codec: ${targetCodec} (normalized: ${normalizedTarget})

The file's current codec matches the target codec for this job. This typically happens when:
• The encoding policy was changed after the job was created
• The file was already optimized and re-added to the queue
• The policy's target codec was set incorrectly

Re-encoding a file to the same codec offers no benefit and may actually increase file size or reduce quality.
`.trim(),
        suggestedActions,
        metadata: {
          sourceCodec: normalizedSource,
          targetCodec: normalizedTarget,
          codecMatch: true,
        },
      };
    }

    return null;
  }

  /**
   * Get user-friendly display name for a codec
   */
  private getCodecDisplayName(codec: string): string {
    const displayNames: Record<string, string> = {
      hevc: 'HEVC (H.265)',
      h264: 'H.264 (AVC)',
      av1: 'AV1',
      vp9: 'VP9',
    };
    return displayNames[codec.toLowerCase()] || codec.toUpperCase();
  }

  /**
   * Calculate expected savings percentage based on codec compression ratios
   *
   * Uses typical compression ratios between codecs:
   * - H.264 → HEVC: ~30-50% savings
   * - H.264 → AV1: ~40-60% savings
   * - HEVC → AV1: ~20-30% savings
   * - Same codec: ~0-5% savings (minimal)
   */
  private calculateExpectedSavingsPercent(
    sourceCodec: string,
    targetCodec: string,
    _beforeSizeBytes: bigint
  ): number {
    const normalizedSource = this.ffmpegService.normalizeCodec(sourceCodec);
    const normalizedTarget = this.ffmpegService.normalizeCodec(targetCodec);

    // Same codec typically yields minimal savings
    if (normalizedSource === normalizedTarget) {
      return 5; // Conservative estimate for same-codec re-encoding
    }

    // Compression ratio estimates (conservative)
    const compressionRatios: Record<string, Record<string, number>> = {
      h264: {
        hevc: 35, // H.264 → HEVC: ~35% savings
        av1: 50, // H.264 → AV1: ~50% savings
        vp9: 30, // H.264 → VP9: ~30% savings
      },
      hevc: {
        av1: 25, // HEVC → AV1: ~25% savings
        vp9: 10, // HEVC → VP9: ~10% savings
        h264: -30, // HEVC → H.264: negative savings (quality loss)
      },
      av1: {
        hevc: -10, // AV1 → HEVC: negative savings
        vp9: 0, // AV1 → VP9: similar
        h264: -50, // AV1 → H.264: significant increase
      },
      vp9: {
        hevc: 10, // VP9 → HEVC: ~10% savings
        av1: 20, // VP9 → AV1: ~20% savings
        h264: -20, // VP9 → H.264: negative savings
      },
    };

    return compressionRatios[normalizedSource]?.[normalizedTarget] ?? 0;
  }

  /**
   * Check codec match with savings threshold - creates a BLOCKER issue
   * when expected savings is below the policy's minimum threshold
   */
  private checkCodecMatchWithThreshold(
    sourceCodec: string,
    targetCodec: string,
    expectedSavings: number,
    minSavingsThreshold: number
  ): HealthCheckIssue | null {
    const normalizedSource = this.ffmpegService.normalizeCodec(sourceCodec);
    const normalizedTarget = this.ffmpegService.normalizeCodec(targetCodec);
    const codecDisplayName = this.getCodecDisplayName(normalizedTarget);

    const suggestedActions: HealthCheckSuggestedAction[] = [
      {
        id: 'skip_encoding',
        label: 'Skip Encoding',
        description: `Skip this job - expected savings (${expectedSavings}%) is below the ${minSavingsThreshold}% threshold`,
        impact: 'Job will be marked as COMPLETED with no changes to the file',
        recommended: true,
        config: {
          action: 'skip',
          reason: 'savings_below_threshold',
        },
      },
      {
        id: 'force_reencode',
        label: 'Force Re-encode Anyway',
        description: `Re-encode despite low expected savings (${expectedSavings}%)`,
        impact: `File will be re-encoded but savings may be less than ${minSavingsThreshold}%`,
        recommended: false,
        config: {
          action: 'force_encode',
          reason: 'user_requested',
        },
      },
      {
        id: 'cancel_job',
        label: 'Cancel Job',
        description: 'Remove this job from the queue entirely',
        impact: 'Job will be cancelled and the file left unchanged',
        recommended: false,
        config: {
          action: 'cancel',
          reason: 'savings_below_threshold',
        },
      },
    ];

    return {
      category: HealthCheckIssueCategory.CODEC,
      severity: HealthCheckIssueSeverity.BLOCKER,
      code: 'SAVINGS_BELOW_THRESHOLD',
      message: `Expected savings (${expectedSavings}%) is below the policy threshold (${minSavingsThreshold}%)`,
      technicalDetails: `
Source codec: ${sourceCodec} (normalized: ${normalizedSource})
Target codec: ${targetCodec} (normalized: ${normalizedTarget})
Expected savings: ${expectedSavings}%
Policy threshold: ${minSavingsThreshold}%

The expected file size reduction from encoding this file to ${codecDisplayName} is below your policy's minimum savings threshold.

This typically means the encoding would take significant time with minimal space benefit.
`.trim(),
      suggestedActions,
      metadata: {
        sourceCodec: normalizedSource,
        targetCodec: normalizedTarget,
        expectedSavings,
        minSavingsThreshold,
      },
    };
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
   * AUDIT #2 ISSUE #25 FIX: Made async to await loop completion
   */
  async stop(): Promise<void> {
    this.logger.log('Stopping HealthCheckWorker');
    this.isRunning = false;

    // AUDIT #2 ISSUE #25 FIX: Wait for loop to actually exit
    if (this.loopPromise) {
      await this.loopPromise;
      this.logger.log('HealthCheckWorker loop exited gracefully');
    }
  }
}
