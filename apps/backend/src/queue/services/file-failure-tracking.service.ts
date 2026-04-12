import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * FileFailureTrackingService
 *
 * Tracks file failures across jobs to detect files that fail repeatedly.
 * Inspired by Unmanic's permanent blacklisting approach.
 *
 * When a file fails across multiple jobs (e.g., job fails 3 times → FAILED,
 * next scan creates fresh job → fails again), this service remembers the
 * cumulative failure count and auto-blacklists at a threshold.
 *
 * AUTO_BLACKLIST_THRESHOLD = 5 total failures across all jobs for a file.
 */
@Injectable()
export class FileFailureTrackingService {
  private readonly logger = new Logger(FileFailureTrackingService.name);

  private readonly AUTO_BLACKLIST_THRESHOLD = 5;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a failure for a file path. Called when a job is marked FAILED.
   * Returns true if the file was auto-blacklisted (threshold reached).
   *
   * Uses raw SQL INSERT ON CONFLICT for atomic increment to prevent
   * race conditions when concurrent workers fail the same file.
   */
  async recordFailure(
    filePath: string,
    libraryId: string,
    error?: string,
    contentFingerprint?: string
  ): Promise<boolean> {
    const id = randomUUID();
    const threshold = this.AUTO_BLACKLIST_THRESHOLD;

    // Atomic upsert with auto-blacklist in single query
    const records = await this.prisma.$queryRaw<
      Array<{ id: string; totalFailures: number; autoBlacklisted: boolean }>
    >`
      INSERT INTO file_failure_records ("id", "filePath", "libraryId", "totalFailures", "lastFailedAt", "lastError", "contentFingerprint", "autoBlacklisted", "createdAt", "updatedAt")
      VALUES (${id}, ${filePath}, ${libraryId}, 1, NOW(), ${error ?? null}, ${contentFingerprint ?? null}, false, NOW(), NOW())
      ON CONFLICT ("filePath", "libraryId")
      DO UPDATE SET
        "totalFailures" = file_failure_records."totalFailures" + 1,
        "lastFailedAt" = NOW(),
        "lastError" = COALESCE(${error ?? null}, file_failure_records."lastError"),
        "contentFingerprint" = COALESCE(${contentFingerprint ?? null}, file_failure_records."contentFingerprint"),
        "autoBlacklisted" = CASE
          WHEN file_failure_records."totalFailures" + 1 >= ${threshold} THEN true
          ELSE file_failure_records."autoBlacklisted"
        END,
        "updatedAt" = NOW()
      RETURNING id, "totalFailures", "autoBlacklisted"
    `;

    const record = records[0];
    if (!record) return false;

    if (record.autoBlacklisted && record.totalFailures >= threshold) {
      this.logger.warn(`Auto-blacklisted file after ${record.totalFailures} failures: ${filePath}`);
      return true;
    }

    return false;
  }

  /**
   * Check if a file is auto-blacklisted (by path or content fingerprint).
   */
  async isBlacklisted(
    filePath: string,
    libraryId: string,
    contentFingerprint?: string
  ): Promise<boolean> {
    const orConditions: Record<string, unknown>[] = [{ filePath, libraryId }];

    if (contentFingerprint) {
      orConditions.push({ contentFingerprint });
    }

    const match = await this.prisma.fileFailureRecord.findFirst({
      where: {
        autoBlacklisted: true,
        OR: orConditions,
      },
      select: { id: true },
    });

    return !!match;
  }

  /**
   * Batch check which file paths are auto-blacklisted.
   * Returns a Set of blacklisted paths for efficient lookup.
   */
  async getBlacklistedPaths(filePaths: string[], libraryId: string): Promise<Set<string>> {
    if (filePaths.length === 0) return new Set();

    const records = await this.prisma.fileFailureRecord.findMany({
      where: {
        libraryId,
        autoBlacklisted: true,
        filePath: { in: filePaths },
      },
      select: { filePath: true },
    });

    return new Set(records.map((r) => r.filePath));
  }

  /**
   * Clear blacklist for a file (resets totalFailures and autoBlacklisted).
   * Called when user manually unblacklists a job.
   */
  async clearBlacklist(filePath: string, libraryId: string): Promise<void> {
    await this.prisma.fileFailureRecord.updateMany({
      where: {
        filePath,
        libraryId,
      },
      data: {
        totalFailures: 0,
        autoBlacklisted: false,
      },
    });

    this.logger.log(`Cleared failure record for: ${filePath}`);
  }

  /**
   * Get failure count for a file.
   */
  async getFailureCount(filePath: string, libraryId: string): Promise<number> {
    const record = await this.prisma.fileFailureRecord.findUnique({
      where: {
        filePath_libraryId: { filePath, libraryId },
      },
      select: { totalFailures: true },
    });

    return record?.totalFailures ?? 0;
  }
}
