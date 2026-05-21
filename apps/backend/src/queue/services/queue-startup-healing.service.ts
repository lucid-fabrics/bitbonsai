import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { NodeConfigService } from '../../core/services/node-config.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * QueueStartupHealingService
 *
 * Runs on module init to:
 * 1. Reset orphaned ENCODING/VERIFYING jobs owned by this node back to QUEUED.
 * 2. Heal jobs with missing/mismatched policies (MAIN node only).
 */
@Injectable()
export class QueueStartupHealingService implements OnModuleInit {
  private readonly logger = new Logger(QueueStartupHealingService.name);

  constructor(
    private prisma: PrismaService,
    private readonly jobRepository: JobRepository,
    private nodeConfig: NodeConfigService
  ) {}

  async onModuleInit(): Promise<void> {
    await this.resetOrphanedEncodingJobs();

    if (this.nodeConfig.getMainApiUrl()) {
      this.logger.debug('POLICY HEAL: Skipping startup scan (LINKED node)');
      return;
    }

    this.logger.log('POLICY HEAL: Starting orphaned job scan...');

    try {
      await this.healOrphanedJobs();
    } catch (error: unknown) {
      this.logger.error('POLICY HEAL: Failed to complete startup scan', error);
    }
  }

  /**
   * On startup, reset any ENCODING/VERIFYING jobs owned by this node to QUEUED.
   * Since the process just started, no FFmpeg is running — these jobs are definitively orphaned.
   *
   * Uses a fencing token to prevent a race with JobCleanupService, which also resets
   * stuck jobs on startup. The token is written first so JobCleanupService skips jobs
   * we already own, then cleared after the reset is complete.
   */
  private async resetOrphanedEncodingJobs(): Promise<void> {
    const nodeId = this.nodeConfig.getNodeId();
    if (!nodeId) return;

    const bootToken = `${process.pid}:${Date.now()}`;

    try {
      // Clear stale fencing tokens from prior crashes of this node.
      // PIDs can be reused across boots, so we match by nodeId rather than token value.
      // This must run before we stamp the new bootToken so those jobs become eligible again.
      await this.prisma.job.updateMany({
        where: {
          nodeId,
          fencingToken: { not: null },
          stage: { in: [JobStage.ENCODING, JobStage.VERIFYING] },
        },
        data: { fencingToken: null },
      });

      // Claim orphaned jobs for this node by stamping a fencing token.
      // Only jobs with no existing token are eligible — this prevents double-reset
      // with JobCleanupService which guards on fencingToken: null.
      await this.prisma.job.updateMany({
        where: {
          nodeId,
          stage: { in: [JobStage.ENCODING, JobStage.VERIFYING] },
          fencingToken: null,
        },
        data: { fencingToken: bootToken },
      });

      // Fetch only the jobs we successfully claimed.
      const claimedJobs = await this.prisma.job.findMany({
        where: { fencingToken: bootToken },
        select: { id: true },
      });

      if (claimedJobs.length === 0) {
        return;
      }

      // Reset each claimed job and clear the fencing token atomically.
      let resetCount = 0;
      for (const job of claimedJobs) {
        try {
          await this.prisma.job.update({
            where: { id: job.id },
            data: {
              stage: JobStage.QUEUED,
              progress: 0,
              startedAt: null,
              lastProgressUpdate: null,
              fencingToken: null,
              totalAttempts: { increment: 1 },
            },
          });
          resetCount++;
        } catch (updateError) {
          this.logger.error(`Startup orphan reset failed for job ${job.id}`, updateError);
          // Best-effort: clear the token so cleanup services can pick it up later.
          await this.prisma.job
            .update({
              where: { id: job.id },
              data: { fencingToken: null },
            })
            .catch(() => undefined);
        }
      }

      this.logger.warn(
        `Startup: reset ${resetCount} orphaned ENCODING/VERIFYING job(s) on node ${nodeId} → QUEUED`
      );
    } catch (error) {
      this.logger.error('Startup orphan reset failed', error);
    }
  }

  /**
   * SELF-HEALING: Find and fix all jobs with orphaned or mismatched policies
   */
  private async healOrphanedJobs(): Promise<void> {
    // PrismaService retained for atomic $transaction — not replaceable with repository
    const allPolicies = await this.prisma.policy.findMany();
    const policyMap = new Map(allPolicies.map((p) => [p.id, p]));

    if (allPolicies.length === 0) {
      this.logger.warn('POLICY HEAL: No policies exist - cannot heal orphaned jobs');
      return;
    }

    type JobWithLibraryPolicies = {
      id: string;
      policyId: string | null;
      targetCodec: string;
      library: {
        nodeId: string;
        defaultPolicy: { id: string; targetCodec: string; name: string } | null;
        policies: { id: string; targetCodec: string; name: string }[];
      } | null;
    };
    const jobsToCheck = await this.jobRepository.findManyWithInclude<JobWithLibraryPolicies>({
      where: {
        stage: {
          in: [JobStage.QUEUED, JobStage.DETECTED, JobStage.PAUSED_LOAD],
        },
      },
      include: {
        library: {
          include: {
            defaultPolicy: true,
            policies: true,
          },
        },
      },
    });

    let healedCount = 0;
    let errorCount = 0;

    for (const job of jobsToCheck) {
      try {
        const currentPolicy = job.policyId ? policyMap.get(job.policyId) : null;

        if (currentPolicy && job.targetCodec === currentPolicy.targetCodec) {
          continue;
        }

        if (currentPolicy && job.targetCodec !== currentPolicy.targetCodec) {
          await this.jobRepository.updateById(job.id, {
            targetCodec: currentPolicy.targetCodec,
          });
          this.logger.log(
            `POLICY HEAL: Fixed codec mismatch for job ${job.id} (${job.targetCodec} → ${currentPolicy.targetCodec})`
          );
          healedCount++;
          continue;
        }

        let newPolicy = null;

        if (job.library?.defaultPolicy && policyMap.has(job.library.defaultPolicy.id)) {
          newPolicy = job.library.defaultPolicy;
        } else if (job.library?.policies?.length) {
          newPolicy = job.library.policies.find((p) => policyMap.has(p.id));
        }
        if (!newPolicy) {
          newPolicy = allPolicies[0];
        }

        if (!newPolicy || !newPolicy.id) {
          this.logger.error(
            `POLICY HEAL FAILED: No valid policy found for job ${job.id}. ` +
              `Tried: library default, library policies, first available. ` +
              `Please create at least one policy and assign to library.`
          );
          errorCount++;
          continue;
        }

        await this.jobRepository.updateById(job.id, {
          policyId: newPolicy.id,
          targetCodec: newPolicy.targetCodec,
        });
        this.logger.log(
          `POLICY HEAL: Assigned policy "${newPolicy.name}" to orphaned job ${job.id}`
        );
        healedCount++;
      } catch (error: unknown) {
        this.logger.error(`POLICY HEAL: Failed to heal job ${job.id}`, error);
        errorCount++;
      }
    }

    if (healedCount > 0 || errorCount > 0) {
      this.logger.log(
        `POLICY HEAL: Startup scan complete - healed: ${healedCount}, errors: ${errorCount}`
      );
    } else {
      this.logger.debug('POLICY HEAL: No orphaned jobs found');
    }
  }
}
