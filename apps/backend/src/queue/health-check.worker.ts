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
  private readonly CONCURRENCY = parseInt(process.env.HEALTH_CHECK_CONCURRENCY || '10', 10);
  private readonly INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '2000', 10);
  private readonly MIN_HEALTH_SCORE = parseInt(process.env.MIN_HEALTH_SCORE || '40', 10);
  private readonly MAX_RETRY_ATTEMPTS = parseInt(process.env.MAX_RETRY_ATTEMPTS || '3', 10);

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

  /**
   * Auto-requeue CORRUPTED jobs for re-validation
   *
   * UX Philosophy: Self-healing system - users shouldn't need to manually reset jobs
   *
   * Runs hourly to find jobs marked CORRUPTED (often false positives from NFS hiccups)
   * and resets them to DETECTED so they get re-checked automatically.
   *
   * This prevents permanent job blockage from transient file system issues.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async autoRequeueCorruptedJobs(): Promise<void> {
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
   */
  private async processHealthChecks(): Promise<void> {
    // Calculate how many slots are available
    const availableSlots = this.CONCURRENCY - this.currentlyChecking.size;

    if (availableSlots <= 0) {
      // All slots busy, wait for next iteration
      return;
    }

    // HIGH PRIORITY FIX: Exclude jobs that started health check in last 5 minutes
    // This prevents false-positive orphan detection when health checks are just starting
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Find jobs that need health checking
    // Include both DETECTED and HEALTH_CHECK stages:
    // - DETECTED: New jobs waiting for health check
    // - HEALTH_CHECK: Orphaned jobs stuck in this stage (safety net for recovery)
    //   BUT: Exclude recently started checks (healthCheckStartedAt > 5min ago)
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
            // HIGH PRIORITY FIX: Exclude recently started health checks
            OR: [
              {
                stage: JobStage.DETECTED, // Always include DETECTED jobs
              },
              {
                // For HEALTH_CHECK stage, only include if:
                stage: JobStage.HEALTH_CHECK,
                OR: [
                  { healthCheckStartedAt: null }, // No start time (orphaned before fix)
                  { healthCheckStartedAt: { lt: fiveMinutesAgo } }, // Started over 5min ago (truly stuck)
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

      // Update stage to HEALTH_CHECK (visible in UI)
      // HIGH PRIORITY FIX: Set healthCheckStartedAt timestamp to prevent false orphan detection
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          stage: JobStage.HEALTH_CHECK,
          healthCheckStartedAt: new Date(), // HIGH PRIORITY FIX: Track when check started
        },
      });

      this.logger.debug(`Health checking: ${job.fileLabel}`);

      // Perform health analysis
      const healthResult = await this.fileHealthService.analyzeFile(job.filePath);

      // Check for container compatibility issues (AC3/DTS with MP4, etc.)
      const compatibilityIssues = await this.containerCompatibilityService.checkCompatibility(
        job.filePath,
        'mp4' // TODO: Get target container from policy
      );

      // Check for codec match (file already in target codec)
      const codecMatchIssue = this.checkCodecMatch(job.sourceCodec, job.targetCodec);
      if (codecMatchIssue) {
        compatibilityIssues.push(codecMatchIssue);
      }

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
