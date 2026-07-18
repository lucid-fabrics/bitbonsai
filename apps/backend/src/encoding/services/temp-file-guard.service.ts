import { promises as fs } from 'node:fs';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NodeConfigService } from '../../core/services/node-config.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * TempFileGuardService
 *
 * Tracks in-progress temp files in the database so they survive backend restarts.
 * On startup, finds all uncleaned rows and attempts to delete the leftover files.
 *
 * This replaces the glob-based cleanup in FfmpegService.cleanupOrphanedTempFiles()
 * which only scanned /tmp and missed custom paths.
 */
@Injectable()
export class TempFileGuardService implements OnModuleInit {
  private readonly logger = new Logger(TempFileGuardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nodeConfig: NodeConfigService
  ) {}

  async onModuleInit(): Promise<void> {
    await this.cleanupStaleTempFiles();
  }

  /**
   * Register a temp file in the database so it can be cleaned up on restart.
   * No-ops if an uncleaned row for the same (jobId, tempPath) already exists (resume case).
   */
  async registerTempFile(jobId: string, tempPath: string, nodeId: string): Promise<void> {
    try {
      const existing = await this.prisma.jobTempFile.findFirst({
        where: { jobId, tempPath, cleanedAt: null },
        select: { id: true },
      });
      if (!existing) {
        await this.prisma.jobTempFile.create({
          data: { jobId, tempPath, nodeId },
        });
      }
    } catch (error) {
      // P2003 = foreign key constraint failed: jobId doesn't exist. Expected
      // (not warning-worthy) for callers that intentionally encode without a
      // persisted Job row, e.g. the nightly self-test corpus - crash-recovery
      // just doesn't apply to that temp file, which is fine for a short-lived
      // scratch encode. Anything else (DB connectivity, etc.) still warns.
      const isMissingJob =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
      const log = isMissingJob ? this.logger.debug.bind(this.logger) : this.logger.warn.bind(this.logger);
      log(
        `[${jobId}] Failed to register temp file (${tempPath}): ${(error as Error).message ?? error}`
      );
    }
  }

  /**
   * Mark a temp file as cleaned (sets cleanedAt = now).
   * Called when the file was successfully deleted or renamed to the final output.
   */
  async markCleaned(tempPath: string): Promise<void> {
    try {
      await this.prisma.jobTempFile.updateMany({
        where: { tempPath, cleanedAt: null },
        data: { cleanedAt: new Date() },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to mark temp file as cleaned (${tempPath}): ${(error as Error).message ?? error}`
      );
    }
  }

  /**
   * Delete all uncleaned temp files for a job and mark them cleaned.
   * Called on encoding failure so leftover partial files are removed.
   *
   * Skips the job's repairedSourcePath (if set): a remux-repaired copy is a
   * durable input the job still needs on its next retry, not a disposable
   * per-attempt scratch file - a failure elsewhere in this same encode
   * attempt (e.g. the main output temp) must not delete it out from under
   * the job.
   */
  async cleanupJobTempFiles(jobId: string): Promise<void> {
    let rows: { id: string; tempPath: string }[] = [];
    try {
      rows = await this.prisma.jobTempFile.findMany({
        where: { jobId, cleanedAt: null },
        select: { id: true, tempPath: true },
      });
    } catch (error) {
      this.logger.warn(
        `[${jobId}] Failed to query temp files for cleanup: ${(error as Error).message ?? error}`
      );
      return;
    }

    if (rows.length === 0) return;

    const protectedPath = await this.getRepairedSourcePath(jobId);

    for (const row of rows) {
      if (protectedPath && row.tempPath === protectedPath) continue;
      await this.unlinkAndMark(row.id, row.tempPath, jobId);
    }
  }

  /**
   * Find all uncleaned temp file rows for this node and attempt to delete them.
   * Filtered by nodeId to avoid cleaning up files owned by sibling nodes during
   * a rolling restart where they may still be actively writing.
   * Best-effort: logs errors but never throws.
   * Called on module init to clean up files left over from a force-kill.
   */
  async cleanupStaleTempFiles(): Promise<void> {
    const nodeId = this.nodeConfig.getNodeId();
    if (!nodeId) {
      this.logger.warn(
        'Node ID not available - skipping stale temp file cleanup to avoid cross-node interference'
      );
      return;
    }

    let rows: { id: string; tempPath: string; jobId: string }[] = [];
    try {
      rows = await this.prisma.jobTempFile.findMany({
        where: { cleanedAt: null, nodeId },
        select: { id: true, tempPath: true, jobId: true },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to query stale temp files on startup: ${(error as Error).message ?? error}`
      );
      return;
    }

    if (rows.length === 0) {
      this.logger.log('No stale temp files found in database');
      return;
    }

    // A job still waiting to be picked up after a restart (e.g. QUEUED with a
    // remux-repaired source) has a temp file that looks "stale" by uncleaned-
    // row age alone but is still needed - never sweep it.
    const jobIds = [...new Set(rows.map((r) => r.jobId))];
    const protectedPaths = await this.getRepairedSourcePaths(jobIds);

    this.logger.log(`Found ${rows.length} stale temp file(s), cleaning up...`);
    let removed = 0;
    let preserved = 0;

    for (const row of rows) {
      if (protectedPaths.has(row.tempPath)) {
        preserved++;
        continue;
      }
      const deleted = await this.unlinkAndMark(row.id, row.tempPath, row.jobId);
      if (deleted) removed++;
    }

    this.logger.log(
      `Cleaned up ${removed}/${rows.length} stale temp file(s)` +
        (preserved ? ` (${preserved} repaired-source copies preserved)` : '')
    );
  }

  private async getRepairedSourcePath(jobId: string): Promise<string | null> {
    try {
      const job = await this.prisma.job.findUnique({
        where: { id: jobId },
        select: { repairedSourcePath: true },
      });
      return job?.repairedSourcePath ?? null;
    } catch {
      return null;
    }
  }

  private async getRepairedSourcePaths(jobIds: string[]): Promise<Set<string>> {
    try {
      const jobs = await this.prisma.job.findMany({
        where: { id: { in: jobIds }, repairedSourcePath: { not: null } },
        select: { repairedSourcePath: true },
      });
      return new Set(jobs.map((j) => j.repairedSourcePath as string));
    } catch {
      return new Set();
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async unlinkAndMark(id: string, tempPath: string, jobId: string): Promise<boolean> {
    // Validate path to prevent arbitrary file deletion if DB row is tampered with
    const ALLOWED_PREFIXES = ['/tmp/', '/var/tmp/', '/mnt/', '/media/', '/nfs/', '/data/'];
    if (!ALLOWED_PREFIXES.some((p) => tempPath.startsWith(p))) {
      this.logger.error(
        `[${jobId}] Rejecting suspicious temp path (not in allowed dirs): ${tempPath}`
      );
      return false;
    }

    try {
      await fs.unlink(tempPath);
      this.logger.debug(`[${jobId}] Deleted temp file: ${tempPath}`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.warn(
          `[${jobId}] Failed to delete temp file ${tempPath}: ${(error as NodeJS.ErrnoException).message ?? error}`
        );
      }
      // File already gone - still mark cleaned so we don't retry
    }

    try {
      await this.prisma.jobTempFile.update({
        where: { id },
        data: { cleanedAt: new Date() },
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `[${jobId}] Failed to mark temp file cleaned (id=${id}): ${(error as Error).message ?? error}`
      );
      return false;
    }
  }
}
