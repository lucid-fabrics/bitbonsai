import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { promises as fs } from 'fs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Completion payload persisted to the outbox before the final DB update.
 * Allows startup replay if the process crashes between ffmpeg success
 * and the job.update(COMPLETED) call.
 */
export interface CompletionPayload {
  outputPath: string;
  outputSizeBytes: number;
  savedBytes: number;
  savedPercent: number;
  codec: string;
}

/**
 * CompletionOutboxService
 *
 * Write-before-update outbox that guards against the "ffmpeg succeeded but
 * DB update failed" split-brain problem.
 *
 * Usage:
 *   1. Call writeOutbox() immediately before the final completeJob() call.
 *   2. Call clearOutbox() immediately after completeJob() succeeds.
 *
 * On startup, replayPendingCompletions() finds any jobs whose outbox entry
 * was never cleared and re-applies the COMPLETED update so no wasted work
 * is re-queued.
 */
@Injectable()
export class CompletionOutboxService implements OnModuleInit {
  private readonly logger = new Logger(CompletionOutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs automatically when the module initializes.
   * Re-applies any completions that were written but never committed.
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('CompletionOutboxService initializing — replaying pending completions...');
    await this.replayPendingCompletions();
  }

  /**
   * Write the outbox entry before the final DB update.
   * Must be called before completeJob() to guarantee durability.
   *
   * @param jobId  - Job to protect
   * @param data   - Completion payload that will be re-applied on startup if needed
   */
  async writeOutbox(jobId: string, data: CompletionPayload): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        pendingCompletionData: JSON.stringify(data),
        pendingCompletionAt: new Date(),
      },
    });
    this.logger.debug(`Outbox written for job ${jobId}`);
  }

  /**
   * Clear the outbox entry after a successful final DB update.
   * Must be called immediately after completeJob() succeeds.
   *
   * @param jobId - Job whose outbox entry should be cleared
   */
  async clearOutbox(jobId: string): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        pendingCompletionData: null,
        pendingCompletionAt: null,
      },
    });
    this.logger.debug(`Outbox cleared for job ${jobId}`);
  }

  /**
   * Replay any pending completions that were written but never committed.
   * Called on module init so no wasted work is re-queued after a crash.
   *
   * @returns Number of completions replayed
   */
  async replayPendingCompletions(): Promise<number> {
    try {
      const pendingJobs = await this.prisma.job.findMany({
        where: {
          pendingCompletionData: { not: null },
          // Only replay jobs that are not already completed
          stage: { not: JobStage.COMPLETED },
        },
        select: {
          id: true,
          fileLabel: true,
          pendingCompletionData: true,
          pendingCompletionAt: true,
        },
      });

      if (pendingJobs.length === 0) {
        this.logger.log('No pending completions to replay');
        return 0;
      }

      this.logger.warn(
        `Found ${pendingJobs.length} job(s) with pending completion data — replaying...`
      );

      let replayedCount = 0;

      for (const job of pendingJobs) {
        try {
          if (!job.pendingCompletionData) {
            continue;
          }

          let payload: CompletionPayload;
          try {
            payload = JSON.parse(job.pendingCompletionData) as CompletionPayload;
          } catch {
            this.logger.warn(
              `Outbox replay: malformed JSON for job ${job.id} (${job.fileLabel}) — clearing outbox and resetting to QUEUED`
            );
            await this.prisma.job.update({
              where: { id: job.id },
              data: {
                stage: JobStage.QUEUED,
                pendingCompletionData: null,
                pendingCompletionAt: null,
              },
            });
            continue;
          }

          // Guard: verify output file exists before marking COMPLETED.
          // If the crash happened mid-rename (temp→final), the file may be missing.
          try {
            await fs.stat(payload.outputPath);
          } catch {
            this.logger.warn(
              `Outbox replay: output file missing at ${payload.outputPath}, resetting job ${job.id} to QUEUED`
            );
            await this.prisma.job.update({
              where: { id: job.id },
              data: {
                stage: JobStage.QUEUED,
                pendingCompletionData: null,
                pendingCompletionAt: null,
              },
            });
            continue;
          }

          await this.prisma.job.update({
            where: { id: job.id },
            data: {
              stage: JobStage.COMPLETED,
              progress: 100,
              afterSizeBytes: BigInt(Math.round(payload.outputSizeBytes)),
              savedBytes: BigInt(Math.round(payload.savedBytes)),
              savedPercent: payload.savedPercent,
              completedAt: new Date(),
              // Clear outbox atomically with the completion update
              pendingCompletionData: null,
              pendingCompletionAt: null,
            },
          });

          this.logger.log(
            `✅ Replayed completion for job ${job.fileLabel} (saved ${payload.savedPercent.toFixed(2)}%)`
          );
          replayedCount++;
        } catch (replayError) {
          this.logger.error(
            `Failed to replay completion for job ${job.id} (${job.fileLabel})`,
            replayError instanceof Error ? replayError.stack : String(replayError)
          );
        }
      }

      this.logger.log(`Completion replay complete: ${replayedCount} job(s) restored`);
      return replayedCount;
    } catch (error) {
      this.logger.error('Failed to replay pending completions', error);
      return 0;
    }
  }
}
