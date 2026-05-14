import { Injectable, Logger } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * CircuitBreakerService
 *
 * Global retry limiter that permanently excludes flaky jobs once they have
 * accumulated too many total attempts across all retry systems
 * (auto-heal × stuck-recovery × corrupted-requeue = up to ~75 attempts).
 *
 * When totalAttempts >= CIRCUIT_BREAK_THRESHOLD the job is marked FAILED
 * with circuitBroken=true and is excluded from all subsequent retry passes.
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  /** Maximum total attempts before a job is permanently broken */
  private readonly CIRCUIT_BREAK_THRESHOLD = 10;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Increment totalAttempts for a job and break the circuit if the threshold
   * is reached.
   *
   * @param jobId  - Job to check
   * @param reason - Human-readable reason recorded on break (e.g. caller name)
   * @returns true if the circuit was broken (job permanently failed), false otherwise
   */
  async checkAndBreak(jobId: string, reason: string): Promise<boolean> {
    // Atomic increment: avoids the read+write TOCTOU race where two concurrent
    // callers both read totalAttempts=9, compute 10, and neither trips the breaker.
    const updated = await this.prisma.job
      .update({
        where: { id: jobId },
        data: { totalAttempts: { increment: 1 } },
        select: { totalAttempts: true, circuitBroken: true, fileLabel: true },
      })
      .catch(() => null);

    if (!updated) {
      this.logger.warn(`checkAndBreak: job ${jobId} not found`);
      return false;
    }

    // Already broken — nothing more to do
    if (updated.circuitBroken) {
      return true;
    }

    const newTotal = updated.totalAttempts;

    if (newTotal >= this.CIRCUIT_BREAK_THRESHOLD) {
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          circuitBroken: true,
          circuitBrokenAt: new Date(),
          circuitBrokenReason: reason,
          stage: JobStage.FAILED,
          failedAt: new Date(),
          error: `Circuit broken after ${newTotal} total attempts: ${reason}`,
        },
      });

      this.logger.warn(
        `✗ Circuit broken: ${updated.fileLabel} (${newTotal} total attempts) — ${reason} → FAILED permanently`
      );
      return true;
    }

    this.logger.debug(
      `Circuit check: ${updated.fileLabel} — attempt ${newTotal}/${this.CIRCUIT_BREAK_THRESHOLD}`
    );
    return false;
  }

  /**
   * Fast read-only check for whether a job's circuit is already broken.
   * Use this before doing any expensive work on a job.
   *
   * @param jobId - Job to check
   * @returns true if the circuit is broken (job should be skipped)
   */
  async isCircuitBroken(jobId: string): Promise<boolean> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { circuitBroken: true },
    });
    return job?.circuitBroken ?? false;
  }
}
