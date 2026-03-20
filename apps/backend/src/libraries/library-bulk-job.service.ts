import { opendir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Job, Library, Node, Policy } from '@prisma/client';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../common/repositories/job.repository';
import { LibraryRepository } from '../common/repositories/library.repository';
import { PolicyRepository } from '../common/repositories/policy.repository';
import { DistributionOrchestratorService } from '../distribution/services/distribution-orchestrator.service';
import { FileHealthStatus, MediaAnalysisService } from '../media/media-analysis.service';
import { QueueService } from '../queue/queue.service';
import { FileFailureTrackingService } from '../queue/services/file-failure-tracking.service';
import type { LibraryFilesDto } from './dto/library-files.dto';
import type { BulkJobCreationResultDto } from './dto/scan-preview.dto';

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
 * LibraryBulkJobService
 *
 * Handles bulk job creation and file listing for media libraries.
 * Extracted from LibraryScannerService to keep concerns separate.
 */
@Injectable()
export class LibraryBulkJobService {
  private readonly logger = new Logger(LibraryBulkJobService.name);

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
    @Inject(forwardRef(() => QueueService))
    private queueService: QueueService,
    @Inject(forwardRef(() => DistributionOrchestratorService))
    private distributionOrchestrator: DistributionOrchestratorService,
    private fileFailureTracking: FileFailureTrackingService,
    private readonly libraryRepository: LibraryRepository,
    private readonly jobRepository: JobRepository,
    private readonly policyRepository: PolicyRepository
  ) {}

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
   */
  async *scanDirectoryStream(dirPath: string): AsyncGenerator<string> {
    try {
      const dir = await opendir(dirPath);

      for await (const entry of dir) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          yield* this.scanDirectoryStream(fullPath);
        } else if (entry.isFile() && this.isVideoFile(entry.name)) {
          yield fullPath;
        }
      }
    } catch (error: unknown) {
      this.logger.warn(`Failed to read directory: ${dirPath}`, error);
    }
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
  ): Promise<{ jobsCreated: number; jobs: Job[] }> {
    this.logger.log(
      `Creating jobs for library: ${libraryId} with policy: ${policyId || 'default'}`
    );

    const library = (await this.libraryRepository.findUniqueWithInclude(
      { id: libraryId },
      { node: true, defaultPolicy: true }
    )) as (Library & { node: Node | null; defaultPolicy: Policy | null }) | null;

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

    const policy = await this.policyRepository.findById(effectivePolicyId);

    if (!policy) {
      throw new NotFoundException(`Policy with ID "${effectivePolicyId}" not found`);
    }

    // If no specific files provided, get all files that need encoding
    let filesToEncode: string[];

    if (!filePaths || filePaths.length === 0) {
      // Re-scan to get fresh list
      const videoFiles: string[] = [];
      for await (const filePath of this.scanDirectoryStream(library.path)) {
        videoFiles.push(filePath);
      }
      filesToEncode = videoFiles;
    } else {
      filesToEncode = filePaths;
    }

    if (filesToEncode.length === 0) {
      this.logger.log('No files need encoding');
      return { jobsCreated: 0, jobs: [] };
    }

    // Get blacklisted file paths for this library to skip them
    const blacklistedJobs = await this.jobRepository.findManySelect<{ filePath: string }>(
      { libraryId: library.id, isBlacklisted: true },
      { filePath: true }
    );

    const blacklistedPaths = new Set(blacklistedJobs.map((job) => job.filePath));

    // Cross-job failure tracking: batch check auto-blacklisted files
    const autoBlacklistedPaths = await this.fileFailureTracking.getBlacklistedPaths(
      filesToEncode,
      library.id
    );

    // PERFORMANCE OPTIMIZATION: Parallelize job creation with batching
    // Process 100 files at a time to avoid overwhelming the database
    const jobs: Job[] = [];
    const batchSize = 100;

    for (let i = 0; i < filesToEncode.length; i += batchSize) {
      const batch = filesToEncode.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(async (filePath) => {
          // Skip auto-blacklisted files (cross-job failure tracking)
          if (autoBlacklistedPaths.has(filePath)) {
            this.logger.debug(`Skipping auto-blacklisted file: ${filePath}`);
            return null;
          }

          // Skip blacklisted files
          if (blacklistedPaths.has(filePath)) {
            this.logger.log(`Skipping blacklisted file: ${filePath}`);
            return null;
          }

          const videoInfo = await this.mediaAnalysis.probeVideoFile(filePath);

          if (!videoInfo) {
            this.logger.warn(`Skipping ${filePath} - failed to probe`);
            return null;
          }

          // Extract file label (filename without path)
          const fileLabel = filePath.split('/').pop() || filePath;

          // Find the best node for this job (distributes across available nodes)
          const targetNodeId = await this.distributionOrchestrator.findBestNodeForNewJob(
            library.nodeId
          );

          // Create job using queue service
          return await this.queueService.create({
            filePath,
            fileLabel,
            sourceCodec: videoInfo.codec,
            targetCodec: policy.targetCodec,
            beforeSizeBytes: videoInfo.sizeBytes.toString(),
            nodeId: targetNodeId,
            libraryId: library.id,
            policyId: policy.id,
          });
        })
      );

      // Collect successful job creations
      const successful = results.filter(
        (r): r is PromiseFulfilledResult<Job> => r.status === 'fulfilled' && r.value !== null
      );

      jobs.push(...successful.map((r) => r.value));

      // Log batch progress
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(filesToEncode.length / batchSize);
      this.logger.log(
        `Batch ${batchNum}/${totalBatches}: Created ${successful.length}/${batch.length} jobs`
      );
    }

    this.logger.log(`Created ${jobs.length} encoding jobs`);

    return { jobsCreated: jobs.length, jobs };
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

    const library = await this.libraryRepository.findUniqueWithInclude(
      { id: libraryId },
      { node: true }
    );

    if (!library) {
      throw new NotFoundException(`Library with ID "${libraryId}" not found`);
    }

    const policy = await this.policyRepository.findById(policyId);

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
    const existingJobs = await this.jobRepository.findManySelect<{
      filePath: string;
      isBlacklisted: boolean;
    }>(
      {
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
      { filePath: true, isBlacklisted: true }
    );

    const existingPaths = new Set(existingJobs.map((job) => job.filePath));
    const blacklistedPaths = new Set(
      existingJobs.filter((job) => job.isBlacklisted).map((job) => job.filePath)
    );

    // Cross-job failure tracking: batch check auto-blacklisted files
    const autoBlacklistedPaths = await this.fileFailureTracking.getBlacklistedPaths(
      videoFiles,
      library.id
    );

    const result: BulkJobCreationResultDto = {
      jobsCreated: 0,
      filesSkipped: 0,
      skippedFiles: [],
    };

    // Process each file
    for (const filePath of videoFiles) {
      try {
        // Skip if auto-blacklisted by cross-job failure tracking
        if (autoBlacklistedPaths.has(filePath)) {
          result.filesSkipped++;
          result.skippedFiles.push({
            path: filePath,
            reason: 'Auto-blacklisted (repeated failures)',
          });
          continue;
        }

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

        // Create job with distribution to best available node
        const fileLabel = filePath.split('/').pop() || filePath;
        const targetNodeId = await this.distributionOrchestrator.findBestNodeForNewJob(
          library.nodeId
        );

        await this.queueService.create({
          filePath,
          fileLabel,
          sourceCodec: videoInfo.codec,
          targetCodec: policy.targetCodec,
          beforeSizeBytes: videoInfo.sizeBytes.toString(),
          nodeId: targetNodeId,
          libraryId: library.id,
          policyId: policy.id,
        });

        result.jobsCreated++;
      } catch (error: unknown) {
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

    const library = await this.libraryRepository.findByWhere({ id: libraryId });

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
    const analyzedFiles: AnalyzedFileInfo[] = [];
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
              canAddToQueue: videoInfo.healthStatus === FileHealthStatus.HEALTHY,
              blockedReason:
                videoInfo.healthStatus !== FileHealthStatus.HEALTHY
                  ? videoInfo.healthMessage
                  : undefined,
            };
          } catch (error: unknown) {
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
