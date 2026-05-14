import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { NodeConfigService } from '../../core/services/node-config.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * OwnershipLeaseService
 *
 * Prevents split-brain during network partitions in MAIN↔LINKED multi-node setups.
 *
 * When a LINKED node takes a job and the network partitions, MAIN cannot tell if the
 * job is still progressing. Without a lease, MAIN might reassign the job to another
 * node while LINKED is still encoding.
 *
 * Solution:
 * - Each node holds a 60-second lease on jobs it encodes.
 * - The encoding node renews the lease every 30 seconds.
 * - On startup (MAIN only), expired leases are reclaimed: jobs reset to QUEUED.
 *
 * Optimistic locking via ownershipEpoch prevents double-reclaim races.
 */
@Injectable()
export class OwnershipLeaseService implements OnModuleInit {
  private readonly logger = new Logger(OwnershipLeaseService.name);

  private readonly LEASE_TTL_MS = 60_000;
  private readonly RENEWAL_INTERVAL_MS = 30_000;

  /** Map of jobId → renewal interval handle */
  private readonly renewalMap = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly nodeConfig: NodeConfigService
  ) {}

  /**
   * On startup, MAIN node reclaims jobs whose leases have expired.
   * LINKED nodes skip this — they only own the reclaim of their own orphaned jobs
   * via QueueProcessingService.resetOrphanedEncodingJobs().
   */
  async onModuleInit(): Promise<void> {
    if (!this.nodeConfig.isMainNode()) {
      this.logger.log('Skipping lease reclaim scan on LINKED node (MAIN node responsibility)');
      return;
    }

    await this.reclaimExpiredLeases();
  }

  /**
   * Extend ownershipLeaseExpiry by LEASE_TTL_MS for a job this node owns.
   *
   * Uses an optimistic WHERE clause:
   *   - lease IS NULL (never had one) OR lease expires within the next renewal window
   *
   * If the lease was already expired before renewal arrived, ownership has transferred
   * to MAIN (epoch incremented during reclaim). In that case the update will match 0
   * rows and we log a warning — the job is already reclaimed, stop renewing.
   *
   * @param jobId - Job to renew
   * @param nodeId - Node that owns the job (used for logging)
   * @returns true if renewal succeeded, false if lease was already expired/reclaimed
   */
  async renewLease(jobId: string, nodeId: string): Promise<boolean> {
    const now = new Date();
    const newExpiry = new Date(now.getTime() + this.LEASE_TTL_MS);

    try {
      const result = await this.prisma.job.updateMany({
        where: {
          id: jobId,
          stage: JobStage.ENCODING,
          // Only renew if lease is still ours: null (first renewal) or not yet expired
          OR: [{ ownershipLeaseExpiry: null }, { ownershipLeaseExpiry: { gte: now } }],
        },
        data: {
          ownershipLeaseExpiry: newExpiry,
        },
      });

      if (result.count === 0) {
        this.logger.warn(
          `Lease renewal failed for job ${jobId} on node ${nodeId} — lease may have expired and been reclaimed`
        );
        return false;
      }

      this.logger.debug(
        `Lease renewed for job ${jobId} on node ${nodeId} until ${newExpiry.toISOString()}`
      );
      return true;
    } catch (error) {
      this.logger.error(`Failed to renew lease for job ${jobId}`, error);
      return false;
    }
  }

  /**
   * Start background renewal for a job.
   * Calls renewLease every RENEWAL_INTERVAL_MS.
   * If renewal fails (lease reclaimed), stops automatically.
   *
   * @param jobId - Job to keep alive
   * @param nodeId - Node that owns the encoding
   */
  startRenewing(jobId: string, nodeId: string): void {
    if (this.renewalMap.has(jobId)) {
      this.logger.debug(`Lease renewal already active for job ${jobId}`);
      return;
    }

    const intervalId = setInterval(async () => {
      const success = await this.renewLease(jobId, nodeId);
      if (!success) {
        // Lease lost — stop renewing silently (job is reclaimed)
        this.stopRenewing(jobId);
      }
    }, this.RENEWAL_INTERVAL_MS);

    this.renewalMap.set(jobId, intervalId);
    this.logger.debug(
      `Started lease renewal for job ${jobId} on node ${nodeId} (interval: ${this.RENEWAL_INTERVAL_MS}ms)`
    );
  }

  /**
   * Stop background renewal for a job.
   * Safe to call even if no renewal is running (no-op).
   *
   * @param jobId - Job to stop renewing
   */
  stopRenewing(jobId: string): void {
    const intervalId = this.renewalMap.get(jobId);
    if (intervalId) {
      clearInterval(intervalId);
      this.renewalMap.delete(jobId);
      this.logger.debug(`Stopped lease renewal for job ${jobId}`);
    }
  }

  /**
   * MAIN-only: scan for ENCODING jobs whose leases have expired and reset them to QUEUED.
   *
   * Increments ownershipEpoch to act as an optimistic fence — any in-flight renewal
   * from the old node will match 0 rows (epoch mismatch prevents double-reset).
   *
   * @returns Number of jobs reclaimed
   */
  async reclaimExpiredLeases(): Promise<number> {
    const now = new Date();

    try {
      const expiredJobs = await this.prisma.job.findMany({
        where: {
          stage: JobStage.ENCODING,
          ownershipLeaseExpiry: { lt: now },
        },
        select: {
          id: true,
          nodeId: true,
          ownershipEpoch: true,
          fileLabel: true,
        },
      });

      if (expiredJobs.length === 0) {
        this.logger.debug('Lease reclaim scan: no expired leases found');
        return 0;
      }

      this.logger.warn(`Lease reclaim scan: found ${expiredJobs.length} expired lease(s)`);

      let reclaimedCount = 0;

      for (const job of expiredJobs) {
        try {
          // Optimistic lock: only update if epoch matches what we read.
          // Prevents racing with a successful renewal that arrived after our query.
          const result = await this.prisma.job.updateMany({
            where: {
              id: job.id,
              ownershipEpoch: job.ownershipEpoch,
              ownershipLeaseExpiry: { lt: now },
            },
            data: {
              stage: JobStage.QUEUED,
              ownershipLeaseExpiry: null,
              ownershipEpoch: { increment: 1 },
              progress: 0,
              startedAt: null,
              lastProgressUpdate: null,
            },
          });

          if (result.count > 0) {
            this.logger.warn(
              `Reclaiming job ${job.id} (${job.fileLabel}): lease expired for node ${job.nodeId}`
            );
            reclaimedCount++;
          } else {
            this.logger.debug(
              `Job ${job.id} lease reclaim skipped — epoch changed (renewal arrived or already reclaimed)`
            );
          }
        } catch (error) {
          this.logger.error(`Failed to reclaim job ${job.id}`, error);
        }
      }

      if (reclaimedCount > 0) {
        this.logger.warn(`Lease reclaim complete: reset ${reclaimedCount} job(s) to QUEUED`);
      }

      return reclaimedCount;
    } catch (error) {
      this.logger.error('Lease reclaim scan failed', error);
      return 0;
    }
  }
}
