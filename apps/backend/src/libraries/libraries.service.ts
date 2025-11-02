import { opendir } from 'node:fs/promises';
import { normalize, resolve } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Library } from '@prisma/client';
import { JobStage } from '@prisma/client';
import { FileWatcherService } from '../file-watcher/file-watcher.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import type { CreateLibraryDto } from './dto/create-library.dto';
import type { LibraryFilesDto } from './dto/library-files.dto';
import type { LibraryStatsDto } from './dto/library-stats.dto';
import type { BulkJobCreationResultDto, ScanPreviewDto } from './dto/scan-preview.dto';
import type { UpdateLibraryDto } from './dto/update-library.dto';
import { MediaAnalysisService } from './services/media-analysis.service';

/**
 * LibrariesService
 *
 * Handles CRUD operations and business logic for media libraries.
 * Based on the Prisma integration example (lines 453-520).
 */
@Injectable()
export class LibrariesService {
  private readonly logger = new Logger(LibrariesService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => FileWatcherService))
    private fileWatcher: FileWatcherService,
    private mediaAnalysis: MediaAnalysisService,
    @Inject(forwardRef(() => QueueService))
    private queueService: QueueService
  ) {}

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
  private validateLibraryPath(path: string): string {
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
  private async *scanDirectoryStream(dirPath: string): AsyncGenerator<string> {
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
    } catch (error) {
      // Handle permission errors and other read errors gracefully
      this.logger.warn(`Failed to read directory: ${dirPath}`, error);
    }
  }

  /**
   * Create a new library
   *
   * SECURITY: Validates path against whitelist and prevents path traversal
   *
   * @param createLibraryDto - Library creation data
   * @returns The created library
   * @throws ConflictException if a library with the same path already exists on the node
   * @throws NotFoundException if the specified node does not exist
   * @throws BadRequestException if path validation fails
   */
  async create(createLibraryDto: CreateLibraryDto): Promise<Library> {
    this.logger.log(`Creating library: ${createLibraryDto.name}`);

    // SECURITY: Validate and sanitize path
    const sanitizedPath = this.validateLibraryPath(createLibraryDto.path);

    // Auto-assign to first available node if nodeId not provided
    let nodeId = createLibraryDto.nodeId;
    if (!nodeId) {
      const firstNode = await this.prisma.node.findFirst({
        orderBy: { createdAt: 'asc' },
      });

      if (!firstNode) {
        throw new NotFoundException(
          'No nodes available. Please register a node before creating libraries.'
        );
      }

      nodeId = firstNode.id;
      this.logger.log(`Auto-assigned library to node: ${firstNode.name}`);
    }

    // Check if node exists
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });

    if (!node) {
      throw new NotFoundException(`Node with ID "${nodeId}" not found`);
    }

    // Check for duplicate path on the same node (use sanitized path)
    const existingLibrary = await this.prisma.library.findUnique({
      where: {
        nodeId_path: {
          nodeId: nodeId,
          path: sanitizedPath,
        },
      },
    });

    if (existingLibrary) {
      throw new ConflictException(
        `Library with path "${sanitizedPath}" already exists on node "${node.name}"`
      );
    }

    try {
      const library = await this.prisma.library.create({
        data: {
          name: createLibraryDto.name,
          path: sanitizedPath, // SECURITY: Use sanitized path
          mediaType: createLibraryDto.mediaType,
          nodeId: nodeId,
        },
      });

      this.logger.log(`Library created: ${library.id}`);
      return library;
    } catch (error) {
      this.logger.error('Failed to create library', error);
      throw error;
    }
  }

  /**
   * Get all libraries
   *
   * @returns Array of all libraries
   */
  async findAll(): Promise<Library[]> {
    this.logger.log('Fetching all libraries');
    return this.prisma.library.findMany({
      include: {
        node: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
        defaultPolicy: {
          select: {
            id: true,
            name: true,
            targetCodec: true,
            preset: true,
          },
        },
        policies: {
          select: {
            id: true,
            name: true,
            preset: true,
          },
        },
        _count: {
          select: {
            jobs: true,
            policies: true,
          },
        },
      },
    });
  }

  /**
   * Get library by ID with detailed statistics
   *
   * @param id - Library unique identifier
   * @returns Library with node info, policies, and job count
   * @throws NotFoundException if library does not exist
   */
  async findOne(id: string): Promise<LibraryStatsDto> {
    this.logger.log(`Fetching library: ${id}`);

    const library = await this.prisma.library.findUnique({
      where: { id },
      include: {
        node: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
        defaultPolicy: {
          select: {
            id: true,
            name: true,
            targetCodec: true,
            preset: true,
          },
        },
        policies: {
          select: {
            id: true,
            name: true,
            preset: true,
          },
        },
        _count: {
          select: {
            jobs: true,
          },
        },
      },
    });

    if (!library) {
      throw new NotFoundException(`Library with ID "${id}" not found`);
    }

    return library as unknown as LibraryStatsDto;
  }

  /**
   * Update a library
   *
   * @param id - Library unique identifier
   * @param updateLibraryDto - Partial library data to update
   * @returns Updated library
   * @throws NotFoundException if library does not exist
   */
  async update(id: string, updateLibraryDto: UpdateLibraryDto): Promise<Library> {
    this.logger.log(`Updating library: ${id}`);

    // Check if library exists
    const existingLibrary = await this.prisma.library.findUnique({
      where: { id },
    });

    if (!existingLibrary) {
      throw new NotFoundException(`Library with ID "${id}" not found`);
    }

    try {
      // Handle file watcher toggle if watchEnabled is being changed
      if (
        updateLibraryDto.watchEnabled !== undefined &&
        updateLibraryDto.watchEnabled !== existingLibrary.watchEnabled
      ) {
        if (updateLibraryDto.watchEnabled) {
          await this.fileWatcher.enableWatcher(id);
        } else {
          await this.fileWatcher.disableWatcher(id);
        }
      }

      const library = await this.prisma.library.update({
        where: { id },
        data: updateLibraryDto,
        include: {
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
        },
      });

      this.logger.log(`Library updated: ${id}`);
      return library;
    } catch (error) {
      this.logger.error(`Failed to update library: ${id}`, error);
      throw error;
    }
  }

  /**
   * Delete a library
   *
   * @param id - Library unique identifier
   * @returns void
   * @throws NotFoundException if library does not exist
   */
  async remove(id: string): Promise<void> {
    this.logger.log(`Deleting library: ${id}`);

    // Check if library exists
    const existingLibrary = await this.prisma.library.findUnique({
      where: { id },
    });

    if (!existingLibrary) {
      throw new NotFoundException(`Library with ID "${id}" not found`);
    }

    try {
      // Stop file watcher if active
      if (existingLibrary.watchEnabled) {
        await this.fileWatcher.stopWatcher(id);
      }

      await this.prisma.library.delete({
        where: { id },
      });

      this.logger.log(`Library deleted: ${id}`);
    } catch (error) {
      this.logger.error(`Failed to delete library: ${id}`, error);
      throw error;
    }
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
    const existingLibrary = await this.prisma.library.findUnique({
      where: { id },
    });

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
      const library = await this.prisma.library.update({
        where: { id },
        data: {
          totalFiles,
          totalSizeBytes,
          lastScanAt: new Date(),
        },
        include: {
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
        },
      });

      this.logger.log(
        `Library scan completed: ${id} - Found ${totalFiles} files, ${totalSizeBytes} bytes`
      );
      return library;
    } catch (error) {
      this.logger.error(`Failed to scan library: ${id}`, error);
      throw error;
    }
  }

  /**
   * Process a video file and update stats
   * @private
   */
  private async processVideoFile(
    fileName: string,
    fullPath: string,
    videoExtensions: string[],
    stats: { totalFiles: number; totalSizeBytes: bigint },
    fs: typeof import('node:fs').promises
  ): Promise<void> {
    const lowerFileName = fileName.toLowerCase();

    // Skip temporary files (common patterns)
    const tempPatterns = ['.tmp', '.temp', '.part', '.download', '.crdownload', '.!ut'];
    if (tempPatterns.some((pattern) => lowerFileName.includes(pattern))) {
      return;
    }

    const ext = lowerFileName.slice(lowerFileName.lastIndexOf('.'));
    if (!videoExtensions.includes(ext)) {
      return;
    }

    try {
      const fileStats = await fs.stat(fullPath);
      stats.totalFiles++;
      stats.totalSizeBytes += BigInt(fileStats.size);
    } catch (statError) {
      this.logger.warn(`Failed to stat file: ${fullPath}`, statError);
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
        } catch (statError) {
          this.logger.warn(`Failed to stat file: ${filePath}`, statError);
        }
      })
    );
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

    const library = await this.prisma.library.findUnique({
      where: { id },
      include: {
        policies: true, // Get all policies associated with library
      },
    });

    if (!library) {
      throw new NotFoundException(`Library with ID "${id}" not found`);
    }

    if (!library.policies || library.policies.length === 0) {
      throw new BadRequestException(
        'Library has no encoding policy. Please assign a policy first.'
      );
    }

    // Use library's default policy, or first policy if no default is set
    const policy =
      library.policies.find((p) => p.id === library.defaultPolicyId) || library.policies[0];

    // Collect all video file paths using streaming scan
    const videoFiles: string[] = [];

    for await (const filePath of this.scanDirectoryStream(library.path)) {
      videoFiles.push(filePath);
    }

    this.logger.log(`Found ${videoFiles.length} video files, analyzing with FFprobe...`);

    // Analyze files using FFprobe (returns ALL files, no codec filtering)
    const analysis = await this.mediaAnalysis.analyzeFiles(videoFiles, policy.targetCodec);

    // Get ALL jobs for this library to annotate files with status
    const allJobs = await this.prisma.job.findMany({
      where: {
        libraryId: library.id,
      },
      select: {
        id: true,
        filePath: true,
        stage: true,
        progress: true,
        isBlacklisted: true,
      },
    });

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
    const annotateFile = (file: any) => {
      const job = jobMap.get(file.filePath);
      const fileName = file.filePath.split('/').pop() || file.filePath;

      if (!job) {
        // No job exists - can add to queue
        return {
          ...file,
          fileName,
          canAddToQueue: true,
          blockedReason: undefined,
          jobId: undefined,
          jobStage: undefined,
          jobProgress: undefined,
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
        jobProgress: job.progress,
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

    // Limit results to first 100 for performance (frontend can paginate if needed)
    const preview: ScanPreviewDto = {
      libraryId: library.id,
      libraryName: library.name,
      policyId: policy.id,
      policyName: policy.name,
      targetCodec: policy.targetCodec,
      availablePolicies: library.policies.map((p) => ({
        id: p.id,
        name: p.name,
        preset: p.preset,
      })),
      totalFiles: analysis.totalFiles - blacklistedPaths.size,
      totalSizeBytes: analysis.totalSizeBytes.toString(),
      needsEncodingCount: canAddCount, // Files that can be added to queue
      alreadyOptimizedCount: 0, // No longer used (kept for backward compatibility)
      needsEncoding: filteredFiles.slice(0, 100), // All files (limited to 100)
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
   *
   * Takes the scan preview and creates actual jobs for files that need encoding.
   * This is the "manual trigger" that gives users control.
   *
   * @param libraryId - Library unique identifier
   * @param policyId - Policy to use for encoding
   * @param filePaths - Optional: specific files to encode (if empty, encodes all that need it)
   * @returns Number of jobs created
   */
  async createJobsFromScan(
    libraryId: string,
    policyId?: string,
    filePaths?: string[]
  ): Promise<{ jobsCreated: number; jobs: any[] }> {
    this.logger.log(
      `Creating jobs for library: ${libraryId} with policy: ${policyId || 'default'}`
    );

    const library = await this.prisma.library.findUnique({
      where: { id: libraryId },
      include: { node: true, defaultPolicy: true },
    });

    if (!library) {
      throw new NotFoundException(`Library with ID "${libraryId}" not found`);
    }

    // Use provided policyId or fall back to library's default policy
    const effectivePolicyId = policyId || library.defaultPolicyId;

    if (!effectivePolicyId) {
      throw new BadRequestException(
        `No policy specified and library "${library.name}" has no default policy configured. ` +
          `Please either specify a policy ID or set a default policy for this library.`
      );
    }

    const policy = await this.prisma.policy.findUnique({
      where: { id: effectivePolicyId },
    });

    if (!policy) {
      throw new NotFoundException(`Policy with ID "${effectivePolicyId}" not found`);
    }

    // If no specific files provided, get all files that need encoding
    let filesToEncode: string[];

    if (!filePaths || filePaths.length === 0) {
      // Re-scan to get fresh list
      const preview = await this.scanPreview(libraryId);
      filesToEncode = preview.needsEncoding.map((f) => f.filePath);
    } else {
      filesToEncode = filePaths;
    }

    if (filesToEncode.length === 0) {
      this.logger.log('No files need encoding');
      return { jobsCreated: 0, jobs: [] };
    }

    // Get blacklisted file paths for this library to skip them
    const blacklistedJobs = await this.prisma.job.findMany({
      where: {
        libraryId: library.id,
        isBlacklisted: true,
      },
      select: {
        filePath: true,
      },
    });

    const blacklistedPaths = new Set(blacklistedJobs.map((job) => job.filePath));

    // Probe each file to get accurate codec info before creating job
    const jobs: any[] = [];

    for (const filePath of filesToEncode) {
      try {
        // Skip blacklisted files
        if (blacklistedPaths.has(filePath)) {
          this.logger.log(`Skipping blacklisted file: ${filePath}`);
          continue;
        }

        const videoInfo = await this.mediaAnalysis.probeVideoFile(filePath);

        if (!videoInfo) {
          this.logger.warn(`Skipping ${filePath} - failed to probe`);
          continue;
        }

        // Extract file label (filename without path)
        const fileLabel = filePath.split('/').pop() || filePath;

        // Create job using queue service
        const job = await this.queueService.create({
          filePath,
          fileLabel,
          sourceCodec: videoInfo.codec,
          targetCodec: policy.targetCodec,
          beforeSizeBytes: videoInfo.sizeBytes.toString(),
          nodeId: library.nodeId,
          libraryId: library.id,
          policyId: policy.id,
        });

        jobs.push(job);
      } catch (error) {
        this.logger.error(`Failed to create job for ${filePath}`, error);
      }
    }

    this.logger.log(`Created ${jobs.length} encoding jobs`);

    return { jobsCreated: jobs.length, jobs };
  }

  /**
   * Get all "ready to queue" files across all libraries
   *
   * Aggregates scan preview data from all libraries to show files that are ready
   * to be added to the queue but haven't been queued yet.
   *
   * @returns Aggregated scan preview data from all libraries
   */
  async getAllReadyFiles(): Promise<ScanPreviewDto[]> {
    this.logger.log('Fetching ready files from all libraries');

    // Get all enabled libraries with at least one policy
    const libraries = await this.prisma.library.findMany({
      where: {
        enabled: true,
      },
      include: {
        policies: true, // Get all policies to check if library has any
      },
    });

    // Filter libraries that have policies
    const librariesWithPolicies = libraries.filter((lib) => lib.policies.length > 0);

    if (librariesWithPolicies.length === 0) {
      this.logger.log('No libraries with policies found');
      return [];
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

    return successfulPreviews;
  }

  /**
   * Create jobs for all files in a library that need encoding
   *
   * This is the simplified "Add All Files" endpoint that:
   * 1. Scans the library directory for video files (fast - just file listing)
   * 2. For each file:
   *    - Skips if already in queue or completed
   *    - Quick codec check using FFprobe
   *    - Creates job if needs encoding
   *    - Skips corrupted files (logs them)
   * 3. Returns summary of jobs created and files skipped
   *
   * @param libraryId - Library unique identifier
   * @param policyId - Policy to use for encoding
   * @returns Summary of job creation results
   */
  async createAllJobs(libraryId: string, policyId: string): Promise<BulkJobCreationResultDto> {
    this.logger.log(
      `Creating jobs for all files in library: ${libraryId} with policy: ${policyId}`
    );

    const library = await this.prisma.library.findUnique({
      where: { id: libraryId },
      include: { node: true },
    });

    if (!library) {
      throw new NotFoundException(`Library with ID "${libraryId}" not found`);
    }

    const policy = await this.prisma.policy.findUnique({
      where: { id: policyId },
    });

    if (!policy) {
      throw new NotFoundException(`Policy with ID "${policyId}" not found`);
    }

    // Collect all video file paths using streaming scan
    const videoFiles: string[] = [];

    for await (const filePath of this.scanDirectoryStream(library.path)) {
      videoFiles.push(filePath);
    }

    this.logger.log(`Found ${videoFiles.length} video files, creating jobs...`);

    // Get existing jobs and blacklisted files
    const existingJobs = await this.prisma.job.findMany({
      where: {
        libraryId: library.id,
        OR: [
          {
            stage: {
              in: [
                JobStage.DETECTED,
                JobStage.HEALTH_CHECK,
                JobStage.QUEUED,
                JobStage.ENCODING,
                JobStage.VERIFYING,
                JobStage.COMPLETED,
              ],
            },
          },
          { isBlacklisted: true },
        ],
      },
      select: {
        filePath: true,
        isBlacklisted: true,
      },
    });

    const existingPaths = new Set(existingJobs.map((job) => job.filePath));
    const blacklistedPaths = new Set(
      existingJobs.filter((job) => job.isBlacklisted).map((job) => job.filePath)
    );

    const result: BulkJobCreationResultDto = {
      jobsCreated: 0,
      filesSkipped: 0,
      skippedFiles: [],
    };

    // Process each file
    for (const filePath of videoFiles) {
      try {
        // Skip if already in queue or blacklisted
        if (existingPaths.has(filePath)) {
          const reason = blacklistedPaths.has(filePath) ? 'Blacklisted' : 'Already in queue';
          result.filesSkipped++;
          result.skippedFiles.push({ path: filePath, reason });
          continue;
        }

        // Probe file to get codec info
        const videoInfo = await this.mediaAnalysis.probeVideoFile(filePath);

        if (!videoInfo) {
          result.filesSkipped++;
          result.skippedFiles.push({ path: filePath, reason: 'Failed to probe file' });
          continue;
        }

        // No codec filtering - allow re-encoding files already in target codec
        // This supports use cases like H.265 → H.265 with different quality/preset settings

        // Create job
        const fileLabel = filePath.split('/').pop() || filePath;

        await this.queueService.create({
          filePath,
          fileLabel,
          sourceCodec: videoInfo.codec,
          targetCodec: policy.targetCodec,
          beforeSizeBytes: videoInfo.sizeBytes.toString(),
          nodeId: library.nodeId,
          libraryId: library.id,
          policyId: policy.id,
        });

        result.jobsCreated++;
      } catch (error) {
        this.logger.error(`Failed to process file ${filePath}`, error);
        result.filesSkipped++;
        result.skippedFiles.push({
          path: filePath,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log(
      `Bulk job creation complete: ${result.jobsCreated} jobs created, ${result.filesSkipped} files skipped`
    );

    return result;
  }

  /**
   * Get all video files in a library with metadata
   *
   * Scans the library folder recursively and returns detailed information
   * about ALL video files found, not just ones that need encoding.
   *
   * @param libraryId - Library unique identifier
   * @returns Library files with metadata
   */
  async getLibraryFiles(libraryId: string): Promise<LibraryFilesDto> {
    this.logger.log(`Getting all files for library: ${libraryId}`);

    const library = await this.prisma.library.findUnique({
      where: { id: libraryId },
    });

    if (!library) {
      throw new NotFoundException(`Library with ID "${libraryId}" not found`);
    }

    // Collect all video file paths using streaming scan
    const videoFiles: string[] = [];

    for await (const filePath of this.scanDirectoryStream(library.path)) {
      videoFiles.push(filePath);
    }

    this.logger.log(`Found ${videoFiles.length} video files, analyzing with FFprobe...`);

    // Analyze files in batches to avoid overwhelming FFprobe
    const analyzedFiles: any[] = [];
    let totalSizeBytes = BigInt(0);
    const batchSize = 5; // Analyze 5 files at a time

    for (let i = 0; i < videoFiles.length; i += batchSize) {
      const batch = videoFiles.slice(i, i + batchSize);

      const results = await Promise.all(
        batch.map(async (filePath) => {
          try {
            const videoInfo = await this.mediaAnalysis.probeVideoFile(filePath);

            if (!videoInfo) {
              return null;
            }

            // Extract file name from path
            const fileName = filePath.split('/').pop() || filePath;

            totalSizeBytes += BigInt(videoInfo.sizeBytes);

            return {
              filePath: videoInfo.filePath,
              fileName,
              codec: videoInfo.codec,
              resolution: videoInfo.resolution,
              sizeBytes: videoInfo.sizeBytes,
              duration: videoInfo.duration,
              healthStatus: videoInfo.healthStatus,
              healthMessage: videoInfo.healthMessage,
            };
          } catch (error) {
            this.logger.error(`Failed to analyze file ${filePath}`, error);
            return null;
          }
        })
      );

      // Filter out null results (failed probes)
      analyzedFiles.push(...results.filter((file) => file !== null));
    }

    // Sort files by file name for better UX
    analyzedFiles.sort((a, b) => a.fileName.localeCompare(b.fileName));

    const result: LibraryFilesDto = {
      libraryId: library.id,
      libraryName: library.name,
      totalFiles: analyzedFiles.length,
      totalSizeBytes: totalSizeBytes.toString(),
      files: analyzedFiles,
      scannedAt: new Date(),
    };

    this.logger.log(
      `Retrieved ${result.totalFiles} files (${result.totalSizeBytes} bytes) for library ${library.name}`
    );

    return result;
  }
}
