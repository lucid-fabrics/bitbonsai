import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { JellyfinIntegrationService } from '../../integrations/jellyfin.service';

/**
 * File relocation result
 */
export interface RelocationResult {
  found: boolean;
  newPath: string | null;
  matchType: 'exact_size' | 'fuzzy_name' | 'both' | 'jellyfin' | null;
  confidence: number; // 0-100
  searchedPaths: number;
  source?: 'jellyfin' | 'filesystem';
}

/**
 * FileRelocatorService
 *
 * Automatically relocates files that have been moved or renamed by media servers
 * (Jellyfin, Plex, Emby, etc.). This enables self-healing when files are renamed
 * after being queued for encoding.
 *
 * UX Philosophy: Zero friction, self-healing
 * - Files renamed by Jellyfin should not cause permanent failures
 * - Automatic relocation happens silently without user intervention
 * - Only mark as truly failed if file cannot be located anywhere
 *
 * Matching Strategy:
 * 1. Jellyfin API lookup (if configured - most reliable for Jellyfin users)
 * 2. Exact file size match (filesystem search)
 * 3. Fuzzy filename matching (handles renames)
 * 4. Combined confidence scoring
 */
@Injectable()
export class FileRelocatorService {
  private readonly logger = new Logger(FileRelocatorService.name);

  constructor(private readonly jellyfinService: JellyfinIntegrationService) {}

  // Video file extensions to search for
  private readonly VIDEO_EXTENSIONS = new Set([
    '.mkv',
    '.mp4',
    '.avi',
    '.mov',
    '.wmv',
    '.m4v',
    '.webm',
    '.ts',
    '.m2ts',
    '.flv',
    '.mpg',
    '.mpeg',
  ]);

  // Common patterns added by media servers that we should normalize
  private readonly NORMALIZE_PATTERNS = [
    // Year patterns: (2024), [2024]
    /\s*[([]\d{4}[)\]]\s*/g,
    // Quality tags: 1080p, 2160p, 4K, etc.
    /\s*\b(2160p|1080p|720p|480p|4K|UHD|HDR|HDR10|DV|Dolby Vision)\b\s*/gi,
    // Source tags: BluRay, WEB-DL, etc.
    /\s*\b(BluRay|Bluray|BDRip|BRRip|WEB-DL|WEBRip|HDTV|DVDRip|Remux)\b\s*/gi,
    // Codec tags: x264, x265, HEVC, H\.264, etc.
    /\s*\b(x264|x265|HEVC|H\.?264|H\.?265|AV1|VP9|AVC)\b\s*/gi,
    // Audio tags: DTS, Atmos, TrueHD, etc.
    /\s*\b(DTS|DTS-HD|TrueHD|Atmos|AAC|AC3|FLAC|MA)\b\s*/gi,
    // Encoding groups: -SPARKS, -RARBG, etc.
    /\s*-[A-Za-z0-9]+$/g,
    // Extra info in brackets/parentheses
    /\s*[[(][^\])]*[\])]\s*/g,
    // Multiple spaces
    /\s+/g,
  ];

  /**
   * Attempt to relocate a file that was not found at its original path
   *
   * @param originalPath - Original file path that no longer exists
   * @param expectedSizeBytes - Expected file size in bytes (for validation)
   * @param searchDepth - How many directory levels to search (default: 2)
   * @returns RelocationResult with new path if found
   */
  async relocateFile(
    originalPath: string,
    expectedSizeBytes: bigint | number,
    searchDepth = 2
  ): Promise<RelocationResult> {
    const startTime = Date.now();
    const expectedSize = BigInt(expectedSizeBytes);
    const originalDir = path.dirname(originalPath);
    const originalName = path.basename(originalPath);
    const normalizedOriginal = this.normalizeFilename(originalName);

    this.logger.log(`🔍 Attempting to relocate: ${originalPath}`);
    this.logger.log(`   Expected size: ${expectedSize} bytes`);
    this.logger.log(`   Normalized name: "${normalizedOriginal}"`);

    // STEP 1: Try Jellyfin API first (if configured)
    try {
      const jellyfinResult = await this.jellyfinService.findFileByNameAndSize(
        originalPath,
        expectedSizeBytes
      );

      if (jellyfinResult.found && jellyfinResult.path) {
        // Verify the file actually exists at the Jellyfin-reported path
        if (fs.existsSync(jellyfinResult.path)) {
          const elapsed = Date.now() - startTime;
          this.logger.log(`✅ Jellyfin API: File relocated in ${elapsed}ms`);
          this.logger.log(`   Original: ${originalPath}`);
          this.logger.log(`   Found at: ${jellyfinResult.path}`);

          return {
            found: true,
            newPath: jellyfinResult.path,
            matchType: 'jellyfin',
            confidence: 98,
            searchedPaths: 0,
            source: 'jellyfin',
          };
        } else {
          this.logger.warn(`Jellyfin reported path doesn't exist: ${jellyfinResult.path}`);
        }
      }
    } catch (error: unknown) {
      this.logger.debug(`Jellyfin lookup failed, falling back to filesystem: ${error}`);
    }

    // STEP 2: Fall back to filesystem search
    this.logger.log(`📂 Jellyfin lookup failed or not configured, searching filesystem...`);

    let searchedPaths = 0;
    const candidates: Array<{
      path: string;
      sizeMatch: boolean;
      nameSimilarity: number;
    }> = [];

    // Build list of directories to search
    const searchDirs = this.getSearchDirectories(originalDir, searchDepth);

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isFile()) continue;

          const ext = path.extname(entry.name).toLowerCase();
          if (!this.VIDEO_EXTENSIONS.has(ext)) continue;

          searchedPaths++;
          const candidatePath = path.join(dir, entry.name);

          // Skip if it's the original path
          if (candidatePath === originalPath) continue;

          try {
            const stats = fs.statSync(candidatePath);
            const candidateSize = BigInt(stats.size);
            const sizeMatch = candidateSize === expectedSize;

            // Calculate name similarity
            const normalizedCandidate = this.normalizeFilename(entry.name);
            const nameSimilarity = this.calculateSimilarity(
              normalizedOriginal,
              normalizedCandidate
            );

            // Only consider if size matches OR name is very similar
            if (sizeMatch || nameSimilarity >= 0.6) {
              candidates.push({
                path: candidatePath,
                sizeMatch,
                nameSimilarity,
              });
            }
          } catch {
            // Skip files we can't stat
          }
        }
      } catch {
        // Skip directories we can't read
      }
    }

    // Sort candidates by match quality
    candidates.sort((a, b) => {
      // Size match is highest priority
      if (a.sizeMatch && !b.sizeMatch) return -1;
      if (!a.sizeMatch && b.sizeMatch) return 1;
      // Then by name similarity
      return b.nameSimilarity - a.nameSimilarity;
    });

    const elapsed = Date.now() - startTime;

    if (candidates.length > 0) {
      const best = candidates[0];
      const matchType =
        best.sizeMatch && best.nameSimilarity >= 0.5
          ? 'both'
          : best.sizeMatch
            ? 'exact_size'
            : 'fuzzy_name';
      const confidence = best.sizeMatch
        ? best.nameSimilarity >= 0.5
          ? 95
          : 85
        : Math.round(best.nameSimilarity * 70);

      this.logger.log(`✅ File relocated in ${elapsed}ms (searched ${searchedPaths} files)`);
      this.logger.log(`   Original: ${originalPath}`);
      this.logger.log(`   Found at: ${best.path}`);
      this.logger.log(`   Match: ${matchType} (${confidence}% confidence)`);

      return {
        found: true,
        newPath: best.path,
        matchType,
        confidence,
        searchedPaths,
        source: 'filesystem',
      };
    }

    this.logger.warn(`❌ File not found after searching ${searchedPaths} files in ${elapsed}ms`);
    return {
      found: false,
      newPath: null,
      matchType: null,
      confidence: 0,
      searchedPaths,
      source: 'filesystem',
    };
  }

  /**
   * Get list of directories to search for relocated files
   */
  private getSearchDirectories(originalDir: string, depth: number): string[] {
    const dirs: string[] = [originalDir];

    // Add parent directory
    const parentDir = path.dirname(originalDir);
    if (parentDir !== originalDir) {
      dirs.push(parentDir);

      // Add sibling directories (other folders in parent)
      try {
        const siblings = fs.readdirSync(parentDir, { withFileTypes: true });
        for (const sibling of siblings) {
          if (sibling.isDirectory()) {
            const siblingPath = path.join(parentDir, sibling.name);
            if (siblingPath !== originalDir && !dirs.includes(siblingPath)) {
              dirs.push(siblingPath);
            }
          }
        }
      } catch {
        // Skip if can't read parent
      }

      // Go up one more level if depth allows
      if (depth >= 2) {
        const grandparentDir = path.dirname(parentDir);
        if (grandparentDir !== parentDir) {
          try {
            const uncles = fs.readdirSync(grandparentDir, { withFileTypes: true });
            for (const uncle of uncles) {
              if (uncle.isDirectory()) {
                const unclePath = path.join(grandparentDir, uncle.name);
                if (!dirs.includes(unclePath)) {
                  dirs.push(unclePath);
                  // Also add subdirectories of uncle
                  try {
                    const cousins = fs.readdirSync(unclePath, { withFileTypes: true });
                    for (const cousin of cousins) {
                      if (cousin.isDirectory()) {
                        const cousinPath = path.join(unclePath, cousin.name);
                        if (!dirs.includes(cousinPath)) {
                          dirs.push(cousinPath);
                        }
                      }
                    }
                  } catch {
                    // Skip
                  }
                }
              }
            }
          } catch {
            // Skip
          }
        }
      }
    }

    return dirs;
  }

  /**
   * Normalize a filename for comparison by removing common metadata tags
   */
  private normalizeFilename(filename: string): string {
    // Remove extension
    let normalized = path.basename(filename, path.extname(filename));

    // Apply all normalization patterns
    for (const pattern of this.NORMALIZE_PATTERNS) {
      normalized = normalized.replace(pattern, ' ');
    }

    // Final cleanup
    normalized = normalized.trim().toLowerCase();

    // Replace remaining punctuation with spaces
    normalized = normalized.replace(/[._-]+/g, ' ');

    // Collapse multiple spaces
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   * Returns value between 0 (completely different) and 1 (identical)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1;
    if (str1.length === 0 || str2.length === 0) return 0;

    // Check if one contains the other (common with Jellyfin renames)
    if (str1.includes(str2) || str2.includes(str1)) {
      const longerLen = Math.max(str1.length, str2.length);
      const shorterLen = Math.min(str1.length, str2.length);
      return shorterLen / longerLen;
    }

    // Levenshtein distance
    const matrix: number[][] = [];

    for (let i = 0; i <= str1.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= str2.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str1.length; i++) {
      for (let j = 1; j <= str2.length; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[str1.length][str2.length];
    const maxLen = Math.max(str1.length, str2.length);
    return 1 - distance / maxLen;
  }
}
