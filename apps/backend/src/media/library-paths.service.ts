import { Injectable, Logger } from '@nestjs/common';
import { LibraryRepository } from '../common/repositories/library.repository';

/**
 * LibraryPathsService
 *
 * Lightweight service providing library path lookups from the database.
 * Extracted from LibrariesService to allow NodesModule and EncodingModule
 * to obtain library paths without importing LibrariesModule, which would
 * create circular dependencies via QueueModule → EncodingModule → NodesModule.
 *
 * Only depends on LibraryRepository (Prisma) — no upstream module cycles.
 */
@Injectable()
export class LibraryPathsService {
  private readonly logger = new Logger(LibraryPathsService.name);

  constructor(private readonly libraryRepository: LibraryRepository) {}

  /**
   * Get all unique library paths, optionally filtered by node.
   *
   * @param nodeId - Optional node ID to filter libraries
   * @returns Unique array of library path strings
   */
  async getAllLibraryPaths(nodeId?: string): Promise<string[]> {
    const libraries = await this.libraryRepository.findAllLibraries(
      nodeId ? { nodeId } : undefined
    );

    const paths = [...new Set(libraries.map((lib) => lib.path))];
    this.logger.debug(`Retrieved ${paths.length} library path(s) from database`);
    return paths;
  }
}
