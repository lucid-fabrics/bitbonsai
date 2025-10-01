import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Library } from '@prisma/client';
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

  constructor(private prisma: PrismaService) {}

  /**
   * Create a new library
   *
   * @param createLibraryDto - Library creation data
   * @returns The created library
   * @throws ConflictException if a library with the same path already exists on the node
   * @throws NotFoundException if the specified node does not exist
   */
  async create(createLibraryDto: CreateLibraryDto): Promise<Library> {
    this.logger.log(`Creating library: ${createLibraryDto.name}`);

    // Check if node exists
    const node = await this.prisma.node.findUnique({
      where: { id: createLibraryDto.nodeId },
    });

    if (!node) {
      throw new NotFoundException(`Node with ID "${createLibraryDto.nodeId}" not found`);
    }

    // Check for duplicate path on the same node
    const existingLibrary = await this.prisma.library.findUnique({
      where: {
        nodeId_path: {
          nodeId: createLibraryDto.nodeId,
          path: createLibraryDto.path,
        },
      },
    });

    if (existingLibrary) {
      throw new ConflictException(
        `Library with path "${createLibraryDto.path}" already exists on node "${node.name}"`
      );
    }

    try {
      const library = await this.prisma.library.create({
        data: {
          name: createLibraryDto.name,
          path: createLibraryDto.path,
          mediaType: createLibraryDto.mediaType,
          nodeId: createLibraryDto.nodeId,
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
      const library = await this.prisma.library.update({
        where: { id },
        data: updateLibraryDto,
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
   * Trigger a library scan and update the lastScanAt timestamp
   *
   * This is a placeholder implementation. In production, this would:
   * 1. Trigger a file system scan of the library path
   * 2. Update totalFiles and totalSizeBytes
   * 3. Queue encoding jobs based on policies
   * 4. Update lastScanAt timestamp
   *
   * @param id - Library unique identifier
   * @returns Updated library with scan timestamp
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
      // TODO: Implement actual file scanning logic
      // For now, just update the scan timestamp
      const library = await this.prisma.library.update({
        where: { id },
        data: {
          lastScanAt: new Date(),
        },
      });

      this.logger.log(`Library scan completed: ${id}`);
      return library;
    } catch (error) {
      this.logger.error(`Failed to scan library: ${id}`, error);
      throw error;
    }
  }
}
