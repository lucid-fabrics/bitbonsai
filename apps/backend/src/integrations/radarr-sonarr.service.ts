import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Media server type
 */
export enum MediaServerType {
  RADARR = 'radarr',
  SONARR = 'sonarr',
  WHISPARR = 'whisparr',
}

/**
 * Movie/Series information from *arr
 */
export interface MediaInfo {
  id: number;
  title: string;
  path: string;
  sizeOnDisk: number;
  hasFile: boolean;
  monitored: boolean;
  qualityProfileId: number;
}

/**
 * File information from *arr
 */
export interface MediaFile {
  id: number;
  path: string;
  size: number;
  quality: {
    quality: {
      name: string;
      resolution: number;
    };
  };
  mediaInfo?: {
    videoCodec: string;
    audioCodec: string;
    videoBitrate: number;
  };
}

/**
 * RadarrSonarrIntegrationService
 *
 * Integrates with Radarr and Sonarr for:
 * - Getting library file information
 * - Triggering rescans after encoding
 * - Quality profile filtering
 * - Webhook notifications
 *
 * Features:
 * - Auto-rescan after encoding completion
 * - Skip files with high quality profiles
 * - Support for Radarr, Sonarr, and Whisparr
 */
@Injectable()
export class RadarrSonarrIntegrationService {
  private readonly logger = new Logger(RadarrSonarrIntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService
  ) {}

  /**
   * Get all movies from Radarr
   */
  async getRadarrMovies(): Promise<MediaInfo[]> {
    const config = await this.getConfig(MediaServerType.RADARR);
    if (!config) return [];

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${config.url}/api/v3/movie`, {
          headers: { 'X-Api-Key': config.apiKey },
          timeout: 30000,
        })
      );

      return (response.data || []).map((m: any) => ({
        id: m.id,
        title: m.title,
        path: m.path,
        sizeOnDisk: m.sizeOnDisk,
        hasFile: m.hasFile,
        monitored: m.monitored,
        qualityProfileId: m.qualityProfileId,
      }));
    } catch (error) {
      this.logger.error(`Failed to get Radarr movies: ${error}`);
      return [];
    }
  }

  /**
   * Get all series from Sonarr
   */
  async getSonarrSeries(): Promise<MediaInfo[]> {
    const config = await this.getConfig(MediaServerType.SONARR);
    if (!config) return [];

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${config.url}/api/v3/series`, {
          headers: { 'X-Api-Key': config.apiKey },
          timeout: 30000,
        })
      );

      return (response.data || []).map((s: any) => ({
        id: s.id,
        title: s.title,
        path: s.path,
        sizeOnDisk: s.sizeOnDisk,
        hasFile: s.statistics?.episodeFileCount > 0,
        monitored: s.monitored,
        qualityProfileId: s.qualityProfileId,
      }));
    } catch (error) {
      this.logger.error(`Failed to get Sonarr series: ${error}`);
      return [];
    }
  }

  /**
   * Get movie file from Radarr by path
   */
  async getRadarrMovieFile(filePath: string): Promise<MediaFile | null> {
    const config = await this.getConfig(MediaServerType.RADARR);
    if (!config) return null;

    try {
      // Get all movies and find the one with matching path
      const response = await firstValueFrom(
        this.httpService.get(`${config.url}/api/v3/movie`, {
          headers: { 'X-Api-Key': config.apiKey },
          timeout: 30000,
        })
      );

      for (const movie of response.data || []) {
        if (movie.movieFile?.path === filePath) {
          return {
            id: movie.movieFile.id,
            path: movie.movieFile.path,
            size: movie.movieFile.size,
            quality: movie.movieFile.quality,
            mediaInfo: movie.movieFile.mediaInfo,
          };
        }
      }

      return null;
    } catch (error) {
      this.logger.debug(`Failed to get Radarr movie file: ${error}`);
      return null;
    }
  }

  /**
   * Trigger Radarr rescan for a movie
   */
  async triggerRadarrRescan(movieId: number): Promise<void> {
    const config = await this.getConfig(MediaServerType.RADARR);
    if (!config) return;

    try {
      await firstValueFrom(
        this.httpService.post(
          `${config.url}/api/v3/command`,
          {
            name: 'RescanMovie',
            movieId,
          },
          {
            headers: { 'X-Api-Key': config.apiKey },
            timeout: 10000,
          }
        )
      );

      this.logger.log(`🎬 Triggered Radarr rescan for movie ${movieId}`);
    } catch (error) {
      this.logger.error(`Failed to trigger Radarr rescan: ${error}`);
    }
  }

  /**
   * Trigger Sonarr rescan for a series
   */
  async triggerSonarrRescan(seriesId: number): Promise<void> {
    const config = await this.getConfig(MediaServerType.SONARR);
    if (!config) return;

    try {
      await firstValueFrom(
        this.httpService.post(
          `${config.url}/api/v3/command`,
          {
            name: 'RescanSeries',
            seriesId,
          },
          {
            headers: { 'X-Api-Key': config.apiKey },
            timeout: 10000,
          }
        )
      );

      this.logger.log(`📺 Triggered Sonarr rescan for series ${seriesId}`);
    } catch (error) {
      this.logger.error(`Failed to trigger Sonarr rescan: ${error}`);
    }
  }

  /**
   * Notify *arr about file change after encoding
   * Detects whether file belongs to Radarr or Sonarr and triggers appropriate rescan
   */
  async notifyFileChanged(filePath: string): Promise<void> {
    // Try Radarr first
    const radarrConfig = await this.getConfig(MediaServerType.RADARR);
    if (radarrConfig) {
      try {
        const movies = await this.getRadarrMovies();
        const movie = movies.find((m) => filePath.startsWith(m.path));
        if (movie) {
          await this.triggerRadarrRescan(movie.id);
          return;
        }
      } catch {
        // Try Sonarr next
      }
    }

    // Try Sonarr
    const sonarrConfig = await this.getConfig(MediaServerType.SONARR);
    if (sonarrConfig) {
      try {
        const series = await this.getSonarrSeries();
        const show = series.find((s) => filePath.startsWith(s.path));
        if (show) {
          await this.triggerSonarrRescan(show.id);
          return;
        }
      } catch {
        // File not found in either
      }
    }
  }

  /**
   * Check if file should be skipped based on *arr quality profile
   * Returns true if file is at or above target quality
   */
  async shouldSkipFile(filePath: string): Promise<{
    skip: boolean;
    reason?: string;
  }> {
    // Check Radarr
    const radarrConfig = await this.getConfig(MediaServerType.RADARR);
    if (radarrConfig?.skipQualityMet) {
      const movieFile = await this.getRadarrMovieFile(filePath);
      if (movieFile?.mediaInfo?.videoCodec) {
        const codec = movieFile.mediaInfo.videoCodec.toLowerCase();
        // Skip if already HEVC or AV1
        if (codec.includes('hevc') || codec.includes('h265') || codec.includes('av1')) {
          return {
            skip: true,
            reason: `Already ${movieFile.mediaInfo.videoCodec} (Radarr)`,
          };
        }
      }
    }

    return { skip: false };
  }

  /**
   * Get quality profiles from Radarr
   */
  async getRadarrQualityProfiles(): Promise<Array<{ id: number; name: string }>> {
    const config = await this.getConfig(MediaServerType.RADARR);
    if (!config) return [];

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${config.url}/api/v3/qualityprofile`, {
          headers: { 'X-Api-Key': config.apiKey },
          timeout: 10000,
        })
      );

      return (response.data || []).map((p: any) => ({
        id: p.id,
        name: p.name,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get quality profiles from Sonarr
   */
  async getSonarrQualityProfiles(): Promise<Array<{ id: number; name: string }>> {
    const config = await this.getConfig(MediaServerType.SONARR);
    if (!config) return [];

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${config.url}/api/v3/qualityprofile`, {
          headers: { 'X-Api-Key': config.apiKey },
          timeout: 10000,
        })
      );

      return (response.data || []).map((p: any) => ({
        id: p.id,
        name: p.name,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Test connection to *arr
   */
  async testConnection(
    type: MediaServerType,
    url: string,
    apiKey: string
  ): Promise<{ success: boolean; version?: string; error?: string }> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${url.replace(/\/$/, '')}/api/v3/system/status`, {
          headers: { 'X-Api-Key': apiKey },
          timeout: 10000,
        })
      );

      return {
        success: true,
        version: response.data?.version,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Get *arr configuration from settings
   */
  private async getConfig(type: MediaServerType): Promise<{
    url: string;
    apiKey: string;
    skipQualityMet?: boolean;
  } | null> {
    try {
      const settings = await this.prisma.settings.findFirst();
      const s = settings as any;

      let url: string | undefined;
      let apiKey: string | undefined;
      let skipQualityMet: boolean | undefined;

      switch (type) {
        case MediaServerType.RADARR:
          url = s?.radarrUrl;
          apiKey = s?.radarrApiKey;
          skipQualityMet = s?.radarrSkipQualityMet;
          break;
        case MediaServerType.SONARR:
          url = s?.sonarrUrl;
          apiKey = s?.sonarrApiKey;
          skipQualityMet = s?.sonarrSkipQualityMet;
          break;
        case MediaServerType.WHISPARR:
          url = s?.whisparrUrl;
          apiKey = s?.whisparrApiKey;
          skipQualityMet = s?.whisparrSkipQualityMet;
          break;
      }

      if (!url || !apiKey) {
        return null;
      }

      return {
        url: url.replace(/\/$/, ''),
        apiKey,
        skipQualityMet,
      };
    } catch {
      return null;
    }
  }

  /**
   * Register webhooks with *arr for automatic notifications
   */
  async registerWebhooks(
    type: MediaServerType,
    callbackUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    const config = await this.getConfig(type);
    if (!config) {
      return { success: false, error: 'Not configured' };
    }

    try {
      // Check if webhook already exists
      const listResponse = await firstValueFrom(
        this.httpService.get(`${config.url}/api/v3/notification`, {
          headers: { 'X-Api-Key': config.apiKey },
          timeout: 10000,
        })
      );

      const existing = (listResponse.data || []).find((n: any) => n.name === 'BitBonsai');

      const webhookConfig = {
        name: 'BitBonsai',
        implementation: 'Webhook',
        configContract: 'WebhookSettings',
        onGrab: false,
        onDownload: true,
        onUpgrade: true,
        onRename: true,
        onMovieFileDelete: type === MediaServerType.RADARR,
        onEpisodeFileDelete: type === MediaServerType.SONARR,
        supportsOnGrab: false,
        supportsOnDownload: true,
        supportsOnUpgrade: true,
        supportsOnRename: true,
        fields: [
          { name: 'url', value: callbackUrl },
          { name: 'method', value: 1 }, // POST
        ],
      };

      if (existing) {
        // Update existing webhook
        await firstValueFrom(
          this.httpService.put(
            `${config.url}/api/v3/notification/${existing.id}`,
            { ...webhookConfig, id: existing.id },
            {
              headers: { 'X-Api-Key': config.apiKey },
              timeout: 10000,
            }
          )
        );
      } else {
        // Create new webhook
        await firstValueFrom(
          this.httpService.post(`${config.url}/api/v3/notification`, webhookConfig, {
            headers: { 'X-Api-Key': config.apiKey },
            timeout: 10000,
          })
        );
      }

      this.logger.log(`✅ Registered BitBonsai webhook with ${type}`);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to register webhook',
      };
    }
  }
}
