import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LibraryRepository } from '../common/repositories/library.repository';

/**
 * BackupCleanupWorker
 *
 * LOW PRIORITY FIX #17: Background service that cleans up orphaned .backup files
 *
 * Purpose:
 * When atomic file replacement fails midway, .backup files may be left behind.
 * This worker automatically removes old backup files to prevent disk clutter.
 *
 * Cleanup Strategy:
 * 1. Scans all library paths for .backup files
 * 2. Removes files older than 24 hours (configurable)
 * 3. Logs all cleanup actions for audit trail
 * 4. Runs every hour (configurable)
 *
 * Safety:
 * - Only deletes files with .backup extension
 * - Skips files younger than retention period
 * - Continues on individual file errors
 * - Full error logging for diagnostics
 *
 * Configuration:
 * - BACKUP_CLEANUP_INTERVAL_MS: How often to run cleanup (default: 1 hour)
 * - BACKUP_RETENTION_HOURS: How old before deletion (default: 24 hours)
 */
@Injectable()
export class BackupCleanupWorker implements OnModuleInit {
  private readonly logger = new Logger(BackupCleanupWorker.name);
  private isRunning = false;
  // AUDIT #2 ISSUE #25 FIX: Store loop promise for graceful shutdown
  private loopPromise?: Promise<void>;

  // Configuration
  private readonly INTERVAL_MS = parseInt(
    process.env.BACKUP_CLEANUP_INTERVAL_MS || `${60 * 60 * 1000}`,
    10
  ); // 1 hour
  private readonly RETENTION_HOURS = parseInt(process.env.BACKUP_RETENTION_HOURS || '24', 10);

  constructor(private readonly libraryRepository: LibraryRepository) {}

  /**
   * Start the cleanup worker when module initializes
   */
  async onModuleInit(): Promise<void> {
    this.logger.log(
      `Starting BackupCleanupWorker (interval: ${this.INTERVAL_MS / 1000 / 60}min, retention: ${this.RETENTION_HOURS}h)`
    );
    this.start();
  }

  /**
   * Start the worker loop
   */
  private start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    // AUDIT #2 ISSUE #25 FIX: Store loop promise for graceful shutdown
    this.loopPromise = this.runWorkerLoop();
  }

  /**
   * Main worker loop
   */
  private async runWorkerLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.cleanupOrphanedBackups();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Backup cleanup worker error: ${errorMessage}`);
      }

      // Wait before next iteration
      await this.sleep(this.INTERVAL_MS);
    }
  }

  /**
   * Find and cleanup orphaned backup files across all libraries
   */
  private async cleanupOrphanedBackups(): Promise<void> {
    const now = Date.now();
    const retentionMs = this.RETENTION_HOURS * 60 * 60 * 1000;
    const cutoffTime = now - retentionMs;

    // Get all library paths
    const libraries = await this.libraryRepository.findAllLibraries({ enabled: true });

    if (libraries.length === 0) {
      this.logger.debug('No enabled libraries found, skipping backup cleanup');
      return;
    }

    let totalCleaned = 0;
    let totalSizeFreed = 0;

    for (const library of libraries) {
      try {
        const { cleaned, sizeFreed } = await this.cleanupBackupsInPath(
          library.path,
          cutoffTime,
          library.name
        );
        totalCleaned += cleaned;
        totalSizeFreed += sizeFreed;
      } catch (error: unknown) {
        this.logger.warn(`Failed to cleanup backups in library "${library.name}": ${error}`);
      }
    }

    if (totalCleaned > 0) {
      const sizeMB = (totalSizeFreed / 1024 / 1024).toFixed(2);
      this.logger.log(
        `✅ Cleanup complete: Removed ${totalCleaned} orphaned backup file(s), freed ${sizeMB} MB`
      );
    } else {
      this.logger.debug('No orphaned backup files found');
    }
  }

  /**
   * Recursively cleanup backup files in a directory
   *
   * @param dirPath - Directory to scan
   * @param cutoffTime - Unix timestamp before which files should be deleted
   * @param libraryName - Library name for logging
   * @returns Object with cleaned count and size freed
   */
  private async cleanupBackupsInPath(
    dirPath: string,
    cutoffTime: number,
    libraryName: string
  ): Promise<{ cleaned: number; sizeFreed: number }> {
    let cleaned = 0;
    let sizeFreed = 0;

    // Verify directory exists
    if (!existsSync(dirPath)) {
      this.logger.warn(`Library path does not exist: ${dirPath}`);
      return { cleaned, sizeFreed };
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          const result = await this.cleanupBackupsInPath(fullPath, cutoffTime, libraryName);
          cleaned += result.cleaned;
          sizeFreed += result.sizeFreed;
        } else if (entry.isFile() && entry.name.endsWith('.backup')) {
          // Found a backup file, check age
          try {
            const stats = await fs.stat(fullPath);
            const fileAge = Date.now() - stats.mtimeMs;

            if (stats.mtimeMs < cutoffTime) {
              // File is older than retention period, delete it
              const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
              await fs.unlink(fullPath);

              this.logger.log(
                `🗑️  Removed old backup: ${entry.name} (${fileSizeMB} MB, age: ${Math.floor(fileAge / 1000 / 60 / 60)}h) from "${libraryName}"`
              );

              cleaned++;
              sizeFreed += stats.size;
            } else {
              this.logger.debug(
                `Skipping recent backup: ${entry.name} (age: ${Math.floor(fileAge / 1000 / 60)}min)`
              );
            }
          } catch (error: unknown) {
            this.logger.warn(`Failed to cleanup backup file ${fullPath}: ${error}`);
          }
        }
      }
    } catch (error: unknown) {
      // Don't fail the entire cleanup if one directory fails
      this.logger.warn(`Failed to read directory ${dirPath}: ${error}`);
    }

    return { cleaned, sizeFreed };
  }

  /**
   * Helper: Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Stop the worker (for cleanup)
   * AUDIT #2 ISSUE #25 FIX: Made async to await loop completion
   */
  async stop(): Promise<void> {
    this.logger.log('Stopping BackupCleanupWorker');
    this.isRunning = false;

    // AUDIT #2 ISSUE #25 FIX: Wait for loop to actually exit
    if (this.loopPromise) {
      await this.loopPromise;
      this.logger.log('BackupCleanupWorker loop exited gracefully');
    }
  }
}
