import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { FfmpegService } from '../encoding/ffmpeg.service';
import { PrismaService } from '../prisma/prisma.service';
import { FileFailureTrackingService } from './services/file-failure-tracking.service';

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
  // AUDIT #2 ISSUE #25 FIX: Store loop promise for graceful shutdown
  private loopPromise?: Promise<void>;

  // Configuration
  private readonly INTERVAL_MS = parseInt(
    process.env.RECOVERY_INTERVAL_MS || `${2 * 60 * 1000}`,
    10
  ); // 2 minutes (reduced from 5)
  private readonly HEALTH_CHECK_TIMEOUT_MIN = parseInt(
    process.env.HEALTH_CHECK_TIMEOUT_MIN || '5',
    10
  );
  // CAPA FIX: Reduced from 60min to 10min for faster stuck job detection
  private readonly ENCODING_TIMEOUT_MIN = parseInt(process.env.ENCODING_TIMEOUT_MIN || '10', 10);
  private readonly VERIFYING_TIMEOUT_MIN = parseInt(process.env.VERIFYING_TIMEOUT_MIN || '30', 10);
  // DEEP AUDIT P0: TRANSFERRING stage timeout (15 min with no progress = stalled)
  private readonly TRANSFERRING_TIMEOUT_MIN = parseInt(
    process.env.TRANSFERRING_TIMEOUT_MIN || '15',
    10
  );

  // Max times a stuck ENCODING job can be recovered before permanent FAIL
  private readonly MAX_STUCK_RECOVERY = 5;
  // Max times a stuck TRANSFERRING job can be retried before permanent FAIL
  private readonly MAX_TRANSFER_RETRIES = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ffmpegService: FfmpegService,
    private readonly fileFailureTracking: FileFailureTrackingService
  ) {}

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
    // AUDIT #2 ISSUE #25 FIX: Store loop promise for graceful shutdown
    this.loopPromise = this.runWorkerLoop();
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
    // CAPA FIX: Use lastProgressUpdate instead of updatedAt for more accurate stuck detection
    const encodingCutoff = new Date(now.getTime() - this.ENCODING_TIMEOUT_MIN * 60 * 1000);
    const stuckEncoding = await this.prisma.job.findMany({
      where: {
        stage: JobStage.ENCODING,
        OR: [
          // No progress update for X minutes
          {
            lastProgressUpdate: {
              lt: encodingCutoff,
            },
          },
          // Or lastProgressUpdate is null (should never happen but safety net)
          {
            lastProgressUpdate: null,
            updatedAt: {
              lt: encodingCutoff,
            },
          },
        ],
      },
      select: {
        id: true,
        fileLabel: true,
        filePath: true,
        libraryId: true,
        updatedAt: true,
        lastProgressUpdate: true,
        progress: true,
        stuckRecoveryCount: true,
        contentFingerprint: true,
      },
    });

    if (stuckEncoding.length > 0) {
      this.logger.warn(
        `Found ${stuckEncoding.length} job(s) stuck in ENCODING for >${this.ENCODING_TIMEOUT_MIN}min`
      );

      for (const job of stuckEncoding) {
        // Check if this job has exceeded recovery cap
        if (job.stuckRecoveryCount >= this.MAX_STUCK_RECOVERY) {
          this.logger.warn(
            `✗ Stuck recovery cap reached: ${job.fileLabel} (${job.stuckRecoveryCount}/${this.MAX_STUCK_RECOVERY}) → FAILED permanently`
          );

          // Kill process if active before failing
          if (this.ffmpegService.hasActiveProcess(job.id)) {
            await this.ffmpegService.killProcess(job.id);
          }

          const errorMsg = `Encoding repeatedly gets stuck - recovered ${job.stuckRecoveryCount} times without completing. File may be problematic. Manual intervention required.`;
          await this.prisma.job.update({
            where: { id: job.id },
            data: {
              stage: JobStage.FAILED,
              failedAt: new Date(),
              error: errorMsg,
            },
          });

          // Record in cross-job failure tracking for auto-blacklist
          try {
            await this.fileFailureTracking.recordFailure(
              job.filePath,
              job.libraryId,
              errorMsg,
              job.contentFingerprint ?? undefined
            );
          } catch (trackingErr) {
            this.logger.error(
              `Failed to record failure tracking for ${job.fileLabel}`,
              trackingErr instanceof Error ? trackingErr.stack : String(trackingErr)
            );
          }

          continue;
        }

        // SMART DETECTION: Check if FFmpeg is actively processing this job
        const hasActiveProcess = this.ffmpegService.hasActiveProcess(job.id);

        if (hasActiveProcess) {
          // Check if process is TRULY stuck (no FFmpeg output at all)
          // vs just slow (FFmpeg producing output, but slowly)
          const isTrulyStuck = this.ffmpegService.isProcessTrulyStuck(
            job.id,
            this.ENCODING_TIMEOUT_MIN
          );

          if (!isTrulyStuck) {
            // FFmpeg is still producing output (just slowly) - let it continue
            const lastOutputTime = this.ffmpegService.getLastOutputTime(job.id);
            const minutesSinceOutput = lastOutputTime
              ? Math.round((now.getTime() - lastOutputTime.getTime()) / 1000 / 60)
              : 'unknown';
            this.logger.debug(
              `Job ${job.fileLabel} is slow but ACTIVE (last FFmpeg output ${minutesSinceOutput}min ago, progress: ${job.progress}%). Letting it continue...`
            );
            continue; // Skip this job - it's not stuck, just slow
          }

          // Process is TRULY frozen (no FFmpeg output for >10min)
          this.logger.warn(
            `Job ${job.fileLabel} has FROZEN FFmpeg process (no output for >${this.ENCODING_TIMEOUT_MIN}min, progress: ${job.progress}%). Killing process...`
          );

          const killed = await this.ffmpegService.killProcess(job.id);
          if (killed) {
            this.logger.log(`✅ Successfully killed frozen FFmpeg process for job ${job.id}`);
          } else {
            this.logger.error(
              `❌ Failed to kill FFmpeg process for job ${job.id}. Job will NOT be reset.`
            );
            continue; // Skip this job if we couldn't kill the process
          }
        }

        // CAPA CRITICAL FIX: Preserve temp file and resume state when recovering frozen jobs
        // DO NOT reset progress or startedAt - this allows job to resume from where it froze
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            stage: JobStage.QUEUED,
            stuckRecoveryCount: { increment: 1 },
            // Keep progress, tempFilePath, resumeTimestamp intact for resume capability
            error: `Encoding timed out (no progress for ${this.ENCODING_TIMEOUT_MIN}min, recovery ${job.stuckRecoveryCount + 1}/${this.MAX_STUCK_RECOVERY}). Job will resume from ${job.progress}%.`,
          },
        });

        // CAPA FIX: Show lastProgressUpdate time for better visibility
        const lastUpdate = job.lastProgressUpdate || job.updatedAt;
        const stuckMinutes = Math.round((now.getTime() - lastUpdate.getTime()) / 1000 / 60);
        this.logger.log(
          `🔄 Recovered stuck ENCODING job: ${job.fileLabel} (progress: ${job.progress}%, no progress for ${stuckMinutes}min, recovery ${job.stuckRecoveryCount + 1}/${this.MAX_STUCK_RECOVERY}) → QUEUED`
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

    // DEEP AUDIT P0: Scenario 4 - Jobs stuck in TRANSFERRING (no progress for >15 min)
    // This catches file transfers that stall mid-progress (e.g., network issues, rsync hangs)
    const transferringCutoff = new Date(now.getTime() - this.TRANSFERRING_TIMEOUT_MIN * 60 * 1000);
    const stuckTransferring = await this.prisma.job.findMany({
      where: {
        stage: JobStage.TRANSFERRING,
        OR: [
          // No progress update for X minutes
          {
            transferLastProgressAt: {
              lt: transferringCutoff,
            },
          },
          // Or transferLastProgressAt is null but transferStartedAt is old
          {
            transferLastProgressAt: null,
            transferStartedAt: {
              lt: transferringCutoff,
            },
          },
        ],
      },
      select: {
        id: true,
        fileLabel: true,
        transferStartedAt: true,
        transferLastProgressAt: true,
        transferProgress: true,
        transferRetryCount: true,
      },
    });

    if (stuckTransferring.length > 0) {
      this.logger.warn(
        `Found ${stuckTransferring.length} job(s) stuck in TRANSFERRING for >${this.TRANSFERRING_TIMEOUT_MIN}min`
      );

      for (const job of stuckTransferring) {
        const lastProgress = job.transferLastProgressAt || job.transferStartedAt || now;
        const stuckMinutes = Math.round((now.getTime() - lastProgress.getTime()) / 1000 / 60);
        const retryCount = job.transferRetryCount + 1;

        if (retryCount >= this.MAX_TRANSFER_RETRIES) {
          // Max retries reached, mark as failed
          await this.prisma.job.update({
            where: { id: job.id },
            data: {
              stage: JobStage.FAILED,
              failedAt: new Date(),
              error: `File transfer stalled after ${this.MAX_TRANSFER_RETRIES} attempts (last progress: ${job.transferProgress}% at ${stuckMinutes}min ago)`,
              transferError: `Transfer stalled - no progress for ${stuckMinutes} minutes`,
            },
          });
          this.logger.error(
            `✗ Transfer failed (max retries): ${job.fileLabel} (progress: ${job.transferProgress}%) → FAILED`
          );
        } else {
          // Reset to DETECTED for retry
          await this.prisma.job.update({
            where: { id: job.id },
            data: {
              stage: JobStage.DETECTED,
              transferRetryCount: retryCount,
              transferProgress: 0,
              transferStartedAt: null,
              transferLastProgressAt: null,
              transferError: `Transfer stalled at ${job.transferProgress}% (no progress for ${stuckMinutes}min). Retrying...`,
            },
          });
          this.logger.log(
            `🔄 Recovered stuck TRANSFERRING job: ${job.fileLabel} (progress: ${job.transferProgress}%, no progress for ${stuckMinutes}min, retry ${retryCount}/${this.MAX_TRANSFER_RETRIES}) → DETECTED`
          );
        }
      }
    }

    // Log summary
    const totalRecovered =
      stuckHealthCheck.length +
      stuckEncoding.length +
      stuckVerifying.length +
      stuckTransferring.length;
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
   * AUDIT #2 ISSUE #25 FIX: Made async to await loop completion
   */
  async stop(): Promise<void> {
    this.logger.log('Stopping StuckJobRecoveryWorker');
    this.isRunning = false;

    // AUDIT #2 ISSUE #25 FIX: Wait for loop to actually exit
    if (this.loopPromise) {
      await this.loopPromise;
      this.logger.log('StuckJobRecoveryWorker loop exited gracefully');
    }
  }
}
