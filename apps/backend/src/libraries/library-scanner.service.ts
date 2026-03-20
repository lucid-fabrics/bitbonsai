import { opendir } from 'node:fs/promises';
import { normalize } from 'node:path';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Job, Library, Policy } from '@prisma/client';
import { JobRepository } from '../common/repositories/job.repository';
import { LibraryRepository } from '../common/repositories/library.repository';
import {
  FileHealthStatus,
  MediaAnalysisService,
  type VideoCodecInfo,
} from '../media/media-analysis.service';
import { SettingsService } from '../settings/settings.service';
import type { CacheMetadataDto } from './dto/cache-metadata.dto';
import type { LibraryFilesDto } from './dto/library-files.dto';
import type { BulkJobCreationResultDto, ScanPreviewDto } from './dto/scan-preview.dto';
import { LibraryBulkJobService } from './library-bulk-job.service';

/**
 * Internal types for library file analysis
 */
interface AnalyzedFileInfo {
  filePath: string;
  fileName: string;
  codec: string;
  resolution: string;
  sizeBytes: number;
  duration: number;
  healthStatus: FileHealthStatus;
  healthMessage: string;
  canAddToQueue: boolean;
  blockedReason?: string;
  jobId?: string;
  jobStage?: string;
  jobProgress?: number;
}

/**
 * LibraryScannerService
 *
 * Handles all scanning, preview, job-creation, and ready-files cache logic
 * for media libraries. Extracted from LibrariesService to keep concerns separate.
 */
@Injectable()
export class LibraryScannerService {
  private readonly logger = new Logger(LibraryScannerService.name);

  // Cache for getAllReadyFiles() with configurable TTL
  private readyFilesCache: {
    data: ScanPreviewDto[] | null;
    timestamp: number;
  } = {
    data: null,
    timestamp: 0,
  };

  /**
   * SECURITY: Whitelist of allowed base directories for libraries
   * Prevents access to sensitive system directories
   */
  private readonly ALLOWED_BASE_PATHS = [
    '/mnt/user', // Unraid media paths
    '/mnt/cache', // Unraid cache
    '/media', // Standard media mount
    '/downloads', // Downloads folder
    '/data', // Data folder
    '/home', // User home directories (Linux)
    '/Users', // User home directories (macOS)
  ];

  /**
   * Batch size for processing files from directory scan
   * Prevents memory overload with large libraries (100K+ files)
   */
  private readonly SCAN_BATCH_SIZE = 100;

  /**
   * Supported video file extensions
   */
  private readonly VIDEO_EXTENSIONS = [
    '.mp4',
    '.mkv',
    '.avi',
    '.mov',
    '.wmv',
    '.flv',
    '.webm',
    '.m4v',
    '.mpg',
    '.mpeg',
    '.m2ts',
  ];

  /**
   * Temporary file patterns to skip during scanning
   */
  private readonly TEMP_FILE_PATTERNS = [
    '.tmp',
    '.temp',
    '.part',
    '.download',
    '.crdownload',
    '.!ut',
  ];

  constructor(
    private mediaAnalysis: MediaAnalysisService,
    private settingsService: SettingsService,
    private readonly libraryRepository: LibraryRepository,
    private readonly jobRepository: JobRepository,
    @Inject(forwardRef(() => LibraryBulkJobService))
    private readonly libraryBulkJob: LibraryBulkJobService
  ) {}

  /**
   * SECURITY: Validate and sanitize library path
   * Prevents path traversal attacks by:
   * - Normalizing path (removes .. and redundant slashes)
   * - Checking against allowed base paths
   * - Ensuring no escape from allowed directories
   *
   * @param path - User-provided path
   * @returns Sanitized absolute path
   * @throws BadRequestException if path is invalid or not allowed
   */
  validateLibraryPath(path: string): string {
    // Normalize path (removes .., //, etc.)
    const normalizedPath = normalize(path);

    // Ensure it's an absolute path
    if (!normalizedPath.startsWith('/')) {
      throw new BadRequestException('Library path must be an absolute path');
    }

    // Check if path contains path traversal sequences (after normalization)
    if (normalizedPath.includes('..')) {
      throw new BadRequestException('Path traversal sequences (..) are not allowed');
    }

    // Verify path starts with an allowed base directory
    const isAllowed = this.ALLOWED_BASE_PATHS.some((basePath) =>
      normalizedPath.startsWith(basePath)
    );

    if (!isAllowed) {
      throw new BadRequestException(
        `Library path must start with one of the allowed base directories: ${this.ALLOWED_BASE_PATHS.join(', ')}`
      );
    }

    return normalizedPath;
  }

  /**
   * Check if a file is a video file based on extension
   * @private
   */
  private isVideoFile(fileName: string): boolean {
    const lowerFileName = fileName.toLowerCase();

    // Skip temporary files
    if (this.TEMP_FILE_PATTERNS.some((pattern) => lowerFileName.includes(pattern))) {
      return false;
    }

    const ext = lowerFileName.slice(lowerFileName.lastIndexOf('.'));
    return this.VIDEO_EXTENSIONS.includes(ext);
  }

  /**
   * Streaming directory scanner using async generator
   * Prevents OOM by yielding one file at a time instead of loading all into memory
   *
   * @param dirPath - Directory path to scan
   * @returns AsyncGenerator yielding video file paths one at a time
   * @private
   */
  async *scanDirectoryStream(dirPath: string): AsyncGenerator<string> {
    try {
      const dir = await opendir(dirPath);

      for await (const entry of dir) {
        const { join } = await import('node:path');
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recursively scan subdirectories (generator composition)
          yield* this.scanDirectoryStream(fullPath);
        } else if (entry.isFile() && this.isVideoFile(entry.name)) {
          yield fullPath;
        }
      }
    } catch (error: unknown) {
      // Handle permission errors and other read errors gracefully
      this.logger.warn(`Failed to read directory: ${dirPath}`, error);
    }
  }

  /**
   * Process a batch of file paths and update stats
   * @private
   */
  private async processBatch(
    batch: string[],
    stats: { totalFiles: number; totalSizeBytes: bigint },
    fs: typeof import('node:fs').promises
  ): Promise<void> {
    // Process files in parallel within the batch for better performance
    await Promise.all(
      batch.map(async (filePath) => {
        try {
          const fileStats = await fs.stat(filePath);
          stats.totalFiles++;
          stats.totalSizeBytes += BigInt(fileStats.size);
        } catch (statError: unknown) {
          this.logger.warn(`Failed to stat file: ${filePath}`, statError);
        }
      })
    );
  }

  /**
   * Trigger a library scan to discover video files
   *
   * Scans the library path recursively to find all video files,
   * counts them, calculates total size, and updates the database.
   *
   * @param id - Library unique identifier
   * @returns Updated library with scan results
   * @throws NotFoundException if library does not exist
   */
  async scan(id: string): Promise<Library> {
    this.logger.log(`Scanning library: ${id}`);

    // Check if library exists
    const existingLibrary = await this.libraryRepository.findByWhere({ id });

    if (!existingLibrary) {
      throw new NotFoundException(`Library with ID "${id}" not found`);
    }

    try {
      const { promises: fs } = await import('node:fs');

      const stats = { totalFiles: 0, totalSizeBytes: BigInt(0) };

      // Process files in batches to prevent memory overload
      const batch: string[] = [];

      for await (const filePath of this.scanDirectoryStream(existingLibrary.path)) {
        batch.push(filePath);

        // Process batch when it reaches the threshold
        if (batch.length >= this.SCAN_BATCH_SIZE) {
          await this.processBatch(batch, stats, fs);
          batch.length = 0; // Clear batch
        }
      }

      // Process remaining files in the last batch
      if (batch.length > 0) {
        await this.processBatch(batch, stats, fs);
      }

      const { totalFiles, totalSizeBytes } = stats;

      // Update library with scan results
      const library = await this.libraryRepository.updateWithInclude(
        { id },
        { totalFiles, totalSizeBytes, lastScanAt: new Date() },
        {
          node: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
          _count: {
            select: {
              jobs: true,
              policies: true,
            },
          },
        }
      );

      this.logger.log(
        `Library scan completed: ${id} - Found ${totalFiles} files, ${totalSizeBytes} bytes`
      );
      return library;
    } catch (error: unknown) {
      this.logger.error(`Failed to scan library: ${id}`, error);
      throw error;
    }
  }

  /**
   * Scan library and preview what files need encoding (WITHOUT creating jobs)
   *
   * This provides an intuitive preview showing:
   * - Files that need encoding (e.g., H.264 → HEVC)
   * - Files already optimized (no action needed)
   * - Potential space savings
   *
   * @param id - Library unique identifier
   * @returns Preview of what will be encoded
   * @throws NotFoundException if library does not exist or has no policy
   */
  async scanPreview(id: string): Promise<ScanPreviewDto> {
    this.logger.log(`Generating scan preview for library: ${id}`);

    const library = (await this.libraryRepository.findUniqueWithInclude(
      { id },
      { defaultPolicy: true }
    )) as (Library & { defaultPolicy: Policy | null }) | null;

    if (!library) {
      throw new NotFoundException(`Library with ID "${id}" not found`);
    }

    if (!library.defaultPolicy) {
      throw new BadRequestException(
        'Library has no encoding policy. Please assign a policy first.'
      );
    }

    // Use library's default policy
    const policy = library.defaultPolicy;

    // Collect all video file paths using streaming scan
    const videoFiles: string[] = [];

    for await (const filePath of this.scanDirectoryStream(library.path)) {
      videoFiles.push(filePath);
    }

    this.logger.log(`Found ${videoFiles.length} video files, analyzing with FFprobe...`);

    // Analyze files using FFprobe (returns ALL files, no codec filtering)
    const analysis = await this.mediaAnalysis.analyzeFiles(videoFiles, policy.targetCodec);

    // Get ALL jobs for this library to annotate files with status
    const allJobs = await this.jobRepository.findManySelect<{
      id: string;
      filePath: string;
      stage: string;
      progress: number | null;
      isBlacklisted: boolean;
    }>(
      { libraryId: library.id },
      { id: true, filePath: true, stage: true, progress: true, isBlacklisted: true }
    );

    // Create a map of filePath -> job info
    const jobMap = new Map(
      allJobs.map((job) => [
        job.filePath,
        {
          id: job.id,
          stage: job.stage,
          progress: job.progress,
          isBlacklisted: job.isBlacklisted,
        },
      ])
    );

    // Helper function to annotate file with job status
    const annotateFile = (file: VideoCodecInfo): AnalyzedFileInfo => {
      const job = jobMap.get(file.filePath);
      const fileName = file.filePath.split('/').pop() || file.filePath;

      if (!job) {
        // No job exists - can add to queue
        return {
          filePath: file.filePath,
          fileName,
          codec: file.codec,
          resolution: file.resolution,
          sizeBytes: file.sizeBytes,
          duration: file.duration,
          healthStatus: file.healthStatus,
          healthMessage: file.healthMessage,
          canAddToQueue: true,
        };
      }

      // Job exists - check if can be added
      const activeStages = [
        'DETECTED',
        'HEALTH_CHECK',
        'QUEUED',
        'ENCODING',
        'VERIFYING',
        'COMPLETED',
      ];
      const canAdd = !activeStages.includes(job.stage);

      const stageLabels: Record<string, string> = {
        DETECTED: 'Detected, awaiting health check',
        HEALTH_CHECK: 'Health checking',
        QUEUED: 'Queued for encoding',
        ENCODING: 'Currently encoding',
        VERIFYING: 'Verifying encoded file',
        COMPLETED: 'Already encoded',
        FAILED: 'Previous job failed - can retry',
        CANCELLED: 'Previously cancelled - can retry',
      };

      return {
        ...file,
        fileName,
        jobId: job.id,
        jobStage: job.stage,
        jobProgress: job.progress ?? undefined,
        canAddToQueue: canAdd,
        blockedReason: !canAdd ? stageLabels[job.stage] : undefined,
      };
    };

    // Annotate ALL files with job status (all files are in needsEncoding array now)
    const annotatedFiles = analysis.needsEncoding.map(annotateFile);

    // Filter out blacklisted files only (show all others with status)
    const blacklistedPaths = new Set(allJobs.filter((j) => j.isBlacklisted).map((j) => j.filePath));

    const filteredFiles = annotatedFiles.filter((file) => !blacklistedPaths.has(file.filePath));

    // Count how many can actually be added to queue
    const canAddCount = filteredFiles.filter((f) => f.canAddToQueue).length;

    // Return all files (no artificial limit - frontend can handle filtering/pagination)
    const preview: ScanPreviewDto = {
      libraryId: library.id,
      libraryName: library.name,
      policyId: policy.id,
      policyName: policy.name,
      targetCodec: policy.targetCodec,
      availablePolicies: library.defaultPolicy
        ? [
            {
              id: library.defaultPolicy.id,
              name: library.defaultPolicy.name,
              preset: library.defaultPolicy.preset,
            },
          ]
        : [],
      totalFiles: analysis.totalFiles - blacklistedPaths.size,
      totalSizeBytes: analysis.totalSizeBytes.toString(),
      needsEncodingCount: canAddCount, // Files that can be added to queue
      alreadyOptimizedCount: 0, // No longer used (kept for backward compatibility)
      needsEncoding: filteredFiles, // All files (including those already encoded for visibility)
      alreadyOptimized: [], // No longer used (kept for backward compatibility)
      errors: analysis.errors,
      scannedAt: new Date(),
    };

    this.logger.log(
      `Scan preview complete: ${preview.totalFiles} total files, ${preview.needsEncodingCount} can be added to queue`
    );

    return preview;
  }

  /**
   * Create encoding jobs from scan preview results
   * Delegates to LibraryBulkJobService
   */
  async createJobsFromScan(
    libraryId: string,
    policyId?: string,
    filePaths?: string[]
  ): Promise<{ jobsCreated: number; jobs: Job[] }> {
    const result = await this.libraryBulkJob.createJobsFromScan(libraryId, policyId, filePaths);

    // Invalidate ready files cache since jobs were just created
    if (result.jobsCreated > 0) {
      this.invalidateReadyFilesCache();
    }

    return result;
  }

  /**
   * Invalidate the ready files cache
   * Called when jobs are created or library data changes
   * Made public so it can be called from the controller
   */
  invalidateReadyFilesCache(): void {
    this.readyFilesCache.data = null;
    this.readyFilesCache.timestamp = 0;
    this.logger.log('Ready files cache invalidated');
  }

  /**
   * Get cache metadata information
   * Returns cache age, TTL, and validity status
   */
  async getCacheMetadata(): Promise<CacheMetadataDto> {
    const now = Date.now();

    // Get TTL from settings
    const { readyFilesCacheTtlMinutes } = await this.settingsService.getReadyFilesCacheTtl();
    const cacheTtlMs = readyFilesCacheTtlMinutes * 60 * 1000;

    // If cache has never been populated (timestamp = 0), return 0 age
    if (this.readyFilesCache.timestamp === 0) {
      return {
        cacheAgeSeconds: 0,
        cacheTtlMinutes: readyFilesCacheTtlMinutes,
        cacheValid: false,
        cacheTimestamp: null,
      };
    }

    const cacheAge = now - this.readyFilesCache.timestamp;
    const cacheAgeSeconds = Math.floor(cacheAge / 1000);
    const cacheValid = this.readyFilesCache.data !== null && cacheAge < cacheTtlMs;

    return {
      cacheAgeSeconds,
      cacheTtlMinutes: readyFilesCacheTtlMinutes,
      cacheValid,
      cacheTimestamp: new Date(this.readyFilesCache.timestamp),
    };
  }

  /**
   * Get all "ready to queue" files across all libraries
   *
   * Aggregates scan preview data from all libraries to show files that are ready
   * to be added to the queue but haven't been queued yet.
   *
   * **Performance Optimization**: Results are cached to avoid
   * expensive file system scans and FFprobe analysis on every request.
   * Cache TTL is configurable via settings (default: 5 minutes).
   *
   * @returns Aggregated scan preview data from all libraries
   */
  async getAllReadyFiles(): Promise<ScanPreviewDto[]> {
    // Get TTL from settings
    const { readyFilesCacheTtlMinutes } = await this.settingsService.getReadyFilesCacheTtl();
    const cacheTtlMs = readyFilesCacheTtlMinutes * 60 * 1000;

    // Check if cache is still valid (within TTL)
    const now = Date.now();
    const cacheAge = now - this.readyFilesCache.timestamp;

    if (this.readyFilesCache.data && cacheAge < cacheTtlMs) {
      this.logger.log(
        `Returning cached ready files (age: ${Math.round(cacheAge / 1000)}s, TTL: ${readyFilesCacheTtlMinutes}m)`
      );
      return this.readyFilesCache.data;
    }

    this.logger.log('Cache miss or expired - fetching ready files from all libraries');

    // Get all enabled libraries with at least one policy
    const libraries = await this.libraryRepository.findAllLibraries(
      { enabled: true },
      { defaultPolicy: true }
    );

    // Filter libraries that have a default policy
    const librariesWithPolicies = (libraries as (Library & { defaultPolicy: unknown })[]).filter(
      (lib) => lib.defaultPolicy !== null
    );

    if (librariesWithPolicies.length === 0) {
      this.logger.log('No libraries with policies found');
      const emptyResult: ScanPreviewDto[] = [];
      // Cache the empty result too
      this.readyFilesCache.data = emptyResult;
      this.readyFilesCache.timestamp = now;
      return emptyResult;
    }

    // Get scan preview for each library (in parallel for performance)
    const previews = await Promise.allSettled(
      librariesWithPolicies.map((library) => this.scanPreview(library.id))
    );

    // Extract successful previews and log failures
    const successfulPreviews: ScanPreviewDto[] = [];
    previews.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successfulPreviews.push(result.value);
      } else {
        const libraryName = librariesWithPolicies[index].name;
        this.logger.warn(
          `Failed to get scan preview for library "${libraryName}": ${result.reason}`
        );
      }
    });

    this.logger.log(
      `Fetched ${successfulPreviews.length} library previews with ${successfulPreviews.reduce((sum, p) => sum + p.needsEncodingCount, 0)} total ready files`
    );

    // Update cache
    this.readyFilesCache.data = successfulPreviews;
    this.readyFilesCache.timestamp = now;

    return successfulPreviews;
  }

  /**
   * Cron job that automatically refreshes the ready files cache every 5 minutes.
   * This ensures the cache is always warm when users open the "Add Files to Queue" modal,
   * providing instant results instead of making them wait 30+ seconds.
   *
   * Runs every 5 minutes at the start of the minute (e.g., 10:00, 10:05, 10:10)
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async autoRefreshReadyFilesCache(): Promise<void> {
    try {
      this.logger.log('Running scheduled cache refresh for ready files');
      const startTime = Date.now();

      // Call getAllReadyFiles() which will refresh the cache
      const previews = await this.getAllReadyFiles();

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      const totalFiles = previews.reduce((sum, p) => sum + p.needsEncodingCount, 0);

      this.logger.log(
        `Scheduled cache refresh completed in ${duration}s - ` +
          `${previews.length} libraries, ${totalFiles} ready files`
      );
    } catch (error: unknown) {
      this.logger.error('Failed to refresh ready files cache via cron job', error);
    }
  }

  /**
   * Create jobs for all files in a library that need encoding
   * Delegates to LibraryBulkJobService
   */
  async createAllJobs(libraryId: string, policyId: string): Promise<BulkJobCreationResultDto> {
    return this.libraryBulkJob.createAllJobs(libraryId, policyId);
  }

  /**
   * Get all video files in a library with metadata
   * Delegates to LibraryBulkJobService
   */
  async getLibraryFiles(libraryId: string): Promise<LibraryFilesDto> {
    return this.libraryBulkJob.getLibraryFiles(libraryId);
  }
}
