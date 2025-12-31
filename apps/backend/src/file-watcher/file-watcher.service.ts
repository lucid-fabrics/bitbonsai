import { basename, extname } from 'node:path';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { FSWatcher } from 'chokidar';
import * as chokidar from 'chokidar';
import { PrismaService } from '../prisma/prisma.service';

interface WatcherInstance {
  watcher: FSWatcher;
  libraryId: string;
  path: string;
}

/**
 * FileWatcher Service
 *
 * Monitors library directories using inotify (via chokidar) and automatically
 * creates encoding jobs when new media files are detected.
 *
 * Features:
 * - Uses inotify on Linux for efficient file monitoring
 * - Debounces file additions (prevents duplicate jobs during copy operations)
 * - Filters by video file extensions
 * - Per-library enable/disable control
 * - Automatic watcher lifecycle management
 */
@Injectable()
export class FileWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FileWatcherService.name);
  private readonly watchers = new Map<string, WatcherInstance>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

  // Video file extensions to watch
  private readonly videoExtensions = new Set([
    '.mkv',
    '.mp4',
    '.avi',
    '.mov',
    '.wmv',
    '.flv',
    '.webm',
    '.m4v',
    '.mpg',
    '.mpeg',
    '.m2ts',
    '.ts',
  ]);

  // Debounce delay (wait for file to finish copying)
  private readonly debounceMs = 5000; // 5 seconds

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  /**
   * Initialize watchers on module startup
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing file watchers...');
    await this.initializeWatchers();
  }

  /**
   * Cleanup watchers on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Stopping all file watchers...');

    // Clear all pending debounce timers to prevent memory leak
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    await this.stopAllWatchers();
  }

  /**
   * Initialize watchers for all enabled libraries
   */
  private async initializeWatchers(): Promise<void> {
    try {
      const libraries = await this.prisma.library.findMany({
        where: {
          enabled: true,
          watchEnabled: true,
        },
        include: {
          node: true,
        },
      });

      for (const library of libraries) {
        await this.startWatcher(library.id, library.path);
      }

      this.logger.log(`Started ${libraries.length} file watcher(s)`);
    } catch (error) {
      this.logger.error('Failed to initialize watchers', error);
    }
  }

  /**
   * Start watching a library directory
   */
  async startWatcher(libraryId: string, path: string): Promise<void> {
    // Don't create duplicate watchers
    if (this.watchers.has(libraryId)) {
      this.logger.warn(`Watcher already exists for library ${libraryId}`);
      return;
    }

    try {
      const watcher = chokidar.watch(path, {
        ignored: /(^|[/\\])\../, // Ignore dotfiles
        persistent: true,
        ignoreInitial: true, // Don't trigger for existing files
        awaitWriteFinish: {
          stabilityThreshold: 2000, // Wait for file to stabilize
          pollInterval: 100,
        },
        depth: 99, // Watch subdirectories recursively
      });

      watcher.on('add', (filePath: string) => {
        this.handleFileAdded(libraryId, filePath);
      });

      watcher.on('error', (error: unknown) => {
        this.logger.error(`Watcher error for library ${libraryId}:`, error);
      });

      this.watchers.set(libraryId, { watcher, libraryId, path });
      this.logger.log(`Started watcher for library ${libraryId} at ${path}`);
    } catch (error) {
      this.logger.error(`Failed to start watcher for library ${libraryId}`, error);
      throw error;
    }
  }

  /**
   * Stop watching a library directory
   */
  async stopWatcher(libraryId: string): Promise<void> {
    const instance = this.watchers.get(libraryId);
    if (!instance) {
      this.logger.warn(`No watcher found for library ${libraryId}`);
      return;
    }

    try {
      await instance.watcher.close();
      this.watchers.delete(libraryId);
      this.logger.log(`Stopped watcher for library ${libraryId}`);
    } catch (error) {
      this.logger.error(`Failed to stop watcher for library ${libraryId}`, error);
      throw error;
    }
  }

  /**
   * Stop all watchers
   */
  private async stopAllWatchers(): Promise<void> {
    const promises = Array.from(this.watchers.keys()).map((libraryId) =>
      this.stopWatcher(libraryId)
    );
    await Promise.all(promises);
  }

  /**
   * Handle file added event
   */
  private handleFileAdded(libraryId: string, filePath: string): void {
    // Filter by video extension
    const ext = extname(filePath).toLowerCase();
    if (!this.videoExtensions.has(ext)) {
      this.logger.debug(`Ignoring non-video file: ${filePath}`);
      return;
    }

    // Debounce: Clear existing timer for this file
    const debounceKey = `${libraryId}:${filePath}`;
    const existingTimer = this.debounceTimers.get(debounceKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      // CRITICAL #1 FIX: Delete from Map to prevent unbounded growth
      this.debounceTimers.delete(debounceKey);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(debounceKey);
      this.createJobForFile(libraryId, filePath);
    }, this.debounceMs);

    this.debounceTimers.set(debounceKey, timer);
    this.logger.debug(`Debouncing file: ${filePath} (${this.debounceMs}ms)`);
  }

  /**
   * Create encoding job for detected file
   */
  private async createJobForFile(libraryId: string, filePath: string): Promise<void> {
    try {
      this.logger.log(`New video file detected: ${filePath}`);

      // Emit event for job creation (handled by queue service)
      this.eventEmitter.emit('file.detected', {
        libraryId,
        filePath,
        fileName: basename(filePath),
      });

      this.logger.log(`Job creation event emitted for ${filePath}`);
    } catch (error) {
      this.logger.error(`Failed to create job for file ${filePath}`, error);
    }
  }

  /**
   * Enable watcher for a library
   */
  async enableWatcher(libraryId: string): Promise<void> {
    const library = await this.prisma.library.findUnique({
      where: { id: libraryId },
    });

    if (!library) {
      throw new Error(`Library ${libraryId} not found`);
    }

    if (!library.enabled) {
      throw new Error(`Library ${libraryId} is disabled`);
    }

    // Update database
    await this.prisma.library.update({
      where: { id: libraryId },
      data: { watchEnabled: true },
    });

    // Start watcher
    await this.startWatcher(libraryId, library.path);
  }

  /**
   * Disable watcher for a library
   */
  async disableWatcher(libraryId: string): Promise<void> {
    // Update database
    await this.prisma.library.update({
      where: { id: libraryId },
      data: { watchEnabled: false },
    });

    // Stop watcher
    await this.stopWatcher(libraryId);
  }

  /**
   * Get watcher status
   */
  getWatcherStatus(libraryId: string): { active: boolean; path?: string } {
    const instance = this.watchers.get(libraryId);
    return {
      active: !!instance,
      path: instance?.path,
    };
  }

  /**
   * Get all active watchers
   */
  getAllWatcherStatuses(): Array<{ libraryId: string; path: string; active: boolean }> {
    return Array.from(this.watchers.values()).map((instance) => ({
      libraryId: instance.libraryId,
      path: instance.path,
      active: true,
    }));
  }
}
