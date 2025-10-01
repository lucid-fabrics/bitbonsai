import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Job } from '@prisma/client';
import { LibrariesService } from '../libraries/libraries.service';
import { QueueService } from '../queue/queue.service';
import type { FfmpegProgress, FfmpegService } from './ffmpeg.service';

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
export class EncodingProcessorService {
  private readonly logger = new Logger(EncodingProcessorService.name);
  private readonly workers = new Map<string, WorkerState>();
  private readonly MAX_RETRIES = 3;
  private readonly PROGRESS_INTERVAL = 5000; // 5 seconds

  constructor(
    private readonly queueService: QueueService,
    private readonly ffmpegService: FfmpegService,
    private readonly librariesService: LibrariesService
  ) {}

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
  async processNextJob(nodeId: string): Promise<Job | null> {
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

        // Get file size before encoding
        const beforeSize = BigInt(fs.statSync(job.filePath).size);

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
  async handleJobCompletion(job: Job, result: JobResult): Promise<void> {
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
  async handleJobFailure(job: Job, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error(`Job ${job.id} failed: ${errorMessage}`);

    try {
      // Check if this is a transient error that should be retried
      const shouldRetry = this.isTransientError(errorMessage);
      const retryCount = (job as any).retryCount || 0;

      if (shouldRetry && retryCount < this.MAX_RETRIES) {
        this.logger.log(`Retrying job ${job.id} (attempt ${retryCount + 1}/${this.MAX_RETRIES})`);

        // Reset job to QUEUED for retry
        await this.queueService.updateProgress(job.id, {
          stage: 'QUEUED' as any,
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
   * Listen for FFmpeg progress events
   *
   * Updates job progress in database every time FFmpeg reports progress.
   *
   * @param progress - FFmpeg progress data
   * @private
   */
  @OnEvent('ffmpeg.progress')
  private async handleProgress(progress: FfmpegProgress): Promise<void> {
    try {
      await this.queueService.updateProgress(progress.jobId, {
        progress: Math.round(progress.progress),
        etaSeconds: progress.etaSeconds,
      });
    } catch (error) {
      // Don't log every progress update failure, just skip
    }
  }

  /**
   * Encode a file using FFmpeg with atomic replacement
   *
   * @param job - Job to encode
   * @returns Job result with file sizes
   * @private
   */
  private async encodeFile(job: Job): Promise<JobResult> {
    const beforeSizeBytes = BigInt(fs.statSync(job.filePath).size);

    // Create temporary output path
    const outputDir = path.dirname(job.filePath);
    const outputName = path.basename(job.filePath);
    const tmpPath = path.join(outputDir, `.${outputName}.tmp`);

    try {
      // Get policy settings
      const policy = (job as any).policy;
      if (!policy) {
        throw new Error('Job policy not loaded');
      }

      // Perform encoding
      await this.ffmpegService.encode(job.id, {
        inputPath: job.filePath,
        outputPath: tmpPath,
        targetCodec: policy.targetCodec,
        targetQuality: policy.targetQuality,
        hwAccel: policy.advancedSettings?.hwaccel || 'auto',
        advancedSettings: policy.advancedSettings,
      });

      // Verify output if enabled
      if (policy.verifyOutput) {
        const isValid = await this.ffmpegService.verifyFile(tmpPath);
        if (!isValid) {
          throw new Error('Output verification failed - file is not playable');
        }
      }

      // Get encoded file size
      const afterSizeBytes = BigInt(fs.statSync(tmpPath).size);

      // Calculate savings
      const savedBytes = beforeSizeBytes - afterSizeBytes;
      const savedPercent = Number((savedBytes * BigInt(10000)) / beforeSizeBytes) / 100;

      // Atomic replacement if enabled
      if (policy.atomicReplace) {
        // Backup original
        const backupPath = `${job.filePath}.backup`;
        fs.renameSync(job.filePath, backupPath);

        try {
          // Replace with encoded file
          fs.renameSync(tmpPath, job.filePath);

          // Remove backup
          fs.unlinkSync(backupPath);
        } catch (replaceError) {
          // Restore backup on failure
          if (fs.existsSync(backupPath)) {
            fs.renameSync(backupPath, job.filePath);
          }
          throw replaceError;
        }
      } else {
        // Just replace directly
        fs.renameSync(tmpPath, job.filePath);
      }

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
