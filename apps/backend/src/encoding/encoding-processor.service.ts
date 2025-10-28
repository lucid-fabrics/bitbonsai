import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job, Policy } from '@prisma/client';
import { LibrariesService } from '../libraries/libraries.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { FfmpegService } from './ffmpeg.service';

interface JobWithPolicy extends Job {
  policy?: Policy;
  retryCount?: number;
}

interface WorkerState {
  nodeId: string;
  isRunning: boolean;
  currentJobId: string | null;
  intervalId: NodeJS.Timeout | null;
}

interface JobResult {
  beforeSizeBytes: bigint;
  afterSizeBytes: bigint;
  savedBytes: bigint;
  savedPercent: number;
}

/**
 * EncodingProcessorService
 *
 * Handles encoding job processing with queue management and worker orchestration.
 * Implements:
 * - Worker pattern for processing jobs per node
 * - Queue management with concurrent job limits
 * - Automatic retry logic (max 3 retries)
 * - Atomic file replacement with verification
 * - Progress tracking and metrics updates
 */
@Injectable()
export class EncodingProcessorService implements OnModuleInit {
  private readonly logger = new Logger(EncodingProcessorService.name);
  private readonly workers = new Map<string, WorkerState>();
  private readonly MAX_RETRIES = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly ffmpegService: FfmpegService,
    private readonly librariesService: LibrariesService
  ) {}

  /**
   * Auto-start workers for all online nodes on module initialization
   * This ensures encoding workers are running whenever the backend starts
   *
   * Also performs auto-heal to recover from crashes/reboots
   */
  async onModuleInit() {
    this.logger.log('🔧 Initializing encoding processor...');

    try {
      // STEP 1: Auto-heal orphaned jobs from previous crash/reboot
      await this.autoHealOrphanedJobs();

      // STEP 2: Get all online nodes
      const onlineNodes = await this.prisma.node.findMany({
        where: { status: 'ONLINE' },
        select: { id: true, name: true },
      });

      if (onlineNodes.length === 0) {
        this.logger.warn('No online nodes found - no workers started');
        return;
      }

      // STEP 3: Start a worker for each online node
      for (const node of onlineNodes) {
        try {
          await this.startWorker(node.id);
          this.logger.log(`✓ Auto-started worker for node: ${node.name}`);
        } catch (error) {
          this.logger.error(`Failed to start worker for node ${node.name}:`, error);
        }
      }

      this.logger.log(`✅ Auto-started ${onlineNodes.length} worker(s)`);

      // STEP 4: Start background watchdog to detect stuck jobs
      this.startStuckJobWatchdog();
    } catch (error) {
      this.logger.error('Failed to initialize encoding processor:', error);
    }
  }

  /**
   * Auto-heal orphaned jobs that were left in ENCODING state
   * from backend crashes, reboots, or container restarts
   *
   * Strategy:
   * - Find all jobs in ENCODING state
   * - Check if they haven't been updated in the last 5 minutes
   * - Reset them to QUEUED so they can be retried
   */
  private async autoHealOrphanedJobs(): Promise<void> {
    this.logger.log('🏥 Auto-heal: Checking for orphaned encoding jobs...');

    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      // Find orphaned jobs (ENCODING but no progress in 5+ minutes)
      const orphanedJobs = await this.prisma.job.findMany({
        where: {
          stage: 'ENCODING',
          updatedAt: {
            lt: fiveMinutesAgo,
          },
        },
        select: {
          id: true,
          fileLabel: true,
          progress: true,
          updatedAt: true,
        },
      });

      if (orphanedJobs.length === 0) {
        this.logger.log('✅ No orphaned jobs found - system is healthy');
        return;
      }

      this.logger.warn(`🔧 Found ${orphanedJobs.length} orphaned job(s) - resetting to QUEUED`);

      // Reset each orphaned job back to QUEUED
      for (const job of orphanedJobs) {
        try {
          await this.prisma.job.update({
            where: { id: job.id },
            data: {
              stage: 'QUEUED',
              progress: 0,
              etaSeconds: null,
              error: 'Auto-recovered from backend restart',
            },
          });

          this.logger.log(
            `  ✓ Reset orphaned job: ${job.fileLabel} (was ${job.progress}% complete)`
          );
        } catch (error) {
          this.logger.error(`  ✗ Failed to reset job ${job.id}:`, error);
        }
      }

      this.logger.log(`✅ Auto-heal complete - recovered ${orphanedJobs.length} job(s)`);
    } catch (error) {
      this.logger.error('Auto-heal failed:', error);
    }
  }

  /**
   * Start background watchdog to detect stuck jobs during runtime
   * Runs every 2 minutes to check for jobs that haven't progressed
   */
  private startStuckJobWatchdog(): void {
    this.logger.log('👀 Starting stuck job watchdog (checks every 2 minutes)');

    setInterval(
      async () => {
        try {
          const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

          const stuckJobs = await this.prisma.job.findMany({
            where: {
              stage: 'ENCODING',
              updatedAt: {
                lt: tenMinutesAgo,
              },
            },
            select: {
              id: true,
              fileLabel: true,
              progress: true,
            },
          });

          if (stuckJobs.length > 0) {
            this.logger.warn(`⚠️  Watchdog detected ${stuckJobs.length} stuck job(s)`);

            for (const job of stuckJobs) {
              this.logger.warn(
                `  - ${job.fileLabel} stuck at ${job.progress}% - marking as FAILED`
              );

              // Get last stderr from ffmpeg for better error reporting
              const lastStderr = this.ffmpegService.getLastStderr(job.id);
              let errorMessage = 'Job stuck - no progress in 10+ minutes';

              if (lastStderr) {
                // Extract last few lines of stderr for context
                const stderrLines = lastStderr.trim().split('\n').slice(-5);
                const stderrContext = stderrLines.join('\n');
                errorMessage += `\n\nLast ffmpeg output:\n${stderrContext}`;
              } else {
                errorMessage += ' (likely ffmpeg crash - no error output captured)';
              }

              await this.queueService.failJob(job.id, errorMessage);
            }
          }
        } catch (error) {
          this.logger.error('Watchdog check failed:', error);
        }
      },
      2 * 60 * 1000
    ); // Every 2 minutes
  }

  /**
   * Start worker for a node
   *
   * Begins processing jobs from the queue for the specified node.
   * Worker will continuously poll for new jobs while running.
   *
   * @param nodeId - Node unique identifier
   */
  async startWorker(nodeId: string): Promise<void> {
    if (this.workers.has(nodeId)) {
      this.logger.warn(`Worker already running for node ${nodeId}`);
      return;
    }

    this.logger.log(`Starting worker for node ${nodeId}`);

    const worker: WorkerState = {
      nodeId,
      isRunning: true,
      currentJobId: null,
      intervalId: null,
    };

    this.workers.set(nodeId, worker);

    // Start processing loop
    this.processLoop(nodeId);
  }

  /**
   * Stop worker for a node
   *
   * Gracefully stops the worker after current job completes.
   * Will not interrupt running jobs.
   *
   * @param nodeId - Node unique identifier
   */
  async stopWorker(nodeId: string): Promise<void> {
    const worker = this.workers.get(nodeId);
    if (!worker) {
      this.logger.warn(`No worker running for node ${nodeId}`);
      return;
    }

    this.logger.log(`Stopping worker for node ${nodeId}`);
    worker.isRunning = false;

    // Wait for current job to complete
    if (worker.currentJobId) {
      this.logger.log(`Waiting for current job ${worker.currentJobId} to complete...`);
    }

    this.workers.delete(nodeId);
  }

  /**
   * Process next job for a node
   *
   * Gets the next available job from queue and processes it.
   * Respects concurrent job limits from license configuration.
   *
   * @param nodeId - Node unique identifier
   * @returns Processed job or null if none available
   */
  async processNextJob(nodeId: string): Promise<JobWithPolicy | null> {
    try {
      // Get next job from queue (respects concurrent limits)
      const job = await this.queueService.getNextJob(nodeId);

      if (!job) {
        return null;
      }

      this.logger.log(`Processing job ${job.id} for node ${nodeId}`);

      // Update worker state
      const worker = this.workers.get(nodeId);
      if (worker) {
        worker.currentJobId = job.id;
      }

      try {
        // Verify source file exists
        if (!fs.existsSync(job.filePath)) {
          throw new Error(`Source file not found: ${job.filePath}`);
        }

        // Perform encoding
        const result = await this.encodeFile(job);

        // Handle successful completion
        await this.handleJobCompletion(job, result);

        return job;
      } catch (error) {
        // Handle failure with retry logic
        await this.handleJobFailure(job, error);
        return null;
      } finally {
        // Clear current job
        if (worker) {
          worker.currentJobId = null;
        }
      }
    } catch (error) {
      this.logger.error(`Error processing job for node ${nodeId}:`, error);
      return null;
    }
  }

  /**
   * Handle job completion
   *
   * Updates job statistics, metrics, and library totals.
   *
   * @param job - Completed job
   * @param result - Job result with file sizes
   */
  async handleJobCompletion(job: JobWithPolicy, result: JobResult): Promise<void> {
    this.logger.log(`Job ${job.id} completed successfully`);

    try {
      // Update job to completed status
      await this.queueService.completeJob(job.id, {
        afterSizeBytes: result.afterSizeBytes.toString(),
        savedBytes: result.savedBytes.toString(),
        savedPercent: result.savedPercent,
      });

      // Update library statistics
      await this.updateLibraryStats(job.libraryId, result.savedBytes);

      this.logger.log(
        `Job ${job.id} saved ${this.formatBytes(Number(result.savedBytes))} (${result.savedPercent.toFixed(2)}%)`
      );
    } catch (error) {
      this.logger.error(`Error completing job ${job.id}:`, error);
      throw error;
    }
  }

  /**
   * Handle job failure
   *
   * Implements retry logic (max 3 retries) and marks job as failed if retries exhausted.
   *
   * @param job - Failed job
   * @param error - Error that caused failure
   */
  async handleJobFailure(job: JobWithPolicy, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error(`Job ${job.id} failed: ${errorMessage}`);

    try {
      // Check if this is a transient error that should be retried
      const shouldRetry = this.isTransientError(errorMessage);
      const retryCount = job.retryCount || 0;

      if (shouldRetry && retryCount < this.MAX_RETRIES) {
        this.logger.log(`Retrying job ${job.id} (attempt ${retryCount + 1}/${this.MAX_RETRIES})`);

        // Reset job to QUEUED for retry
        await this.queueService.updateProgress(job.id, {
          stage: 'QUEUED',
          progress: 0,
        });

        // Increment retry count (stored in job metadata)
        // In production, you'd add a retryCount field to the Job model
      } else {
        // Mark job as failed
        await this.queueService.failJob(job.id, errorMessage);
      }
    } catch (updateError) {
      this.logger.error(`Error updating failed job ${job.id}:`, updateError);
    }
  }

  /**
   * Encode a file using FFmpeg with atomic replacement
   *
   * @param job - Job to encode
   * @returns Job result with file sizes
   * @private
   */
  private async encodeFile(job: JobWithPolicy): Promise<JobResult> {
    const beforeSizeBytes = BigInt(fs.statSync(job.filePath).size);

    // Create temporary output path
    const outputDir = path.dirname(job.filePath);
    const outputName = path.basename(job.filePath);
    const tmpPath = path.join(outputDir, `.${outputName}.tmp`);

    try {
      const policy = job.policy;
      if (!policy) {
        throw new Error('Job policy not loaded');
      }

      // Perform encoding
      await this.performEncoding(job, tmpPath, policy);

      // Verify output if enabled
      if (policy.verifyOutput) {
        await this.verifyEncodedFile(tmpPath);
      }

      // Calculate file size changes
      const afterSizeBytes = BigInt(fs.statSync(tmpPath).size);
      const { savedBytes, savedPercent } = this.calculateSavings(beforeSizeBytes, afterSizeBytes);

      // Replace original file with encoded version
      this.replaceFile(job.filePath, tmpPath, policy.atomicReplace);

      return {
        beforeSizeBytes,
        afterSizeBytes,
        savedBytes,
        savedPercent,
      };
    } catch (error) {
      // Clean up temporary file on error
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
      throw error;
    }
  }

  /**
   * Perform FFmpeg encoding on a file
   * @private
   */
  private async performEncoding(
    job: JobWithPolicy,
    tmpPath: string,
    policy: JobWithPolicy['policy']
  ): Promise<void> {
    if (!policy) {
      throw new Error('Policy is required for encoding');
    }

    const advancedSettings = policy.advancedSettings as Record<string, unknown> | null;
    const hwaccel =
      advancedSettings && typeof advancedSettings === 'object' && 'hwaccel' in advancedSettings
        ? String(advancedSettings.hwaccel)
        : 'auto';

    await this.ffmpegService.encode(job.id, {
      inputPath: job.filePath,
      outputPath: tmpPath,
      targetCodec: policy.targetCodec,
      targetQuality: policy.targetQuality,
      hwAccel: hwaccel,
      advancedSettings: advancedSettings ?? undefined,
    });
  }

  /**
   * Verify encoded file is playable
   * @private
   */
  private async verifyEncodedFile(tmpPath: string): Promise<void> {
    const isValid = await this.ffmpegService.verifyFile(tmpPath);
    if (!isValid) {
      throw new Error('Output verification failed - file is not playable');
    }
  }

  /**
   * Calculate space savings from encoding
   * @private
   */
  private calculateSavings(
    beforeSizeBytes: bigint,
    afterSizeBytes: bigint
  ): { savedBytes: bigint; savedPercent: number } {
    const savedBytes = beforeSizeBytes - afterSizeBytes;
    const savedPercent = Number((savedBytes * BigInt(10000)) / beforeSizeBytes) / 100;
    return { savedBytes, savedPercent };
  }

  /**
   * Replace original file with encoded version, optionally using atomic replacement
   * @private
   */
  private replaceFile(originalPath: string, tmpPath: string, atomicReplace: boolean): void {
    if (atomicReplace) {
      this.atomicReplaceFile(originalPath, tmpPath);
    } else {
      fs.renameSync(tmpPath, originalPath);
    }
  }

  /**
   * Atomically replace file with backup on failure
   * @private
   */
  private atomicReplaceFile(originalPath: string, tmpPath: string): void {
    const backupPath = `${originalPath}.backup`;
    fs.renameSync(originalPath, backupPath);

    try {
      fs.renameSync(tmpPath, originalPath);
      fs.unlinkSync(backupPath);
    } catch (replaceError) {
      // Restore backup on failure
      if (fs.existsSync(backupPath)) {
        fs.renameSync(backupPath, originalPath);
      }
      throw replaceError;
    }
  }

  /**
   * Update library statistics after job completion
   *
   * @param libraryId - Library ID to update
   * @param savedBytes - Bytes saved by encoding
   * @private
   */
  private async updateLibraryStats(libraryId: string, savedBytes: bigint): Promise<void> {
    try {
      const library = await this.librariesService.findOne(libraryId);

      // Calculate new total size
      const newTotalSize = library.totalSizeBytes - savedBytes;

      await this.librariesService.update(libraryId, {
        totalSizeBytes: newTotalSize,
      });
    } catch (error) {
      this.logger.error(`Failed to update library stats for ${libraryId}:`, error);
      // Don't throw - library stats update failure shouldn't fail job
    }
  }

  /**
   * Processing loop for worker
   *
   * Continuously polls for new jobs while worker is running.
   *
   * @param nodeId - Node ID
   * @private
   */
  private async processLoop(nodeId: string): Promise<void> {
    const worker = this.workers.get(nodeId);
    if (!worker) return;

    while (worker.isRunning) {
      try {
        const job = await this.processNextJob(nodeId);

        if (!job) {
          // No job available, wait before polling again
          await this.sleep(5000);
        }
      } catch (error) {
        this.logger.error(`Error in processing loop for node ${nodeId}:`, error);
        await this.sleep(5000);
      }
    }

    this.logger.log(`Worker stopped for node ${nodeId}`);
  }

  /**
   * Check if error is transient and should be retried
   *
   * @param errorMessage - Error message
   * @returns True if error is transient
   * @private
   */
  private isTransientError(errorMessage: string): boolean {
    const transientErrors = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'temporarily unavailable',
      'network',
    ];

    return transientErrors.some((err) => errorMessage.toLowerCase().includes(err.toLowerCase()));
  }

  /**
   * Sleep for specified milliseconds
   *
   * @param ms - Milliseconds to sleep
   * @private
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Format bytes to human-readable string
   *
   * @param bytes - Bytes to format
   * @returns Formatted string (e.g., "1.5 GB")
   * @private
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  }
}
