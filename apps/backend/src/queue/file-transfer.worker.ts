import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { JobStage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FileTransferService } from './services/file-transfer.service';

/**
 * CRITICAL #5 FIX: Dedicated worker for file transfers
 *
 * Polls for jobs with transferRequired=true and stage=DETECTED every 10 seconds.
 * Resilient to crashes - transfers won't be lost if process restarts.
 *
 * UX Philosophy: Zero manual intervention - transfers happen automatically.
 */
@Injectable()
export class FileTransferWorker {
  private readonly logger = new Logger(FileTransferWorker.name);
  private readonly MAX_CONCURRENT_TRANSFERS = 3;
  private activeTransfers = new Set<string>();

  // HIGH #1 FIX: Circuit breaker to prevent starvation
  private timeoutCount = 0;
  private readonly MAX_TIMEOUT_COUNT = 3; // All slots stuck = circuit opens
  private circuitOpen = false;
  private circuitResetTimeout?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileTransferService: FileTransferService
  ) {}

  /**
   * Process pending file transfers every 10 seconds
   */
  @Interval(10000)
  async processTransfers(): Promise<void> {
    try {
      // HIGH #1 FIX: Skip processing if circuit breaker is open
      if (this.circuitOpen) {
        this.logger.warn('🚨 Circuit breaker OPEN - skipping transfers until reset');
        return;
      }

      // Find jobs needing transfer
      const jobs = await this.prisma.job.findMany({
        where: {
          transferRequired: true,
          stage: JobStage.DETECTED,
          transferProgress: { lt: 100 },
        },
        include: {
          library: {
            include: {
              node: true,
            },
          },
          node: true,
        },
        take: this.MAX_CONCURRENT_TRANSFERS,
      });

      if (jobs.length === 0) {
        return;
      }

      this.logger.log(`Found ${jobs.length} job(s) requiring file transfer`);

      for (const job of jobs) {
        // Skip if already being transferred
        if (this.activeTransfers.has(job.id)) {
          continue;
        }

        // Skip if missing node info
        if (!job.library.node || !job.node) {
          this.logger.warn(`Job ${job.id} missing node info, skipping`);
          continue;
        }

        // Mark as active
        this.activeTransfers.add(job.id);

        // HIGH #1 FIX: Add 30-minute timeout wrapper to prevent starvation
        const transferPromise = this.fileTransferService.transferFile(
          job.id,
          job.filePath,
          job.library.node,
          job.node
        );

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Transfer timeout (30min)')), 30 * 60 * 1000)
        );

        Promise.race([transferPromise, timeoutPromise])
          .then(() => {
            this.logger.log(`✅ Transfer complete for job ${job.id}`);
            // HIGH #1 FIX: Reset timeout count on success
            if (this.timeoutCount > 0) {
              this.timeoutCount = 0;
              this.logger.log('✅ Circuit breaker: Reset timeout count');
            }
          })
          .catch((error) => {
            this.logger.error(`❌ Transfer failed for job ${job.id}:`, error);

            // HIGH #1 FIX: Increment timeout count and open circuit if needed
            if (error.message?.includes('timeout')) {
              this.timeoutCount++;
              this.logger.warn(`⚠️ Timeout ${this.timeoutCount}/${this.MAX_TIMEOUT_COUNT}`);

              if (this.timeoutCount >= this.MAX_TIMEOUT_COUNT) {
                this.openCircuit();
              }
            }
          })
          .finally(() => {
            this.activeTransfers.delete(job.id);
          });
      }
    } catch (error) {
      this.logger.error('Error processing transfers:', error);
    }
  }

  /**
   * HIGH #1 FIX: Open circuit breaker and schedule auto-reset
   * Prevents all transfers for 5 minutes when all slots timeout
   */
  private openCircuit(): void {
    this.circuitOpen = true;
    this.logger.error(
      '🚨 Circuit breaker OPENED: All transfer slots timed out. Pausing transfers for 5 minutes.'
    );

    // Clear existing reset timeout if any
    if (this.circuitResetTimeout) {
      clearTimeout(this.circuitResetTimeout);
    }

    // Auto-reset after 5 minutes
    this.circuitResetTimeout = setTimeout(
      () => {
        this.circuitOpen = false;
        this.timeoutCount = 0;
        this.logger.log('✅ Circuit breaker CLOSED: Resuming file transfers');
      },
      5 * 60 * 1000
    );
  }
}
