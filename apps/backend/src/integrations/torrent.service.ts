import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { SettingsRepository } from '../common/repositories/settings.repository';

/**
 * Torrent client types
 */
export enum TorrentClient {
  QBITTORRENT = 'qbittorrent',
  TRANSMISSION = 'transmission',
  DELUGE = 'deluge',
}

/**
 * Torrent information
 */
export interface TorrentInfo {
  hash: string;
  name: string;
  state: string;
  progress: number;
  ratio: number;
  savePath: string;
  files: string[];
}

/**
 * qBittorrent API response types
 */
interface QBittorrentTorrentResponse {
  hash: string;
  name: string;
  state: string;
  progress: number;
  ratio: number;
  save_path?: string;
  content_path?: string;
}

interface QBittorrentFileResponse {
  name: string;
}

/**
 * Transmission API response types
 */
interface TransmissionTorrentResponse {
  hashString: string;
  name: string;
  status: number;
  percentDone: number;
  uploadRatio: number;
  downloadDir: string;
}

interface TransmissionFileResponse {
  name: string;
}

/**
 * Deluge API response types
 */
interface DelugeTorrentInfo {
  name: string;
  state: string;
  progress: number;
  ratio: number;
  save_path: string;
}

interface DelugeNodeContent {
  type?: string;
  name?: string;
  contents?: Record<string, DelugeNodeContent>;
}

/**
 * TorrentIntegrationService
 *
 * Detects files being seeded in torrent clients.
 * Prevents encoding files that are actively seeding.
 *
 * Supported clients:
 * - qBittorrent (WebUI API)
 * - Transmission (RPC API)
 * - Deluge (JSON-RPC API)
 *
 * Features:
 * - Check if file is currently seeding
 * - Skip seeding files during job creation
 * - Configurable ratio threshold
 */
@Injectable()
export class TorrentIntegrationService {
  private readonly logger = new Logger(TorrentIntegrationService.name);
  private qbCookie: string | null = null;

  constructor(
    private readonly settingsRepository: SettingsRepository,
    private readonly httpService: HttpService
  ) {}

  /**
   * Check if a file is currently being seeded
   *
   * @param filePath - Full path to the file
   * @returns true if file is being seeded
   */
  async isFileSeeding(filePath: string): Promise<boolean> {
    const config = await this.getTorrentConfig();
    if (!config) return false;

    try {
      const torrents = await this.getActiveTorrents(config);

      for (const torrent of torrents) {
        // Check if torrent is seeding (not completed or ratio met)
        if (!this.isTorrentSeeding(torrent)) {
          continue;
        }

        // Check if the file is part of this torrent
        const torrentFiles = await this.getTorrentFiles(config, torrent.hash);

        for (const file of torrentFiles) {
          const fullPath = `${torrent.savePath}/${file}`.replace(/\/+/g, '/');

          if (fullPath === filePath || filePath.includes(file)) {
            this.logger.debug(`File ${filePath} is being seeded (torrent: ${torrent.name})`);
            return true;
          }
        }
      }

      return false;
    } catch (error: unknown) {
      this.logger.debug(`Torrent check failed for ${filePath}: ${error}`);
      return false; // Don't block on error
    }
  }

  /**
   * Get list of seeding files (for display/filtering)
   */
  async getSeedingFiles(): Promise<string[]> {
    const config = await this.getTorrentConfig();
    if (!config) return [];

    try {
      const torrents = await this.getActiveTorrents(config);
      const seedingFiles: string[] = [];

      for (const torrent of torrents) {
        if (!this.isTorrentSeeding(torrent)) {
          continue;
        }

        const files = await this.getTorrentFiles(config, torrent.hash);

        for (const file of files) {
          seedingFiles.push(`${torrent.savePath}/${file}`.replace(/\/+/g, '/'));
        }
      }

      return seedingFiles;
    } catch {
      return [];
    }
  }

  /**
   * Check if torrent is actively seeding
   */
  private isTorrentSeeding(torrent: TorrentInfo): boolean {
    // States that indicate active seeding (lowercase for comparison)
    const seedingStates = ['seeding', 'uploading', 'stalledup', 'forcedup', 'queuedup'];

    return seedingStates.includes(torrent.state.toLowerCase());
  }

  /**
   * Get active torrents from configured client
   */
  private async getActiveTorrents(config: TorrentConfig): Promise<TorrentInfo[]> {
    switch (config.client) {
      case TorrentClient.QBITTORRENT:
        return this.getQbittorrentTorrents(config);
      case TorrentClient.TRANSMISSION:
        return this.getTransmissionTorrents(config);
      case TorrentClient.DELUGE:
        return this.getDelugeTorrents(config);
      default:
        return [];
    }
  }

  /**
   * Get torrent files from configured client
   */
  private async getTorrentFiles(config: TorrentConfig, hash: string): Promise<string[]> {
    switch (config.client) {
      case TorrentClient.QBITTORRENT:
        return this.getQbittorrentFiles(config, hash);
      case TorrentClient.TRANSMISSION:
        return this.getTransmissionFiles(config, hash);
      case TorrentClient.DELUGE:
        return this.getDelugeFiles(config, hash);
      default:
        return [];
    }
  }

  // ========== qBittorrent Implementation ==========

  private async qbLogin(config: TorrentConfig): Promise<void> {
    if (this.qbCookie) return;

    const response = await firstValueFrom(
      this.httpService.post(
        `${config.url}/api/v2/auth/login`,
        `username=${encodeURIComponent(config.username || '')}&password=${encodeURIComponent(config.password || '')}`,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 5000,
        }
      )
    );

    const cookie = response.headers['set-cookie']?.[0];
    if (cookie) {
      this.qbCookie = cookie.split(';')[0];
    }
  }

  private async getQbittorrentTorrents(config: TorrentConfig): Promise<TorrentInfo[]> {
    await this.qbLogin(config);

    const response = await firstValueFrom(
      this.httpService.get(`${config.url}/api/v2/torrents/info`, {
        headers: { Cookie: this.qbCookie || '' },
        timeout: 10000,
      })
    );

    return ((response.data as QBittorrentTorrentResponse[]) || []).map((t) => ({
      hash: t.hash,
      name: t.name,
      state: t.state,
      progress: t.progress,
      ratio: t.ratio,
      savePath: t.save_path || t.content_path || '',
      files: [],
    }));
  }

  private async getQbittorrentFiles(config: TorrentConfig, hash: string): Promise<string[]> {
    await this.qbLogin(config);

    const response = await firstValueFrom(
      this.httpService.get(`${config.url}/api/v2/torrents/files?hash=${hash}`, {
        headers: { Cookie: this.qbCookie || '' },
        timeout: 10000,
      })
    );

    return ((response.data as QBittorrentFileResponse[]) || []).map((f) => f.name);
  }

  // ========== Transmission Implementation ==========

  private async getTransmissionTorrents(config: TorrentConfig): Promise<TorrentInfo[]> {
    const auth = config.username
      ? { username: config.username, password: config.password || '' }
      : undefined;

    // Get session ID first
    let sessionId = '';
    try {
      await firstValueFrom(
        this.httpService.post(`${config.url}/transmission/rpc`, {}, { auth, timeout: 5000 })
      );
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { headers?: Record<string, string> } };
        sessionId = axiosError.response?.headers?.['x-transmission-session-id'] || '';
      }
    }

    const response = await firstValueFrom(
      this.httpService.post(
        `${config.url}/transmission/rpc`,
        {
          method: 'torrent-get',
          arguments: {
            fields: ['hashString', 'name', 'status', 'percentDone', 'uploadRatio', 'downloadDir'],
          },
        },
        {
          auth,
          headers: { 'X-Transmission-Session-Id': sessionId },
          timeout: 10000,
        }
      )
    );

    const statusMap: Record<number, string> = {
      0: 'stopped',
      1: 'checkWait',
      2: 'checking',
      3: 'downloadWait',
      4: 'downloading',
      5: 'seedWait',
      6: 'seeding',
    };

    return ((response.data?.arguments?.torrents as TransmissionTorrentResponse[]) || []).map(
      (t) => ({
        hash: t.hashString,
        name: t.name,
        state: statusMap[t.status] || 'unknown',
        progress: t.percentDone,
        ratio: t.uploadRatio,
        savePath: t.downloadDir,
        files: [],
      })
    );
  }

  private async getTransmissionFiles(config: TorrentConfig, hash: string): Promise<string[]> {
    const auth = config.username
      ? { username: config.username, password: config.password || '' }
      : undefined;

    let sessionId = '';
    try {
      await firstValueFrom(
        this.httpService.post(`${config.url}/transmission/rpc`, {}, { auth, timeout: 5000 })
      );
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { headers?: Record<string, string> } };
        sessionId = axiosError.response?.headers?.['x-transmission-session-id'] || '';
      }
    }

    const response = await firstValueFrom(
      this.httpService.post(
        `${config.url}/transmission/rpc`,
        {
          method: 'torrent-get',
          arguments: { ids: [hash], fields: ['files'] },
        },
        {
          auth,
          headers: { 'X-Transmission-Session-Id': sessionId },
          timeout: 10000,
        }
      )
    );

    const torrent = response.data?.arguments?.torrents?.[0];
    return ((torrent?.files as TransmissionFileResponse[]) || []).map((f) => f.name);
  }

  // ========== Deluge Implementation ==========

  private async getDelugeTorrents(config: TorrentConfig): Promise<TorrentInfo[]> {
    // Deluge Web API login
    const loginResponse = await firstValueFrom(
      this.httpService.post(
        `${config.url}/json`,
        { method: 'auth.login', params: [config.password || ''], id: 1 },
        { timeout: 5000 }
      )
    );

    const cookie = loginResponse.headers['set-cookie']?.[0]?.split(';')[0];

    const response = await firstValueFrom(
      this.httpService.post(
        `${config.url}/json`,
        {
          method: 'web.update_ui',
          params: [['name', 'state', 'progress', 'ratio', 'save_path'], {}],
          id: 2,
        },
        {
          headers: { Cookie: cookie || '' },
          timeout: 10000,
        }
      )
    );

    const torrents = (response.data?.result?.torrents as Record<string, DelugeTorrentInfo>) || {};

    return Object.entries(torrents).map(([hash, t]) => ({
      hash,
      name: t.name,
      state: t.state,
      progress: t.progress / 100,
      ratio: t.ratio,
      savePath: t.save_path,
      files: [],
    }));
  }

  private async getDelugeFiles(config: TorrentConfig, hash: string): Promise<string[]> {
    const loginResponse = await firstValueFrom(
      this.httpService.post(
        `${config.url}/json`,
        { method: 'auth.login', params: [config.password || ''], id: 1 },
        { timeout: 5000 }
      )
    );

    const cookie = loginResponse.headers['set-cookie']?.[0]?.split(';')[0];

    const response = await firstValueFrom(
      this.httpService.post(
        `${config.url}/json`,
        {
          method: 'web.get_torrent_files',
          params: [hash],
          id: 2,
        },
        {
          headers: { Cookie: cookie || '' },
          timeout: 10000,
        }
      )
    );

    const extractFiles = (node: DelugeNodeContent, prefix = ''): string[] => {
      const files: string[] = [];
      if (node.type === 'file' && node.name) {
        files.push(prefix + node.name);
      } else if (node.contents) {
        for (const [name, child] of Object.entries(node.contents)) {
          files.push(...extractFiles(child, `${prefix + name}/`));
        }
      }
      return files;
    };

    return extractFiles((response.data?.result as DelugeNodeContent) || {});
  }

  /**
   * Get torrent client configuration from settings
   */
  private async getTorrentConfig(): Promise<TorrentConfig | null> {
    try {
      const settings = await this.settingsRepository.findFirst();

      if (!settings?.torrentClient || !settings?.torrentUrl) {
        return null;
      }

      return {
        client: settings.torrentClient as TorrentClient,
        url: settings.torrentUrl.replace(/\/$/, ''),
        username: settings.torrentUsername || undefined,
        password: settings.torrentPassword || undefined,
        skipSeeding: settings.skipSeeding ?? true,
      };
    } catch {
      return null;
    }
  }

  /**
   * Test torrent client connection
   */
  async testConnection(
    client: TorrentClient,
    url: string,
    username?: string,
    password?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const config: TorrentConfig = {
        client,
        url: url.replace(/\/$/, ''),
        username,
        password,
        skipSeeding: true,
      };

      const _torrents = await this.getActiveTorrents(config);

      return {
        success: true,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }
}

interface TorrentConfig {
  client: TorrentClient;
  url: string;
  username?: string;
  password?: string;
  skipSeeding: boolean;
}
