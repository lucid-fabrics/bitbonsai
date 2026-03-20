import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { JobStage } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import type { SystemSettings } from '../common/interfaces/system-settings.interface';
import { JobRepository } from '../common/repositories/job.repository';
import { SettingsRepository } from '../common/repositories/settings.repository';
import { testIntegrationConnection } from './test-connection.util';

/**
 * Plex session information
 */
interface PlexSession {
  type: string;
  title: string;
  grandparentTitle?: string;
  User: { title: string };
  Player: { state: string; machineIdentifier: string };
}

/**
 * PlexIntegrationService
 *
 * Integrates with Plex Media Server for:
 * - Detecting active playback (pause encoding during viewing)
 * - Triggering library refresh after encoding
 * - Getting media metadata
 *
 * Features:
 * - Auto-pause encoding during active playback
 * - Library refresh webhooks
 * - Session monitoring
 */
@Injectable()
export class PlexIntegrationService {
  private readonly logger = new Logger(PlexIntegrationService.name);
  private wasPlaybackActive = false;

  constructor(
    private readonly settingsRepository: SettingsRepository,
    private readonly jobRepository: JobRepository,
    private readonly httpService: HttpService
  ) {}

  /**
   * Check if any media is currently being played
   *
   * @returns true if playback is active
   */
  async isPlaybackActive(): Promise<boolean> {
    const config = await this.getPlexConfig();
    if (!config) return false;

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${config.url}/status/sessions`, {
          headers: { 'X-Plex-Token': config.token },
          timeout: 5000,
        })
      );

      const sessions = response.data?.MediaContainer?.Metadata || [];

      // Check for any playing (not paused) sessions
      const activeSessions = sessions.filter((s: PlexSession) => s.Player?.state === 'playing');

      return activeSessions.length > 0;
    } catch (error: unknown) {
      this.logger.debug(`Plex session check failed: ${error}`);
      return false;
    }
  }

  /**
   * Get current playback sessions
   */
  async getActiveSessions(): Promise<
    Array<{
      title: string;
      user: string;
      state: string;
      type: string;
    }>
  > {
    const config = await this.getPlexConfig();
    if (!config) return [];

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${config.url}/status/sessions`, {
          headers: { 'X-Plex-Token': config.token },
          timeout: 5000,
        })
      );

      const sessions = response.data?.MediaContainer?.Metadata || [];

      return sessions.map((s: PlexSession) => ({
        title: s.grandparentTitle ? `${s.grandparentTitle} - ${s.title}` : s.title,
        user: s.User?.title || 'Unknown',
        state: s.Player?.state || 'unknown',
        type: s.type,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Trigger library refresh for a specific section
   *
   * @param sectionId - Plex library section ID
   */
  async refreshLibrary(sectionId?: string): Promise<void> {
    const config = await this.getPlexConfig();
    if (!config) return;

    try {
      const url = sectionId
        ? `${config.url}/library/sections/${sectionId}/refresh`
        : `${config.url}/library/sections/all/refresh`;

      await firstValueFrom(
        this.httpService.get(url, {
          headers: { 'X-Plex-Token': config.token },
          timeout: 10000,
        })
      );

      this.logger.log(
        `📺 Plex library refresh triggered${sectionId ? ` (section ${sectionId})` : ''}`
      );
    } catch (error: unknown) {
      this.logger.error(`Failed to refresh Plex library: ${error}`);
    }
  }

  /**
   * Notify Plex about a newly encoded file
   *
   * @param filePath - Path to the encoded file
   */
  async notifyNewFile(filePath: string): Promise<void> {
    const config = await this.getPlexConfig();
    if (!config || !config.refreshOnComplete) return;

    // Find which library section contains this file
    const section = await this.findLibrarySection(filePath);

    if (section) {
      await this.refreshLibrary(section);
    } else {
      // Refresh all libraries if section not found
      await this.refreshLibrary();
    }
  }

  /**
   * Periodically check for playback and pause/resume encoding
   * Runs every 30 seconds
   */
  @Interval(30000)
  async checkPlaybackAndPause(): Promise<void> {
    const config = await this.getPlexConfig();
    if (!config?.pauseDuringPlayback) return;

    try {
      const isPlaying = await this.isPlaybackActive();

      if (isPlaying && !this.wasPlaybackActive) {
        // Playback just started - pause encoding
        const paused = await this.pauseAllEncoding();
        if (paused > 0) {
          this.logger.log(`⏸️ Paused ${paused} encoding job(s) - Plex playback detected`);
        }
        this.wasPlaybackActive = true;
      } else if (!isPlaying && this.wasPlaybackActive) {
        // Playback just stopped - resume encoding
        const resumed = await this.resumeAllEncoding();
        if (resumed > 0) {
          this.logger.log(`▶️ Resumed ${resumed} encoding job(s) - Plex playback ended`);
        }
        this.wasPlaybackActive = false;
      }
    } catch (error: unknown) {
      this.logger.debug(`Playback check failed: ${error}`);
    }
  }

  /**
   * Pause all encoding jobs (Plex playback active)
   */
  private async pauseAllEncoding(): Promise<number> {
    const result = await this.jobRepository.updateManyWhere(
      { stage: { in: [JobStage.QUEUED, JobStage.ENCODING] } },
      { stage: JobStage.PAUSED, error: 'Paused: Plex playback detected' }
    );

    return result.count;
  }

  /**
   * Resume encoding jobs paused due to Plex playback
   */
  private async resumeAllEncoding(): Promise<number> {
    const result = await this.jobRepository.updateManyWhere(
      { stage: JobStage.PAUSED, error: { contains: 'Plex playback detected' } },
      { stage: JobStage.QUEUED, error: null }
    );

    return result.count;
  }

  /**
   * Find library section containing a file path
   */
  private async findLibrarySection(filePath: string): Promise<string | null> {
    const config = await this.getPlexConfig();
    if (!config) return null;

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${config.url}/library/sections`, {
          headers: { 'X-Plex-Token': config.token },
          timeout: 5000,
        })
      );

      const sections = response.data?.MediaContainer?.Directory || [];

      for (const section of sections) {
        const locations = section.Location || [];
        for (const loc of locations) {
          if (filePath.startsWith(loc.path)) {
            return section.key;
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return null;
  }

  /**
   * Get Plex configuration from settings
   */
  private async getPlexConfig(): Promise<{
    url: string;
    token: string;
    pauseDuringPlayback: boolean;
    refreshOnComplete: boolean;
  } | null> {
    try {
      const settings = await this.settingsRepository.findFirst();
      const s = settings as SystemSettings | null;

      if (!s?.plexUrl || !s?.plexToken) {
        return null;
      }

      return {
        url: s.plexUrl.replace(/\/$/, ''), // Remove trailing slash
        token: s.plexToken,
        pauseDuringPlayback: s.plexPauseDuringPlayback ?? true,
        refreshOnComplete: s.plexRefreshOnComplete ?? true,
      };
    } catch {
      return null;
    }
  }

  /**
   * Test Plex connection
   */
  async testConnection(
    url: string,
    token: string
  ): Promise<{ success: boolean; serverName?: string; error?: string }> {
    const result = await testIntegrationConnection(this.httpService, {
      url,
      path: '',
      headers: { 'X-Plex-Token': token },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const container = result.data?.MediaContainer as Record<string, unknown> | undefined;

    return {
      success: true,
      serverName: container?.friendlyName as string | undefined,
    };
  }
}
