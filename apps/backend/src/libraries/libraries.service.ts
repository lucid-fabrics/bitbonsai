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
import { FileWatcherService } from '../file-watcher/file-watcher.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateLibraryDto } from './dto/create-library.dto';
import type { LibraryStatsDto } from './dto/library-stats.dto';
import type { UpdateLibraryDto } from './dto/update-library.dto';

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
    private fileWatcher: FileWatcherService
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
      const { join } = await import('node:path');

      // Supported video file extensions
      const videoExtensions = [
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

      const stats = { totalFiles: 0, totalSizeBytes: BigInt(0) };

      // Recursive function to scan directory
      const scanDirectory = async (dirPath: string): Promise<void> => {
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = join(dirPath, entry.name);

            if (entry.isDirectory()) {
              await scanDirectory(fullPath);
            } else if (entry.isFile()) {
              await this.processVideoFile(entry.name, fullPath, videoExtensions, stats, fs);
            }
          }
        } catch (readError) {
          this.logger.warn(`Failed to read directory: ${dirPath}`, readError);
        }
      };

      // Start scanning from library path
      await scanDirectory(existingLibrary.path);

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
    const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
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
}
