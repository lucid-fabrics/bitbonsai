import { spawn } from 'node:child_process';
import { Injectable, Logger } from '@nestjs/common';
import { type Node } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface TransferProgress {
  jobId: string;
  progress: number; // 0-100
  speedMBps: number | null;
  bytesTransferred: bigint;
  totalBytes: bigint;
  eta: number | null; // seconds
  status: 'PENDING' | 'TRANSFERRING' | 'COMPLETED' | 'FAILED';
  error?: string;
}

/**
 * File Transfer Service
 *
 * Handles file transfers for LINKED nodes without shared storage.
 * Uses rsync over SSH for reliable, resumable transfers with progress tracking.
 *
 * Transfer Protocol: rsync over SSH
 * - Resume support (--partial)
 * - Progress reporting (--info=progress2)
 * - Bandwidth limiting (--bwlimit, optional)
 * - Compression (--compress)
 * - Widely available on Linux systems
 */
@Injectable()
export class FileTransferService {
  private readonly logger = new Logger(FileTransferService.name);
  private activeTransfers = new Map<string, AbortController>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Transfer file from source node to target node
   *
   * @param jobId - Job ID
   * @param sourceFilePath - Full path to source file on main node
   * @param sourceNode - Source node (typically MAIN node)
   * @param targetNode - Target node (LINKED node without shared storage)
   * @returns Promise that resolves when transfer completes
   */
  async transferFile(
    jobId: string,
    sourceFilePath: string,
    sourceNode: Node,
    targetNode: Node
  ): Promise<void> {
    this.logger.log(
      `Starting file transfer for job ${jobId}: ${sourceNode.name} -> ${targetNode.name}`
    );

    try {
      // Check if target node has shared storage (should not be called in this case)
      if (targetNode.hasSharedStorage) {
        this.logger.warn(`Target node ${targetNode.name} has shared storage, transfer not needed`);
        return;
      }

      // Update job to TRANSFERRING stage
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          stage: 'TRANSFERRING',
          transferRequired: true,
          transferStartedAt: new Date(),
          transferProgress: 0,
          transferError: null,
          originalFilePath: sourceFilePath, // CRITICAL: Preserve original path before transfer changes filePath
        },
      });

      // Determine remote temp path (use /tmp on target node)
      const fileName = sourceFilePath.split('/').pop();
      const remoteTempPath = `/tmp/bitbonsai-transfer/${fileName}`;

      // Update job with remote temp path
      await this.prisma.job.update({
        where: { id: jobId },
        data: { remoteTempPath },
      });

      // Create temp directory on target node
      await this.executeRemoteCommand(targetNode, `mkdir -p /tmp/bitbonsai-transfer`);

      // Start rsync transfer
      await this.rsyncTransfer(jobId, sourceFilePath, remoteTempPath, targetNode);

      // Mark transfer as completed
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          stage: 'QUEUED', // Move to QUEUED stage after successful transfer
          transferProgress: 100,
          transferCompletedAt: new Date(),
          transferError: null,
          // Update filePath to point to remote temp path for encoding
          filePath: remoteTempPath,
        },
      });

      this.logger.log(`File transfer completed for job ${jobId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`File transfer failed for job ${jobId}:`, error);

      // Increment retry count
      const job = await this.prisma.job.findUnique({
        where: { id: jobId },
        select: { transferRetryCount: true },
      });

      const retryCount = (job?.transferRetryCount || 0) + 1;
      const maxRetries = 3;

      if (retryCount >= maxRetries) {
        // Max retries reached, mark as failed
        await this.prisma.job.update({
          where: { id: jobId },
          data: {
            stage: 'FAILED',
            transferError: `Transfer failed after ${maxRetries} attempts: ${errorMessage}`,
            transferRetryCount: retryCount,
            failedAt: new Date(),
          },
        });
      } else {
        // Retry transfer
        await this.prisma.job.update({
          where: { id: jobId },
          data: {
            transferError: `Transfer attempt ${retryCount} failed: ${errorMessage}`,
            transferRetryCount: retryCount,
            stage: 'DETECTED', // Reset to DETECTED for retry
          },
        });

        this.logger.log(`Will retry transfer for job ${jobId} (attempt ${retryCount + 1})`);
      }

      throw error;
    }
  }

  /**
   * Execute rsync transfer with progress tracking
   *
   * @param jobId - Job ID
   * @param sourcePath - Source file path
   * @param remotePath - Remote destination path
   * @param targetNode - Target node
   */
  private async rsyncTransfer(
    jobId: string,
    sourcePath: string,
    remotePath: string,
    targetNode: Node
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Create abort controller for cancellation support
      const abortController = new AbortController();
      this.activeTransfers.set(jobId, abortController);

      // Build rsync command
      // rsync -avz --partial --info=progress2 -e "ssh -p 22" /source/file user@host:/dest/path
      const rsyncArgs = [
        '-avz', // Archive mode, verbose, compress
        '--partial', // Resume support
        '--info=progress2', // Progress reporting
        '-e',
        'ssh -o StrictHostKeyChecking=no', // SSH command (disable host key checking for automation)
        sourcePath,
        `root@${targetNode.ipAddress}:${remotePath}`,
      ];

      this.logger.debug(`Executing rsync: rsync ${rsyncArgs.join(' ')}`);

      const rsync = spawn('rsync', rsyncArgs, {
        signal: abortController.signal,
      });

      let lastProgress = 0;

      rsync.stdout.on('data', (data) => {
        const output = data.toString();
        this.logger.debug(`rsync stdout: ${output}`);

        // Parse progress from rsync output
        // Example: "1.23M  12%  345.67kB/s    0:00:23"
        const progressMatch = output.match(/(\d+)%/);
        const speedMatch = output.match(/([\d.]+)([kMG]B\/s)/);

        if (progressMatch) {
          const progress = Number.parseInt(progressMatch[1], 10);

          // Only update DB every 5% to reduce writes
          if (progress >= lastProgress + 5) {
            lastProgress = progress;

            let speedMBps: number | null = null;
            if (speedMatch) {
              const speed = Number.parseFloat(speedMatch[1]);
              const unit = speedMatch[2];

              // Convert to MB/s
              if (unit === 'kB/s') {
                speedMBps = speed / 1024;
              } else if (unit === 'MB/s') {
                speedMBps = speed;
              } else if (unit === 'GB/s') {
                speedMBps = speed * 1024;
              }
            }

            // Update job progress
            this.prisma.job
              .update({
                where: { id: jobId },
                data: {
                  transferProgress: progress,
                  transferSpeedMBps: speedMBps,
                },
              })
              .catch((err) => {
                this.logger.error(`Failed to update transfer progress for job ${jobId}:`, err);
              });
          }
        }
      });

      rsync.stderr.on('data', (data) => {
        this.logger.error(`rsync stderr: ${data.toString()}`);
      });

      rsync.on('close', (code) => {
        this.activeTransfers.delete(jobId);

        if (code === 0) {
          this.logger.log(`rsync completed successfully for job ${jobId}`);
          resolve();
        } else {
          reject(new Error(`rsync exited with code ${code}`));
        }
      });

      rsync.on('error', (error) => {
        this.activeTransfers.delete(jobId);
        this.logger.error(`rsync process error for job ${jobId}:`, error);
        reject(error);
      });
    });
  }

  /**
   * Execute remote command on target node via SSH
   *
   * @param targetNode - Target node
   * @param command - Command to execute
   */
  private async executeRemoteCommand(targetNode: Node, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const sshArgs = ['-o', 'StrictHostKeyChecking=no', `root@${targetNode.ipAddress}`, command];

      const ssh = spawn('ssh', sshArgs);

      let stdout = '';
      let stderr = '';

      ssh.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ssh.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ssh.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`SSH command failed with code ${code}: ${stderr}`));
        }
      });

      ssh.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Get transfer progress for a job
   *
   * @param jobId - Job ID
   * @returns Transfer progress
   */
  async getTransferProgress(jobId: string): Promise<TransferProgress> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        stage: true,
        transferRequired: true,
        transferProgress: true,
        transferSpeedMBps: true,
        transferError: true,
        beforeSizeBytes: true,
      },
    });

    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const totalBytes = job.beforeSizeBytes;
    const bytesTransferred = BigInt(Math.floor((Number(totalBytes) * job.transferProgress) / 100));

    let status: TransferProgress['status'] = 'PENDING';
    if (job.stage === 'TRANSFERRING') {
      status = 'TRANSFERRING';
    } else if (job.transferProgress === 100) {
      status = 'COMPLETED';
    } else if (job.transferError) {
      status = 'FAILED';
    }

    const eta =
      job.transferSpeedMBps && job.transferProgress > 0
        ? Math.floor(
            (Number(totalBytes) / (1024 * 1024) -
              (Number(totalBytes) / (1024 * 1024)) * (job.transferProgress / 100)) /
              job.transferSpeedMBps
          )
        : null;

    return {
      jobId: job.id,
      progress: job.transferProgress,
      speedMBps: job.transferSpeedMBps,
      bytesTransferred,
      totalBytes,
      eta,
      status,
      error: job.transferError || undefined,
    };
  }

  /**
   * Cancel ongoing transfer
   *
   * @param jobId - Job ID
   */
  async cancelTransfer(jobId: string): Promise<void> {
    const abortController = this.activeTransfers.get(jobId);

    if (abortController) {
      this.logger.log(`Cancelling transfer for job ${jobId}`);
      abortController.abort();
      this.activeTransfers.delete(jobId);

      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          stage: 'CANCELLED',
          transferError: 'Transfer cancelled by user',
        },
      });
    } else {
      this.logger.warn(`No active transfer found for job ${jobId}`);
    }
  }

  /**
   * Clean up remote temp file after job completion
   *
   * @param jobId - Job ID
   */
  async cleanupRemoteTempFile(jobId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        remoteTempPath: true,
        node: {
          select: {
            id: true,
            name: true,
            ipAddress: true,
          },
        },
      },
    });

    if (!job?.remoteTempPath) {
      return;
    }

    try {
      this.logger.log(`Cleaning up remote temp file for job ${jobId}: ${job.remoteTempPath}`);

      await this.executeRemoteCommand(job.node as Node, `rm -f "${job.remoteTempPath}"`);

      await this.prisma.job.update({
        where: { id: jobId },
        data: { remoteTempPath: null },
      });

      this.logger.log(`Remote temp file cleaned up for job ${jobId}`);
    } catch (error) {
      this.logger.error(`Failed to clean up remote temp file for job ${jobId}:`, error);
    }
  }
}
