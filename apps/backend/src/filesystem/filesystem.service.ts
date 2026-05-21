import { readdir, stat } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';

export interface DirectoryInfo {
  name: string;
  path: string;
  isAccessible: boolean;
}

export interface BrowseResult {
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryInfo[];
}

@Injectable()
export class FilesystemService {
  private readonly logger = new Logger(FilesystemService.name);

  async listDirectories(path: string): Promise<BrowseResult> {
    try {
      this.logger.log(`Browsing directory: ${path}`);

      // Normalize and sanitize the path
      const normalizedPath = this.sanitizePath(path || '/');

      // Get parent path
      const parentPath = normalizedPath === '/' ? null : dirname(normalizedPath);

      // Read directory contents
      const entries = await readdir(normalizedPath, { withFileTypes: true });

      // Filter directories and get their info
      const directories: DirectoryInfo[] = [];

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const fullPath = join(normalizedPath, entry.name);
          let isAccessible = true;

          try {
            // Test if we can access the directory
            await stat(fullPath);
          } catch {
            isAccessible = false;
          }

          directories.push({
            name: entry.name,
            path: fullPath,
            isAccessible,
          });
        }
      }

      // Sort directories alphabetically
      directories.sort((a, b) => a.name.localeCompare(b.name));

      return {
        currentPath: normalizedPath,
        parentPath,
        directories,
      };
    } catch (error: unknown) {
      this.logger.error(`Failed to browse directory ${path}`, error);
      throw error;
    }
  }

  /**
   * Sanitizes and validates a filesystem path to prevent path traversal attacks
   * @param inputPath - The user-provided path
   * @returns The sanitized absolute path
   * @throws BadRequestException if path contains suspicious patterns
   */
  private sanitizePath(inputPath: string): string {
    // Remove null bytes
    if (inputPath.includes('\0')) {
      throw new BadRequestException('Invalid path: null bytes not allowed');
    }

    // Normalize the path (resolves .., ., removes duplicate slashes)
    const normalizedPath = normalize(inputPath);

    // Ensure path is absolute
    const absolutePath = resolve(normalizedPath);

    // Check for path traversal attempts
    if (!absolutePath.startsWith('/')) {
      throw new BadRequestException('Invalid path: must be absolute');
    }

    // Block certain sensitive directories
    const blockedPaths = ['/etc/shadow', '/etc/passwd', '/root/.ssh'];
    if (blockedPaths.some((blocked) => absolutePath.startsWith(blocked))) {
      throw new BadRequestException('Access denied to sensitive system directories');
    }

    return absolutePath;
  }
}
