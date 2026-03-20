import { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { SettingsRepository } from '../../../common/repositories/settings.repository';
import { MediaServerType, RadarrSonarrIntegrationService } from '../../radarr-sonarr.service';

describe('RadarrSonarrIntegrationService', () => {
  let service: RadarrSonarrIntegrationService;

  const mockSettingsRepository = {
    findFirst: jest.fn(),
  };

  const mockHttpService = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadarrSonarrIntegrationService,
        { provide: SettingsRepository, useValue: mockSettingsRepository },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    service = module.get<RadarrSonarrIntegrationService>(RadarrSonarrIntegrationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRadarrMovies', () => {
    it('should return empty array when Radarr not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      const result = await service.getRadarrMovies();

      expect(result).toEqual([]);
    });

    it('should return mapped movies on success', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(
        of({
          data: [
            {
              id: 1,
              title: 'The Matrix',
              path: '/movies/The Matrix',
              sizeOnDisk: 5000000,
              hasFile: true,
              monitored: true,
              qualityProfileId: 1,
            },
          ],
        })
      );

      const result = await service.getRadarrMovies();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        title: 'The Matrix',
        path: '/movies/The Matrix',
        sizeOnDisk: 5000000,
        hasFile: true,
        monitored: true,
        qualityProfileId: 1,
      });
    });

    it('should return empty array on API error', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(throwError(() => new Error('timeout')));

      const result = await service.getRadarrMovies();

      expect(result).toEqual([]);
    });
  });

  describe('getSonarrSeries', () => {
    it('should return empty array when Sonarr not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      const result = await service.getSonarrSeries();

      expect(result).toEqual([]);
    });

    it('should map hasFile from episodeFileCount', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        sonarrUrl: 'http://sonarr:8989',
        sonarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(
        of({
          data: [
            {
              id: 1,
              title: 'Breaking Bad',
              path: '/tv/Breaking Bad',
              sizeOnDisk: 10000000,
              statistics: { episodeFileCount: 5 },
              monitored: true,
              qualityProfileId: 2,
            },
            {
              id: 2,
              title: 'Empty Show',
              path: '/tv/Empty Show',
              sizeOnDisk: 0,
              statistics: { episodeFileCount: 0 },
              monitored: false,
              qualityProfileId: 1,
            },
          ],
        })
      );

      const result = await service.getSonarrSeries();

      expect(result[0].hasFile).toBe(true);
      expect(result[1].hasFile).toBe(false);
    });
  });

  describe('triggerRadarrRescan', () => {
    it('should not call API when not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      await service.triggerRadarrRescan(1);

      expect(mockHttpService.post).not.toHaveBeenCalled();
    });

    it('should send RescanMovie command', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
      });
      mockHttpService.post.mockReturnValue(of({ data: {} }));

      await service.triggerRadarrRescan(42);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://radarr:7878/api/v3/command',
        { name: 'RescanMovie', movieId: 42 },
        expect.objectContaining({
          headers: { 'X-Api-Key': 'api-key' },
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
      });
      mockHttpService.post.mockReturnValue(throwError(() => new Error('timeout')));

      await expect(service.triggerRadarrRescan(1)).resolves.not.toThrow();
    });
  });

  describe('triggerSonarrRescan', () => {
    it('should send RescanSeries command', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        sonarrUrl: 'http://sonarr:8989',
        sonarrApiKey: 'api-key',
      });
      mockHttpService.post.mockReturnValue(of({ data: {} }));

      await service.triggerSonarrRescan(7);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://sonarr:8989/api/v3/command',
        { name: 'RescanSeries', seriesId: 7 },
        expect.any(Object)
      );
    });
  });

  describe('shouldSkipFile', () => {
    it('should not skip when Radarr not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      const result = await service.shouldSkipFile('/movies/test.mkv');

      expect(result.skip).toBe(false);
    });

    it('should skip HEVC files when skipQualityMet is true', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
        radarrSkipQualityMet: true,
      });
      // getRadarrMovieFile calls get on /api/v3/movie
      mockHttpService.get.mockReturnValue(
        of({
          data: [
            {
              movieFile: {
                id: 1,
                path: '/movies/test.mkv',
                size: 1024,
                quality: { quality: { name: 'Bluray-1080p', resolution: 1080 } },
                mediaInfo: { videoCodec: 'HEVC', audioCodec: 'AAC', videoBitrate: 5000 },
              },
            },
          ],
        })
      );

      const result = await service.shouldSkipFile('/movies/test.mkv');

      expect(result.skip).toBe(true);
      expect(result.reason).toContain('HEVC');
    });

    it('should not skip non-HEVC files', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
        radarrSkipQualityMet: true,
      });
      mockHttpService.get.mockReturnValue(
        of({
          data: [
            {
              movieFile: {
                id: 1,
                path: '/movies/test.mkv',
                size: 1024,
                quality: { quality: { name: 'Bluray-1080p', resolution: 1080 } },
                mediaInfo: { videoCodec: 'AVC', audioCodec: 'AAC', videoBitrate: 5000 },
              },
            },
          ],
        })
      );

      const result = await service.shouldSkipFile('/movies/test.mkv');

      expect(result.skip).toBe(false);
    });
  });

  describe('testConnection', () => {
    it('should return success with version', async () => {
      mockHttpService.get.mockReturnValue(of({ data: { version: '4.7.5.7726' } }));

      const result = await service.testConnection(
        MediaServerType.RADARR,
        'http://radarr:7878',
        'api-key'
      );

      expect(result.success).toBe(true);
      expect(result.version).toBe('4.7.5.7726');
    });

    it('should return error on failure', async () => {
      mockHttpService.get.mockReturnValue(throwError(() => new Error('Connection refused')));

      const result = await service.testConnection(
        MediaServerType.SONARR,
        'http://sonarr:8989',
        'bad-key'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });
  });

  describe('getRadarrQualityProfiles', () => {
    it('should return empty array when not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      const result = await service.getRadarrQualityProfiles();

      expect(result).toEqual([]);
    });

    it('should return mapped quality profiles', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(
        of({
          data: [
            { id: 1, name: 'HD-1080p' },
            { id: 2, name: '4K' },
          ],
        })
      );

      const result = await service.getRadarrQualityProfiles();

      expect(result).toEqual([
        { id: 1, name: 'HD-1080p' },
        { id: 2, name: '4K' },
      ]);
    });
  });

  describe('registerWebhooks', () => {
    it('should return error when not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      const result = await service.registerWebhooks(
        MediaServerType.RADARR,
        'http://localhost:3000/webhook'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not configured');
    });

    it('should create new webhook when none exists', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
      });
      // List existing notifications
      mockHttpService.get.mockReturnValue(of({ data: [] }));
      // Create new
      mockHttpService.post.mockReturnValue(of({ data: {} }));

      const result = await service.registerWebhooks(
        MediaServerType.RADARR,
        'http://localhost:3000/webhook'
      );

      expect(result.success).toBe(true);
      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://radarr:7878/api/v3/notification',
        expect.objectContaining({ name: 'BitBonsai' }),
        expect.any(Object)
      );
    });

    it('should update existing webhook', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(of({ data: [{ id: 99, name: 'BitBonsai' }] }));
      mockHttpService.put.mockReturnValue(of({ data: {} }));

      const result = await service.registerWebhooks(
        MediaServerType.RADARR,
        'http://localhost:3000/webhook'
      );

      expect(result.success).toBe(true);
      expect(mockHttpService.put).toHaveBeenCalledWith(
        'http://radarr:7878/api/v3/notification/99',
        expect.objectContaining({ id: 99, name: 'BitBonsai' }),
        expect.any(Object)
      );
    });

    it('should return error with message when API throws Error', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(throwError(() => new Error('Unauthorized')));

      const result = await service.registerWebhooks(
        MediaServerType.RADARR,
        'http://localhost:3000/webhook'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unauthorized');
    });

    it('should return generic error message for non-Error throws', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(throwError(() => 'string error'));

      const result = await service.registerWebhooks(
        MediaServerType.RADARR,
        'http://localhost:3000/webhook'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to register webhook');
    });

    it('should set onMovieFileDelete=true and onEpisodeFileDelete=false for RADARR', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(of({ data: [] }));
      mockHttpService.post.mockReturnValue(of({ data: {} }));

      await service.registerWebhooks(MediaServerType.RADARR, 'http://cb/webhook');

      expect(mockHttpService.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ onMovieFileDelete: true, onEpisodeFileDelete: false }),
        expect.any(Object)
      );
    });

    it('should set onEpisodeFileDelete=true and onMovieFileDelete=false for SONARR', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        sonarrUrl: 'http://sonarr:8989',
        sonarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(of({ data: [] }));
      mockHttpService.post.mockReturnValue(of({ data: {} }));

      await service.registerWebhooks(MediaServerType.SONARR, 'http://cb/webhook');

      expect(mockHttpService.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ onEpisodeFileDelete: true, onMovieFileDelete: false }),
        expect.any(Object)
      );
    });
  });

  describe('getSonarrQualityProfiles', () => {
    it('should return empty array when not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      const result = await service.getSonarrQualityProfiles();

      expect(result).toEqual([]);
    });

    it('should return mapped quality profiles from Sonarr', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        sonarrUrl: 'http://sonarr:8989',
        sonarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(of({ data: [{ id: 3, name: 'WEB-DL 1080p' }] }));

      const result = await service.getSonarrQualityProfiles();

      expect(result).toEqual([{ id: 3, name: 'WEB-DL 1080p' }]);
    });

    it('should return empty array on API error', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        sonarrUrl: 'http://sonarr:8989',
        sonarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(throwError(() => new Error('timeout')));

      const result = await service.getSonarrQualityProfiles();

      expect(result).toEqual([]);
    });
  });

  describe('getRadarrQualityProfiles', () => {
    it('should return empty array on API error', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(throwError(() => new Error('timeout')));

      const result = await service.getRadarrQualityProfiles();

      expect(result).toEqual([]);
    });
  });

  describe('getRadarrMovieFile', () => {
    it('should return null when not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      const result = await service.getRadarrMovieFile('/movies/test.mkv');

      expect(result).toBeNull();
    });

    it('should return null when no movie matches path', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(
        of({ data: [{ movieFile: { path: '/movies/other.mkv' } }] })
      );

      const result = await service.getRadarrMovieFile('/movies/test.mkv');

      expect(result).toBeNull();
    });

    it('should return file info when movie path matches', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
      });
      const movieFile = {
        id: 5,
        path: '/movies/test.mkv',
        size: 2048,
        quality: { quality: { name: 'Bluray-1080p', resolution: 1080 } },
        mediaInfo: { videoCodec: 'AVC', audioCodec: 'DTS', videoBitrate: 8000 },
      };
      mockHttpService.get.mockReturnValue(of({ data: [{ movieFile }] }));

      const result = await service.getRadarrMovieFile('/movies/test.mkv');

      expect(result).toEqual({
        id: 5,
        path: '/movies/test.mkv',
        size: 2048,
        quality: movieFile.quality,
        mediaInfo: movieFile.mediaInfo,
      });
    });

    it('should return null on API error', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(throwError(() => new Error('network error')));

      const result = await service.getRadarrMovieFile('/movies/test.mkv');

      expect(result).toBeNull();
    });
  });

  describe('notifyFileChanged', () => {
    it('should trigger Radarr rescan when file belongs to a Radarr movie', async () => {
      mockSettingsRepository.findFirst
        .mockResolvedValueOnce({
          radarrUrl: 'http://radarr:7878',
          radarrApiKey: 'api-key',
        })
        .mockResolvedValueOnce({
          radarrUrl: 'http://radarr:7878',
          radarrApiKey: 'api-key',
        })
        .mockResolvedValue({
          radarrUrl: 'http://radarr:7878',
          radarrApiKey: 'api-key',
        });

      mockHttpService.get.mockReturnValue(
        of({
          data: [
            {
              id: 10,
              title: 'The Matrix',
              path: '/movies/The Matrix',
              sizeOnDisk: 5000000,
              hasFile: true,
              monitored: true,
              qualityProfileId: 1,
            },
          ],
        })
      );
      mockHttpService.post.mockReturnValue(of({ data: {} }));

      await service.notifyFileChanged('/movies/The Matrix/matrix.mkv');

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://radarr:7878/api/v3/command',
        { name: 'RescanMovie', movieId: 10 },
        expect.any(Object)
      );
    });

    it('should trigger Sonarr rescan when file is not in Radarr but matches Sonarr series', async () => {
      // findFirst always returns sonarr-only settings.
      // getConfig(RADARR) sees no radarrUrl → returns null → skips radarr block.
      // getConfig(SONARR) (×3: notifyFileChanged, getSonarrSeries, triggerSonarrRescan) all succeed.
      mockSettingsRepository.findFirst.mockResolvedValue({
        sonarrUrl: 'http://sonarr:8989',
        sonarrApiKey: 'api-key',
      });

      mockHttpService.get.mockReturnValue(
        of({
          data: [
            {
              id: 7,
              title: 'Breaking Bad',
              path: '/tv/Breaking Bad',
              sizeOnDisk: 10000000,
              statistics: { episodeFileCount: 5 },
              monitored: true,
              qualityProfileId: 2,
            },
          ],
        })
      );
      mockHttpService.post.mockReturnValue(of({ data: {} }));

      await service.notifyFileChanged('/tv/Breaking Bad/S01E01.mkv');

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://sonarr:8989/api/v3/command',
        { name: 'RescanSeries', seriesId: 7 },
        expect.any(Object)
      );
    });

    it('should do nothing when file does not match any library', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      await service.notifyFileChanged('/unknown/path/file.mkv');

      expect(mockHttpService.post).not.toHaveBeenCalled();
    });
  });

  describe('shouldSkipFile', () => {
    it('should not skip when skipQualityMet is false', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
        radarrSkipQualityMet: false,
      });

      const result = await service.shouldSkipFile('/movies/test.mkv');

      expect(result.skip).toBe(false);
    });

    it('should skip AV1 files when skipQualityMet is true', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
        radarrSkipQualityMet: true,
      });
      mockHttpService.get.mockReturnValue(
        of({
          data: [
            {
              movieFile: {
                id: 2,
                path: '/movies/test.mkv',
                size: 512,
                quality: { quality: { name: 'Bluray-4K', resolution: 2160 } },
                mediaInfo: { videoCodec: 'AV1', audioCodec: 'AAC', videoBitrate: 3000 },
              },
            },
          ],
        })
      );

      const result = await service.shouldSkipFile('/movies/test.mkv');

      expect(result.skip).toBe(true);
      expect(result.reason).toContain('AV1');
    });

    it('should not skip when movie file has no mediaInfo', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'api-key',
        radarrSkipQualityMet: true,
      });
      mockHttpService.get.mockReturnValue(of({ data: [] }));

      const result = await service.shouldSkipFile('/movies/test.mkv');

      expect(result.skip).toBe(false);
    });
  });

  describe('triggerSonarrRescan', () => {
    it('should not call API when Sonarr not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      await service.triggerSonarrRescan(1);

      expect(mockHttpService.post).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        sonarrUrl: 'http://sonarr:8989',
        sonarrApiKey: 'api-key',
      });
      mockHttpService.post.mockReturnValue(throwError(() => new Error('timeout')));

      await expect(service.triggerSonarrRescan(1)).resolves.not.toThrow();
    });
  });

  describe('getSonarrSeries', () => {
    it('should return empty array on API error', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        sonarrUrl: 'http://sonarr:8989',
        sonarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(throwError(() => new Error('timeout')));

      const result = await service.getSonarrSeries();

      expect(result).toEqual([]);
    });

    it('should set hasFile=false when statistics is missing', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        sonarrUrl: 'http://sonarr:8989',
        sonarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(
        of({
          data: [
            {
              id: 3,
              title: 'No Stats Show',
              path: '/tv/No Stats Show',
              sizeOnDisk: 0,
              monitored: true,
              qualityProfileId: 1,
              // statistics intentionally absent
            },
          ],
        })
      );

      const result = await service.getSonarrSeries();

      expect(result[0].hasFile).toBe(false);
    });
  });

  describe('getConfig (via Whisparr path)', () => {
    it('should return null when Whisparr URL is missing', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        whisparrUrl: null,
        whisparrApiKey: 'api-key',
      });

      // testConnection with Whisparr uses httpService directly, so proxy via
      // getRadarrMovies to indirectly test getConfig returning null for missing URL
      // Instead, confirm registerWebhooks returns "Not configured" for Whisparr
      const result = await service.registerWebhooks(MediaServerType.WHISPARR, 'http://cb/webhook');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not configured');
    });

    it('should strip trailing slash from URL', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        radarrUrl: 'http://radarr:7878/',
        radarrApiKey: 'api-key',
      });
      mockHttpService.get.mockReturnValue(of({ data: [] }));

      const result = await service.getRadarrMovies();

      expect(result).toEqual([]);
      expect(mockHttpService.get).toHaveBeenCalledWith(
        'http://radarr:7878/api/v3/movie',
        expect.any(Object)
      );
    });

    it('should return null when findFirst throws during getConfig', async () => {
      mockSettingsRepository.findFirst.mockRejectedValue(new Error('DB error'));

      // getRadarrMovies → getConfig → catch → returns null → returns []
      const result = await service.getRadarrMovies();

      expect(result).toEqual([]);
    });

    it('should return null when Whisparr API key is missing', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        whisparrUrl: 'http://whisparr:6969',
        whisparrApiKey: null,
      });

      const result = await service.registerWebhooks(MediaServerType.WHISPARR, 'http://cb/webhook');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not configured');
    });

    it('should use Whisparr config for registerWebhooks when fully configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        whisparrUrl: 'http://whisparr:6969',
        whisparrApiKey: 'whisparr-key',
      });
      mockHttpService.get.mockReturnValue(of({ data: [] }));
      mockHttpService.post.mockReturnValue(of({ data: {} }));

      const result = await service.registerWebhooks(MediaServerType.WHISPARR, 'http://cb/webhook');

      expect(result.success).toBe(true);
      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://whisparr:6969/api/v3/notification',
        expect.objectContaining({ name: 'BitBonsai' }),
        expect.any(Object)
      );
    });
  });

  describe('notifyFileChanged - Radarr throws fallthrough', () => {
    it('should fall through to Sonarr when Radarr getMovies throws', async () => {
      // First call (getConfig RADARR) returns radarr config
      // Second call (getRadarrMovies via get) throws
      // Third call (getConfig SONARR) returns sonarr config
      // Fourth call (getSonarrSeries via get) returns a match
      mockSettingsRepository.findFirst
        .mockResolvedValueOnce({ radarrUrl: 'http://radarr:7878', radarrApiKey: 'key' })
        .mockResolvedValueOnce({ radarrUrl: 'http://radarr:7878', radarrApiKey: 'key' })
        .mockResolvedValueOnce({ sonarrUrl: 'http://sonarr:8989', sonarrApiKey: 'key' })
        .mockResolvedValueOnce({ sonarrUrl: 'http://sonarr:8989', sonarrApiKey: 'key' })
        .mockResolvedValue({ sonarrUrl: 'http://sonarr:8989', sonarrApiKey: 'key' });

      mockHttpService.get
        .mockReturnValueOnce(throwError(() => new Error('Radarr unavailable')))
        .mockReturnValue(
          of({
            data: [
              {
                id: 5,
                title: 'The Wire',
                path: '/tv/The Wire',
                sizeOnDisk: 8000000,
                statistics: { episodeFileCount: 3 },
                monitored: true,
                qualityProfileId: 1,
              },
            ],
          })
        );
      mockHttpService.post.mockReturnValue(of({ data: {} }));

      await service.notifyFileChanged('/tv/The Wire/S01E01.mkv');

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://sonarr:8989/api/v3/command',
        { name: 'RescanSeries', seriesId: 5 },
        expect.any(Object)
      );
    });

    it('should do nothing when file matches no series in Sonarr either', async () => {
      mockSettingsRepository.findFirst
        .mockResolvedValueOnce({ radarrUrl: 'http://radarr:7878', radarrApiKey: 'key' })
        .mockResolvedValueOnce({ radarrUrl: 'http://radarr:7878', radarrApiKey: 'key' })
        .mockResolvedValueOnce({ sonarrUrl: 'http://sonarr:8989', sonarrApiKey: 'key' })
        .mockResolvedValue({ sonarrUrl: 'http://sonarr:8989', sonarrApiKey: 'key' });

      // Radarr returns no matching movie, Sonarr returns no matching series
      mockHttpService.get.mockReturnValue(of({ data: [] }));

      await service.notifyFileChanged('/unknown/path/file.mkv');

      expect(mockHttpService.post).not.toHaveBeenCalled();
    });
  });
});
