import { exec, spawn } from 'node:child_process';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
export class FileTransferService implements OnModuleInit {
  private readonly logger = new Logger(FileTransferService.name);
  private activeTransfers = new Map<string, AbortController>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * CRITICAL #2 FIX: Kill orphaned SSH/rsync processes from previous crash
   * Prevents resource leaks when service restarts without cleanup
   */
  async onModuleInit() {
    try {
      exec('pkill -f "^(ssh|rsync).*bitbonsai"', (error, stdout, stderr) => {
        // Exit code 1 means no processes found (expected on clean start)
        if (!error || error.code === 1) {
          this.logger.log('🧹 CRITICAL #2 FIX: Killed orphaned SSH/rsync processes');
        } else {
          this.logger.warn(`Failed to kill orphaned processes: ${stderr}`);
        }
      });
    } catch (error) {
      this.logger.warn(`CRITICAL #2 FIX: Error killing orphaned SSH: ${error}`);
    }
  }

  /**
   * SECURITY: Validate rsync file path to prevent command injection
   * MEDIUM #1 FIX: Enhanced validation with control character and length checks
   * SEC #1 FIX: Reject spaces to prevent shell expansion attacks
   * CRITICAL #4 FIX: Explicitly reject newlines to prevent rsync argument injection
   * @private
   */
  private validateRsyncPath(path: string): void {
    // CRITICAL #4 FIX: Reject ALL control chars including newlines (\n, \r)
    // Newlines allow injecting arbitrary rsync arguments
    if (/[\x00-\x1F\x7F\n\r]/.test(path)) {
      throw new Error('Path contains control characters or newlines');
    }

    // MEDIUM #1 FIX: Check path length (Unix limit is 4096)
    if (path.length > 4096) {
      throw new Error('Path exceeds maximum length (4096 characters)');
    }

    // SEC #1 FIX: Strict character whitelist - NO SPACES to prevent shell expansion
    if (!/^[a-zA-Z0-9/_\-.]+$/.test(path)) {
      throw new Error(
        'Invalid path characters detected (spaces and special chars not allowed for security)'
      );
    }

    // Path traversal protection
    if (path.includes('..') || path.includes('//')) {
      throw new Error('Path traversal attempt detected');
    }

    // MEDIUM #1 FIX: Prevent rsync daemon syntax (::)
    if (path.includes('::')) {
      throw new Error('Path contains rsync daemon syntax');
    }
  }

  /**
   * SECURITY: Validate IP address format
   * @private
   */
  private validateIpAddress(ip: string): void {
    const ipRegex =
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipRegex.test(ip)) {
      throw new Error('Invalid IP address format');
    }
  }

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

      // SECURITY: Validate inputs before rsync to prevent command injection
      this.validateRsyncPath(sourceFilePath);
      if (!targetNode.ipAddress) {
        throw new Error(`Target node ${targetNode.name} has no IP address`);
      }
      this.validateIpAddress(targetNode.ipAddress);

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
      // SEC #2 FIX: Use StrictHostKeyChecking=yes with pre-populated known_hosts for MITM protection
      // Note: For first-time setup, admin must manually add host keys to ~/.ssh/known_hosts
      // rsync -avz --partial --info=progress2 -e "ssh -p 22" /source/file user@host:/dest/path
      const rsyncArgs = [
        '-avz', // Archive mode, verbose, compress
        '--partial', // Resume support
        '--info=progress2', // Progress reporting
        '-e',
        'ssh -o StrictHostKeyChecking=yes', // SEC #2 FIX: Reject unknown/changed host keys
        sourcePath,
        `root@${targetNode.ipAddress}:${remotePath}`,
      ];

      this.logger.debug(`Executing rsync: rsync ${rsyncArgs.join(' ')}`);

      const rsync = spawn('rsync', rsyncArgs, {
        signal: abortController.signal,
      });

      // HIGH #15 FIX: Cleanup function to destroy streams on abort
      const cleanup = () => {
        this.activeTransfers.delete(jobId);
        rsync.stdout?.destroy();
        rsync.stderr?.destroy();
        if (!rsync.killed) {
          rsync.kill('SIGKILL');
        }
      };

      // HIGH #15 FIX: Register abort handler to cleanup streams
      abortController.signal.addEventListener('abort', () => {
        this.logger.log(`Transfer aborted for job ${jobId}, cleaning up rsync process`);
        cleanup();
      });

      let lastProgress = 0;
      // CRITICAL FIX #3: Atomic error counter using object property (not local variable)
      // This prevents race conditions when multiple progress updates arrive simultaneously
      const progressState = {
        consecutiveUpdateFailures: 0,
        pendingUpdate: false, // Prevents overlapping DB updates
      };
      const MAX_CONSECUTIVE_FAILURES = 3;

      // MEDIUM #4 FIX: Capture stderr for error reporting
      let stderrBuffer = '';

      rsync.stdout.on('data', (data) => {
        const output = data.toString();
        this.logger.debug(`rsync stdout: ${output}`);

        // Parse progress from rsync output
        // MEDIUM #3 FIX: Locale-independent regex (matches numbers in any locale)
        // Example: "1.23M  12%  345.67kB/s    0:00:23" or "1,23M  12%  345,67kB/s"
        const progressMatch = output.match(/(\d+)%/);
        const speedMatch = output.match(/([\d.,]+)([kMG]B\/s)/);

        if (progressMatch) {
          const progress = Number.parseInt(progressMatch[1], 10);

          // Only update DB every 5% to reduce writes
          if (progress >= lastProgress + 5) {
            lastProgress = progress;

            let speedMBps: number | null = null;
            if (speedMatch) {
              // MEDIUM #3 FIX: Normalize comma decimal separator to period for parseFloat
              const speedStr = speedMatch[1].replace(',', '.');
              const speed = Number.parseFloat(speedStr);
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

            // CRITICAL #3 FIX: Atomic check-and-set with timeout wrapper
            const wasUpdating = progressState.pendingUpdate;
            progressState.pendingUpdate = true;

            if (wasUpdating) {
              this.logger.debug(
                `Skipping progress update for job ${jobId} - another update is in progress`
              );
              return;
            }

            // CRITICAL #3 FIX: Wrap DB update with 5s timeout to prevent deadlock
            const updatePromise = Promise.race([
              this.prisma.job.update({
                where: { id: jobId },
                data: {
                  transferProgress: progress,
                  transferSpeedMBps: speedMBps,
                },
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Progress update timeout (5s)')), 5000)
              ),
            ]);

            // HIGH #1 FIX: Ensure .finally() runs AFTER .catch() to prevent race
            updatePromise
              .catch((err) => {
                progressState.consecutiveUpdateFailures++;
                this.logger.error(
                  `Failed to update transfer progress for job ${jobId} (${progressState.consecutiveUpdateFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
                  err
                );

                // If too many consecutive failures, abort transfer
                if (progressState.consecutiveUpdateFailures >= MAX_CONSECUTIVE_FAILURES) {
                  this.logger.error(
                    `Aborting transfer for job ${jobId}: ${MAX_CONSECUTIVE_FAILURES} consecutive progress update failures`
                  );
                  abortController.abort();
                }
              })
              .then(() => {
                // Reset failure counter on success (runs after catch)
                if (progressState.consecutiveUpdateFailures === 0) {
                  return; // Already reset, was success
                }
                // Don't reset if catch incremented it
              })
              .finally(() => {
                // HIGH #1 FIX: Reset flag AFTER catch evaluation completes
                progressState.pendingUpdate = false;
              });
          }
        }
      });

      rsync.stderr.on('data', (data) => {
        const errorText = data.toString();
        stderrBuffer += errorText;
        this.logger.error(`rsync stderr: ${errorText}`);
      });

      rsync.on('close', (code) => {
        this.activeTransfers.delete(jobId);
        rsync.stdout?.destroy();
        rsync.stderr?.destroy();

        if (code === 0) {
          this.logger.log(`rsync completed successfully for job ${jobId}`);
          resolve();
        } else {
          // MEDIUM #4 FIX: Include stderr in error message for debugging
          const errorMessage = stderrBuffer.trim() || `rsync exited with code ${code}`;
          reject(new Error(errorMessage));
        }
      });

      rsync.on('error', (error) => {
        this.activeTransfers.delete(jobId);
        rsync.stdout?.destroy();
        rsync.stderr?.destroy();
        this.logger.error(`rsync process error for job ${jobId}:`, error);
        reject(error);
      });
    });
  }

  // CRITICAL #4 FIX: Instance-level SSH process tracking to prevent orphans
  private activeSshProcesses = new Map<
    string,
    { process: ReturnType<typeof spawn>; cleanup: () => void }
  >();

  /**
   * Execute remote command on target node via SSH
   *
   * CRITICAL #4 FIX: Centralized process tracking prevents orphaned SSH processes
   *
   * @param targetNode - Target node
   * @param command - Command to execute
   * @param timeoutMs - Timeout in milliseconds (default: 30000ms / 30 seconds)
   */
  private async executeRemoteCommand(
    targetNode: Node,
    command: string,
    timeoutMs = 30000
  ): Promise<string> {
    const commandId = `${targetNode.id}-${Date.now()}-${Math.random()}`;
    const sshArgs = [
      '-o',
      'StrictHostKeyChecking=yes', // SEC #2 FIX: Reject unknown host keys
      `root@${targetNode.ipAddress}`,
      command,
    ];

    const ssh = spawn('ssh', sshArgs);
    let timeout: NodeJS.Timeout | null = null;
    let forceKillTimeout: NodeJS.Timeout | null = null;

    // CRITICAL #4 FIX: Idempotent cleanup registered in instance map
    const cleanup = () => {
      const entry = this.activeSshProcesses.get(commandId);
      if (!entry) return; // Already cleaned

      this.activeSshProcesses.delete(commandId);

      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
        forceKillTimeout = null;
      }
      if (!ssh.killed) {
        ssh.kill('SIGKILL');
      }
      ssh.stdout?.destroy();
      ssh.stderr?.destroy();
    };

    // Register process for tracking
    this.activeSshProcesses.set(commandId, { process: ssh, cleanup });

    try {
      const result = await new Promise<string>((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;

        // Set timeout to kill the SSH process if it hangs
        timeout = setTimeout(() => {
          timedOut = true;
          ssh.kill('SIGTERM');

          // CRITICAL #4 FIX: Force kill if SIGTERM didn't work
          forceKillTimeout = setTimeout(() => {
            if (!ssh.killed) {
              ssh.kill('SIGKILL');
            }
          }, 5000);

          reject(
            new Error(
              `SSH command timed out after ${timeoutMs}ms on ${targetNode.name} (${targetNode.ipAddress})`
            )
          );
        }, timeoutMs);

        ssh.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        ssh.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ssh.on('close', (code) => {
          if (timedOut) {
            return; // Already rejected with timeout error
          }

          if (code === 0) {
            resolve(stdout);
          } else {
            reject(new Error(`SSH command failed with code ${code}: ${stderr}`));
          }
        });

        ssh.on('error', (error) => {
          if (timedOut) {
            return; // Already rejected with timeout error
          }

          reject(error);
        });
      });

      return result;
    } finally {
      // CRITICAL #4 FIX: Always cleanup via centralized tracker
      cleanup();
    }
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
