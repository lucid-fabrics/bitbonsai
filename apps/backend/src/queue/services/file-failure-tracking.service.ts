import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { FileFailureRecordRepository } from '../../common/repositories/file-failure-record.repository';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileFailureRecordRepository: FileFailureRecordRepository
  ) {}

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
    return this.fileFailureRecordRepository.isBlacklisted(filePath, libraryId, contentFingerprint);
  }

  /**
   * Batch check which file paths are auto-blacklisted.
   * Returns a Set of blacklisted paths for efficient lookup.
   */
  async getBlacklistedPaths(filePaths: string[], libraryId: string): Promise<Set<string>> {
    return this.fileFailureRecordRepository.getBlacklistedPaths(filePaths, libraryId);
  }

  /**
   * Clear blacklist for a file (resets totalFailures and autoBlacklisted).
   * Called when user manually unblacklists a job.
   */
  async clearBlacklist(filePath: string, libraryId: string): Promise<void> {
    await this.fileFailureRecordRepository.clearBlacklist(filePath, libraryId);
    this.logger.log(`Cleared failure record for: ${filePath}`);
  }

  /**
   * Get failure count for a file.
   */
  async getFailureCount(filePath: string, libraryId: string): Promise<number> {
    return this.fileFailureRecordRepository.getFailureCount(filePath, libraryId);
  }

  /**
   * Record the codec that successfully encoded a file. Called on job
   * completion. Files that repeatedly need a GPU->CPU fallback build up a
   * failure record anyway (via recordFailure on each failed attempt); this
   * remembers the codec that finally worked so the next job for the same
   * file can route straight to it instead of re-learning it the hard way.
   *
   * Uses the same atomic upsert pattern as recordFailure - a fresh file with
   * no prior failure has no row yet, so this inserts one with totalFailures=0.
   */
  async recordSuccess(
    filePath: string,
    libraryId: string,
    codec: string,
    contentFingerprint?: string
  ): Promise<void> {
    const id = randomUUID();

    await this.prisma.$executeRaw`
      INSERT INTO file_failure_records ("id", "filePath", "libraryId", "totalFailures", "contentFingerprint", "autoBlacklisted", "lastSuccessfulCodec", "lastSuccessfulAt", "createdAt", "updatedAt")
      VALUES (${id}, ${filePath}, ${libraryId}, 0, ${contentFingerprint ?? null}, false, ${codec}, NOW(), NOW(), NOW())
      ON CONFLICT ("filePath", "libraryId")
      DO UPDATE SET
        "lastSuccessfulCodec" = ${codec},
        "lastSuccessfulAt" = NOW(),
        "contentFingerprint" = COALESCE(${contentFingerprint ?? null}, file_failure_records."contentFingerprint"),
        "updatedAt" = NOW()
    `;
  }

  /**
   * Get the last codec that successfully encoded this file, if known.
   */
  async getLastSuccessfulCodec(
    filePath: string,
    libraryId: string,
    contentFingerprint?: string
  ): Promise<string | null> {
    return this.fileFailureRecordRepository.getLastSuccessfulCodec(
      filePath,
      libraryId,
      contentFingerprint
    );
  }
}
