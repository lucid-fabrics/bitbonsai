import * as fs from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../common/repositories/job.repository';
import { LibrariesService } from '../libraries/libraries.service';
import { QueueService } from '../queue/queue.service';
import { EncodingFileService } from './encoding-file.service';
import { FfmpegService } from './ffmpeg.service';

/**
 * EncodingStartupService
 *
 * Handles startup recovery logic for the encoding system:
 * - Volume mount probing before auto-heal
 * - Orphaned job recovery after backend crashes/reboots
 */
@Injectable()
export class EncodingStartupService {
  private readonly logger = new Logger(EncodingStartupService.name);

  private readonly VOLUME_MOUNT_PROBE_DELAY_MS = 1000; // 1 second
  private readonly VOLUME_MOUNT_MAX_RETRIES = 10;

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly queueService: QueueService,
    private readonly librariesService: LibrariesService,
    private readonly ffmpegService: FfmpegService,
    private readonly encodingFileService: EncodingFileService
  ) {}

  /**
   * Wait for Docker volume mounts to be fully accessible
   * Probes the media directory to ensure volume is ready before auto-heal
   */
  async waitForVolumeMounts(): Promise<void> {
    // UX PHILOSOPHY: Derive media paths from libraries in database
    // Eliminates need for MEDIA_PATHS env var - single source of truth
    const mediaPaths = await this.librariesService.getAllLibraryPaths();
    if (mediaPaths.length === 0) {
      this.logger.warn('No libraries configured, skipping volume mount check');
      return;
    }

    for (let attempt = 1; attempt <= this.VOLUME_MOUNT_MAX_RETRIES; attempt++) {
      try {
        // Test ALL media paths - if ANY exist, volumes are ready
        for (const testPath of mediaPaths) {
          if (fs.existsSync(testPath)) {
            this.logger.log(
              `✅ Volume mount ready: ${testPath} (attempt ${attempt}/${this.VOLUME_MOUNT_MAX_RETRIES})`
            );
            return;
          }
        }
      } catch {
        // Ignore errors, will retry
      }

      if (attempt < this.VOLUME_MOUNT_MAX_RETRIES) {
        this.logger.debug(
          `⏳ Waiting for volume mounts... (attempt ${attempt}/${this.VOLUME_MOUNT_MAX_RETRIES})`
        );
        await new Promise((resolve) => setTimeout(resolve, this.VOLUME_MOUNT_PROBE_DELAY_MS));
      }
    }

    this.logger.warn(
      `⚠️  Volume mounts not detected after ${this.VOLUME_MOUNT_MAX_RETRIES} attempts - proceeding anyway`
    );
  }

  /**
   * Auto-heal orphaned jobs that were left in active states
   * from backend crashes, reboots, or container restarts
   *
   * Strategy:
   * - On startup, ALL jobs in active processing states are orphaned (no active processes)
   * - Reset them ALL to QUEUED so they can be retried immediately
   * - Files that passed HEALTH_CHECK once don't need re-validation after restart
   * - This ensures clean recovery from any type of restart
   *
   * CRITICAL FIX: Reset ALL orphaned jobs to QUEUED (not DETECTED)
   * - HEALTH_CHECK jobs already passed validation, no need to re-validate
   * - ENCODING, VERIFYING, PAUSED jobs obviously need to restart
   * - getNextJob() only fetches QUEUED jobs, so DETECTED jobs would be stuck
   *
   * @param nodeId - Only heal jobs belonging to this node (prevents cross-node interference)
   */
  async autoHealOrphanedJobs(nodeId: string): Promise<void> {
    this.logger.log(`🏥 Auto-heal: Checking for orphaned jobs on this node (${nodeId})...`);

    try {
      // CRITICAL FIX #2: Check for jobs with recent heartbeats (< 2min old)
      // These jobs are still being actively processed by other nodes and should NOT be healed
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

      // DEEP AUDIT FIX: Auto-heal claim staleness threshold reduced to 2 minutes
      // If another node claimed a job but didn't complete healing within 2 minutes, it's stale
      // (matches heartbeat check interval for consistency)
      const twoMinutesAgoForClaim = new Date(Date.now() - 2 * 60 * 1000);

      // On backend startup, jobs in active processing states need recovery
      // CRITICAL FIX: Only process jobs belonging to THIS node to prevent cross-node interference
      // Without this filter, CHILD node restart would reset MAIN node's actively encoding jobs
      // DEEP AUDIT P2: Added atomic claim pattern to prevent multi-node heal race
      const orphanedJobs = await this.jobRepository.findManyWithInclude<{
        id: string;
        fileLabel: string;
        stage: JobStage;
        progress: number;
        updatedAt: Date;
        tempFilePath: string | null;
        retryCount: number;
        error: string | null;
      }>({
        where: {
          nodeId, // CRITICAL: Only this node's jobs
          AND: [
            // DEEP AUDIT P2: Exclude jobs already claimed for healing by another node
            // Unless the claim is stale (> 10 minutes old)
            {
              OR: [
                { autoHealClaimedAt: null }, // Not claimed
                { autoHealClaimedBy: nodeId }, // Claimed by us (retry)
                { autoHealClaimedAt: { lt: twoMinutesAgoForClaim } }, // Stale claim
              ],
            },
            // HIGH #2 FIX: Exclude legitimately new jobs (startedAt null) from auto-heal
            // Only heal jobs that were started but have stale heartbeat
            {
              startedAt: { not: null }, // Must have been started
            },
            // CRITICAL FIX #2: Exclude jobs with recent heartbeats
            {
              OR: [
                { lastHeartbeat: null }, // Started but no heartbeat = orphaned
                { lastHeartbeat: { lt: twoMinutesAgo } }, // Stale heartbeat = orphaned
              ],
            },
            // Job stage conditions
            {
              OR: [
                // Active processing stages - always recover
                {
                  stage: {
                    in: [
                      JobStage.HEALTH_CHECK,
                      JobStage.ENCODING,
                      JobStage.VERIFYING,
                      JobStage.PAUSED_LOAD, // System load-based pause - recover
                    ],
                  },
                },
                // PAUSED jobs - only recover if paused by schedule (has specific error message)
                {
                  stage: JobStage.PAUSED,
                  error: { contains: 'Outside scheduled encoding window' },
                },
              ],
            },
          ],
        },
        select: {
          id: true,
          fileLabel: true,
          stage: true,
          progress: true,
          updatedAt: true,
          tempFilePath: true, // TRUE RESUME: needed to check if temp file exists
          retryCount: true, // AUTO-HEAL TRACKING: needed to increment retry count
          error: true, // Needed to check pause reason
        },
      });

      // Also log manually paused jobs that are being preserved (only for this node)
      const manuallyPausedJobs = await this.jobRepository.findManyWithInclude<{
        id: string;
        fileLabel: string;
      }>({
        where: {
          nodeId, // Only this node's jobs
          stage: JobStage.PAUSED,
          OR: [
            { error: null },
            { error: { not: { contains: 'Outside scheduled encoding window' } } },
          ],
        },
        select: { id: true, fileLabel: true },
      });
      if (manuallyPausedJobs.length > 0) {
        this.logger.log(
          `ℹ️ Preserving ${manuallyPausedJobs.length} manually paused job(s) on this node - will NOT auto-resume`
        );
      }

      if (orphanedJobs.length === 0) {
        this.logger.log('✅ No orphaned jobs found on this node - system is healthy');
        return;
      }

      this.logger.warn(
        `🔧 Found ${orphanedJobs.length} orphaned job(s) on this node from backend restart - recovering...`
      );

      // Reset each orphaned job to QUEUED
      // CRITICAL FIX: ALL jobs go to QUEUED (not DETECTED) to resume immediately
      // TRUE RESUME: Keep progress and resume state (DON'T reset to 0%)
      for (const job of orphanedJobs) {
        try {
          // DEEP AUDIT P2: Atomic claim - try to claim job for healing
          // This prevents race condition where multiple nodes try to heal same job
          const claimResult = await this.jobRepository.atomicUpdateMany(
            {
              id: job.id,
              OR: [
                { autoHealClaimedAt: null },
                { autoHealClaimedBy: nodeId },
                { autoHealClaimedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) } },
              ],
            },
            {
              autoHealClaimedAt: new Date(),
              autoHealClaimedBy: nodeId,
            }
          );

          if (claimResult.count === 0) {
            this.logger.debug(`  ⏭️ Job ${job.id} already claimed by another node, skipping`);
            continue; // Another node claimed this job
          }

          // TRUE RESUME: Check if temp file still exists (with retry logic)
          const tempFileExists = await this.encodingFileService.checkTempFileWithRetry(
            job.tempFilePath
          );

          // Log temp file check result for debugging
          if (job.tempFilePath) {
            this.logger.log(`  Checking temp file: ${job.tempFilePath}`);
            this.logger.log(`  File exists: ${tempFileExists}`);
          }

          const errorMessage =
            job.stage === JobStage.PAUSED
              ? 'Paused job reset after backend restart - will resume from last position'
              : tempFileExists
                ? `Auto-heal: Successfully resumed from ${job.progress.toFixed(1)}% (was ${job.stage} before restart)`
                : `Auto-heal attempted but temp file was lost during restart - restarting from 0% (was ${job.stage} at ${job.progress.toFixed(1)}%)`;

          // CRITICAL BUG FIX: Recalculate resumeTimestamp based on current progress
          // The old resumeTimestamp is STALE (from when job first started encoding)
          // We need to calculate the CORRECT timestamp for the current progress percentage
          let recalculatedResumeTimestamp: string | null = null;
          if (tempFileExists && job.progress > 0) {
            try {
              // LOW #15 FIX: Use outer query job data instead of redundant inner query
              // The job object already has filePath from the outer findMany query
              const videoJob = await this.jobRepository.findUniqueSelect<{ filePath: string }>(
                { id: job.id },
                { filePath: true }
              );

              const filePath = videoJob?.filePath;
              if (filePath) {
                // Get video duration
                const videoDuration = await this.ffmpegService.getVideoDuration(filePath);

                // Calculate resume time in seconds based on current progress
                const resumeSeconds = (job.progress / 100) * videoDuration;

                // Convert to HH:MM:SS.MS format
                recalculatedResumeTimestamp =
                  this.ffmpegService.formatSecondsToTimestamp(resumeSeconds);

                this.logger.log(
                  `  🔄 Recalculated resumeTimestamp for job ${job.fileLabel}: progress=${job.progress.toFixed(1)}%, videoDuration=${videoDuration.toFixed(2)}s, resumeSeconds=${resumeSeconds.toFixed(2)}s, resumeTimestamp=${recalculatedResumeTimestamp}`
                );
              }
            } catch (error: unknown) {
              this.logger.warn(
                `  ⚠️  Failed to recalculate resumeTimestamp for job ${job.id}: ${error instanceof Error ? error.message : String(error)}`
              );
              // Continue with existing resumeTimestamp (better than nothing)
            }
          }

          // MULTI-NODE: Use QueueService proxy to support LINKED nodes
          await this.queueService.update(job.id, {
            stage: JobStage.QUEUED, // CRITICAL FIX: Always QUEUED, never DETECTED
            // TRUE RESUME: DON'T reset progress if temp file exists
            ...(tempFileExists ? {} : { progress: 0 }),
            etaSeconds: null,
            error: errorMessage,
            startedAt: null, // Clear startedAt to allow fresh start
            // AUTO-HEAL TRACKING: ONLY set when temp file exists (successful resume)
            // Green dot indicator should only show when auto-heal actually worked
            ...(tempFileExists
              ? {
                  autoHealedAt: new Date(),
                  autoHealedProgress: job.progress,
                }
              : {}),
            retryCount: job.retryCount + 1,
            // TRUE RESUME: Clear resume state if temp file doesn't exist, otherwise update with recalculated timestamp
            ...(tempFileExists
              ? { resumeTimestamp: recalculatedResumeTimestamp }
              : {
                  tempFilePath: null,
                  resumeTimestamp: null,
                }),
            // DEEP AUDIT P2: Clear the claim after successful healing
            autoHealClaimedAt: null,
            autoHealClaimedBy: null,
          });

          this.logger.log(
            `  ✓ Reset orphaned job: ${job.fileLabel} (${job.stage} → QUEUED, ${tempFileExists ? `will resume from ${job.progress.toFixed(1)}%` : 'restarting from 0%'})`
          );
        } catch (error: unknown) {
          this.logger.error(`  ✗ Failed to reset job ${job.id}:`, error);
        }
      }

      this.logger.log(`✅ Auto-heal complete - recovered ${orphanedJobs.length} job(s)`);
    } catch (error: unknown) {
      this.logger.error('Auto-heal failed:', error);
    }
  }
}
