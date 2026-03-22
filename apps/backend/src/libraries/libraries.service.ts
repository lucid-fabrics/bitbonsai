import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job, Library, Node } from '@prisma/client';
import {
  LibraryWatcherDisableEvent,
  LibraryWatcherEnableEvent,
  LibraryWatcherStopEvent,
} from '../common/events';
import { LibraryRepository } from '../common/repositories/library.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import type { CacheMetadataDto } from './dto/cache-metadata.dto';
import type { CreateLibraryDto } from './dto/create-library.dto';
import type { LibraryFilesDto } from './dto/library-files.dto';
import type { LibraryStatsDto } from './dto/library-stats.dto';
import type { BulkJobCreationResultDto, ScanPreviewDto } from './dto/scan-preview.dto';
import type { UpdateLibraryDto } from './dto/update-library.dto';
import { LibraryScannerService } from './library-scanner.service';

/**
 * LibrariesService
 *
 * Thin CRUD orchestrator for media libraries.
 * Scan, preview, job-creation, and cache concerns are delegated to LibraryScannerService.
 */
@Injectable()
export class LibrariesService {
  public readonly logger = new Logger(LibrariesService.name);

  constructor(
    private eventEmitter: EventEmitter2,
    public readonly libraryScanner: LibraryScannerService,
    private readonly libraryRepository: LibraryRepository,
    private readonly nodeRepository: NodeRepository
  ) {}

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
    const sanitizedPath = this.libraryScanner.validateLibraryPath(createLibraryDto.path);

    // Auto-assign to first available node if nodeId not provided
    let nodeId = createLibraryDto.nodeId;
    if (!nodeId) {
      const firstNode = await this.nodeRepository.findFirst<Node | null>({
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
    const node = await this.nodeRepository.findById(nodeId);

    if (!node) {
      throw new NotFoundException(`Node with ID "${nodeId}" not found`);
    }

    // Check for duplicate path on the same node (use sanitized path)
    const existingLibrary = await this.libraryRepository.findFirstWhere({
      nodeId,
      path: sanitizedPath,
    });

    if (existingLibrary) {
      throw new ConflictException(
        `Library with path "${sanitizedPath}" already exists on node "${node.name}"`
      );
    }

    try {
      const library = await this.libraryRepository.createLibrary({
        name: createLibraryDto.name,
        path: sanitizedPath, // SECURITY: Use sanitized path
        mediaType: createLibraryDto.mediaType,
        nodeId: nodeId as string,
      });

      this.logger.log(`Library created: ${library.id}`);
      return library;
    } catch (error: unknown) {
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
    return this.libraryRepository.findAllLibraries(undefined, {
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
    }) as Promise<Library[]>;
  }

  /**
   * Get all unique library paths from the database
   *
   * UX PHILOSOPHY: Eliminates need for MEDIA_PATHS env var
   * Paths are derived from library configuration in database,
   * providing a single source of truth.
   *
   * @param nodeId - Optional: filter by node ID (for per-node paths)
   * @returns Array of unique library paths
   */
  async getAllLibraryPaths(nodeId?: string): Promise<string[]> {
    const libraries = await this.libraryRepository.findAllLibraries(
      nodeId ? { nodeId } : undefined
    );

    // Return unique paths
    const paths = [...new Set(libraries.map((lib) => lib.path))];
    this.logger.debug(`Retrieved ${paths.length} library path(s) from database`);
    return paths;
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

    const library = await this.libraryRepository.findUniqueWithInclude(
      { id },
      {
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
      }
    );

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
    const existingLibrary = await this.libraryRepository.findByWhere({ id });

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
          this.eventEmitter.emit(
            LibraryWatcherEnableEvent.event,
            new LibraryWatcherEnableEvent(id)
          );
        } else {
          this.eventEmitter.emit(
            LibraryWatcherDisableEvent.event,
            new LibraryWatcherDisableEvent(id)
          );
        }
      }

      const library = await this.libraryRepository.updateWithInclude({ id }, updateLibraryDto, {
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
      });

      this.logger.log(`Library updated: ${id}`);
      return library;
    } catch (error: unknown) {
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
    const existingLibrary = await this.libraryRepository.findByWhere({ id });

    if (!existingLibrary) {
      throw new NotFoundException(`Library with ID "${id}" not found`);
    }

    try {
      // Stop file watcher if active (fire-and-forget via event)
      if (existingLibrary.watchEnabled) {
        this.eventEmitter.emit(LibraryWatcherStopEvent.event, new LibraryWatcherStopEvent(id));
      }

      await this.libraryRepository.deleteLibrary({ id });

      this.logger.log(`Library deleted: ${id}`);
    } catch (error: unknown) {
      this.logger.error(`Failed to delete library: ${id}`, error);
      throw error;
    }
  }

  // ── Scan delegation ──────────────────────────────────────────────────────

  async scan(id: string): Promise<Library> {
    return this.libraryScanner.scan(id);
  }

  async scanPreview(id: string): Promise<ScanPreviewDto> {
    return this.libraryScanner.scanPreview(id);
  }

  async createJobsFromScan(
    libraryId: string,
    policyId?: string,
    filePaths?: string[]
  ): Promise<{ jobsCreated: number; jobs: Job[] }> {
    return this.libraryScanner.createJobsFromScan(libraryId, policyId, filePaths);
  }

  async createAllJobs(libraryId: string, policyId: string): Promise<BulkJobCreationResultDto> {
    return this.libraryScanner.createAllJobs(libraryId, policyId);
  }

  invalidateReadyFilesCache(): void {
    this.libraryScanner.invalidateReadyFilesCache();
  }

  async getCacheMetadata(): Promise<CacheMetadataDto> {
    return this.libraryScanner.getCacheMetadata();
  }

  async getAllReadyFiles(): Promise<ScanPreviewDto[]> {
    return this.libraryScanner.getAllReadyFiles();
  }

  async getLibraryFiles(libraryId: string): Promise<LibraryFilesDto> {
    return this.libraryScanner.getLibraryFiles(libraryId);
  }
}
