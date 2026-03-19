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
  });
});
