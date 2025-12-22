import * as path from 'node:path';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Jellyfin media item from API
 */
interface JellyfinItem {
  Id: string;
  Name: string;
  Path?: string;
  Type: string;
  Size?: number;
  MediaSources?: Array<{
    Path: string;
    Size: number;
  }>;
}

/**
 * Jellyfin search result
 */
export interface JellyfinSearchResult {
  found: boolean;
  itemId?: string;
  path?: string;
  name?: string;
  size?: number;
}

/**
 * JellyfinIntegrationService
 *
 * Integrates with Jellyfin Media Server for:
 * - Finding current file paths (when files are renamed)
 * - Triggering library refresh after encoding
 * - Testing connection
 *
 * UX Philosophy: Self-healing file relocation
 * - When Jellyfin renames files, we can query the API to find the new path
 * - This is more reliable than filesystem search for Jellyfin users
 */
@Injectable()
export class JellyfinIntegrationService {
  private readonly logger = new Logger(JellyfinIntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService
  ) {}

  /**
   * Search for a file by name and size
   *
   * Uses Jellyfin's search API to find media items matching the filename.
   * Size is used as a secondary verification.
   *
   * @param originalPath - Original file path (used to extract search terms)
   * @param expectedSizeBytes - Expected file size for verification
   * @returns Search result with new path if found
   */
  async findFileByNameAndSize(
    originalPath: string,
    expectedSizeBytes: bigint | number
  ): Promise<JellyfinSearchResult> {
    const config = await this.getJellyfinConfig();
    if (!config) {
      return { found: false };
    }

    const expectedSize = Number(expectedSizeBytes);
    const filename = path.basename(originalPath, path.extname(originalPath));

    // Extract search terms from filename (remove year, quality tags, etc.)
    const searchTerms = this.extractSearchTerms(filename);

    this.logger.debug(
      `🔍 Jellyfin: Searching for "${searchTerms}" (expected size: ${expectedSize})`
    );

    try {
      // Search for items matching the filename
      const response = await firstValueFrom(
        this.httpService.get(`${config.url}/Items`, {
          params: {
            searchTerm: searchTerms,
            Recursive: true,
            IncludeItemTypes: 'Movie,Episode',
            Fields: 'Path,MediaSources',
            Limit: 50,
          },
          headers: {
            'X-Emby-Token': config.apiKey,
          },
          timeout: 15000,
        })
      );

      const items: JellyfinItem[] = response.data?.Items || [];

      if (items.length === 0) {
        this.logger.debug(`Jellyfin: No items found for "${searchTerms}"`);
        return { found: false };
      }

      // Find best match by size
      for (const item of items) {
        // Check direct path
        if (item.Path && item.Size) {
          if (Math.abs(item.Size - expectedSize) < 1024) {
            // Within 1KB tolerance
            this.logger.log(`✅ Jellyfin: Found exact size match - ${item.Path}`);
            return {
              found: true,
              itemId: item.Id,
              path: item.Path,
              name: item.Name,
              size: item.Size,
            };
          }
        }

        // Check media sources (for items with multiple versions)
        if (item.MediaSources) {
          for (const source of item.MediaSources) {
            if (source.Path && source.Size) {
              if (Math.abs(source.Size - expectedSize) < 1024) {
                this.logger.log(
                  `✅ Jellyfin: Found exact size match in media sources - ${source.Path}`
                );
                return {
                  found: true,
                  itemId: item.Id,
                  path: source.Path,
                  name: item.Name,
                  size: source.Size,
                };
              }
            }
          }
        }
      }

      // If no exact size match, try to find by path similarity
      const originalDir = path.dirname(originalPath);
      for (const item of items) {
        const itemPath = item.Path || item.MediaSources?.[0]?.Path;
        if (itemPath) {
          const itemDir = path.dirname(itemPath);
          // Check if in same parent directory structure
          if (this.isSimilarPath(originalDir, itemDir)) {
            this.logger.log(`✅ Jellyfin: Found path similarity match - ${itemPath}`);
            return {
              found: true,
              itemId: item.Id,
              path: itemPath,
              name: item.Name,
              size: item.Size || item.MediaSources?.[0]?.Size,
            };
          }
        }
      }

      this.logger.debug(`Jellyfin: Found ${items.length} items but no size/path match`);
      return { found: false };
    } catch (error) {
      this.logger.warn(`Jellyfin search failed: ${error instanceof Error ? error.message : error}`);
      return { found: false };
    }
  }

  /**
   * Get item by Jellyfin ID
   */
  async getItemById(itemId: string): Promise<JellyfinItem | null> {
    const config = await this.getJellyfinConfig();
    if (!config) return null;

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${config.url}/Items/${itemId}`, {
          params: {
            Fields: 'Path,MediaSources',
          },
          headers: {
            'X-Emby-Token': config.apiKey,
          },
          timeout: 10000,
        })
      );

      return response.data;
    } catch {
      return null;
    }
  }

  /**
   * Trigger library scan for a specific path
   */
  async refreshLibrary(filePath?: string): Promise<void> {
    const config = await this.getJellyfinConfig();
    if (!config || !config.refreshOnComplete) return;

    try {
      // Trigger a library scan
      await firstValueFrom(
        this.httpService.post(
          `${config.url}/Library/Refresh`,
          {},
          {
            headers: {
              'X-Emby-Token': config.apiKey,
            },
            timeout: 10000,
          }
        )
      );

      this.logger.log(`📺 Jellyfin: Library refresh triggered`);
    } catch (error) {
      this.logger.error(`Failed to refresh Jellyfin library: ${error}`);
    }
  }

  /**
   * Test Jellyfin connection
   */
  async testConnection(
    url: string,
    apiKey: string
  ): Promise<{ success: boolean; serverName?: string; version?: string; error?: string }> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${url.replace(/\/$/, '')}/System/Info`, {
          headers: {
            'X-Emby-Token': apiKey,
          },
          timeout: 10000,
        })
      );

      return {
        success: true,
        serverName: response.data?.ServerName,
        version: response.data?.Version,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Check if Jellyfin is configured
   */
  async isConfigured(): Promise<boolean> {
    const config = await this.getJellyfinConfig();
    return config !== null;
  }

  /**
   * Extract search terms from filename
   * Removes year, quality tags, etc.
   */
  private extractSearchTerms(filename: string): string {
    let terms = filename;

    // Remove common patterns
    terms = terms
      // Remove year in brackets/parens: (2024), [2024]
      .replace(/[([]\d{4}[)\]]/g, '')
      // Remove quality tags
      .replace(/\b(2160p|1080p|720p|480p|4K|UHD|HDR|HDR10|DV|Dolby.?Vision)\b/gi, '')
      // Remove source tags
      .replace(/\b(BluRay|Bluray|BDRip|BRRip|WEB-DL|WEBRip|HDTV|DVDRip|Remux)\b/gi, '')
      // Remove codec tags
      .replace(/\b(x264|x265|HEVC|H\.?264|H\.?265|AV1|VP9|AVC)\b/gi, '')
      // Remove audio tags
      .replace(/\b(DTS|DTS-HD|TrueHD|Atmos|AAC|AC3|FLAC|MA)\b/gi, '')
      // Remove release groups
      .replace(/-[A-Za-z0-9]+$/, '')
      // Remove brackets content
      .replace(/[[(][^\])]*[\])]/g, '')
      // Replace dots and underscores with spaces
      .replace(/[._-]+/g, ' ')
      // Collapse multiple spaces
      .replace(/\s+/g, ' ')
      .trim();

    // Take first few words (usually the title)
    const words = terms.split(' ').filter((w) => w.length > 1);
    return words.slice(0, 4).join(' ');
  }

  /**
   * Check if two paths are similar (same parent directory structure)
   */
  private isSimilarPath(path1: string, path2: string): boolean {
    const parts1 = path1.split('/').filter(Boolean);
    const parts2 = path2.split('/').filter(Boolean);

    // Check if they share common parent directories
    let commonParts = 0;
    for (let i = 0; i < Math.min(parts1.length, parts2.length); i++) {
      if (parts1[i] === parts2[i]) {
        commonParts++;
      }
    }

    // If they share at least 2 common parent directories, consider them similar
    return commonParts >= 2;
  }

  /**
   * Get Jellyfin configuration from settings
   */
  private async getJellyfinConfig(): Promise<{
    url: string;
    apiKey: string;
    refreshOnComplete: boolean;
  } | null> {
    try {
      const settings = await this.prisma.settings.findFirst();
      const s = settings as any;

      if (!s?.jellyfinUrl || !s?.jellyfinApiKey) {
        return null;
      }

      return {
        url: s.jellyfinUrl.replace(/\/$/, ''), // Remove trailing slash
        apiKey: s.jellyfinApiKey,
        refreshOnComplete: s.jellyfinRefreshOnComplete ?? true,
      };
    } catch {
      return null;
    }
  }
}
