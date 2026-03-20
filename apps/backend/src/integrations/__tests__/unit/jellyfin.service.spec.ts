import { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { SettingsRepository } from '../../../common/repositories/settings.repository';
import { JellyfinIntegrationService } from '../../jellyfin.service';

describe('JellyfinIntegrationService', () => {
  let service: JellyfinIntegrationService;

  const mockSettingsRepository = {
    findFirst: jest.fn(),
  };

  const mockHttpService = {
    get: jest.fn(),
    post: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JellyfinIntegrationService,
        {
          provide: SettingsRepository,
          useValue: mockSettingsRepository,
        },
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
      ],
    }).compile();

    service = module.get<JellyfinIntegrationService>(JellyfinIntegrationService);
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });
  });

  describe('isConfigured', () => {
    it('should return false when no settings exist', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      const result = await service.isConfigured();

      expect(result).toBe(false);
    });

    it('should return false when Jellyfin URL is missing', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: null,
        jellyfinApiKey: 'api-key-123',
      });

      const result = await service.isConfigured();

      expect(result).toBe(false);
    });

    it('should return false when API key is missing', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: null,
      });

      const result = await service.isConfigured();

      expect(result).toBe(false);
    });

    it('should return true when both URL and API key are configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'api-key-123',
      });

      const result = await service.isConfigured();

      expect(result).toBe(true);
    });
  });

  describe('testConnection', () => {
    it('should return success with server info for valid connection', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            ServerName: 'My Jellyfin Server',
            Version: '10.8.0',
          },
        })
      );

      const result = await service.testConnection('http://localhost:8096', 'api-key-123');

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('My Jellyfin Server');
      expect(result.version).toBe('10.8.0');
      expect(result.error).toBeUndefined();
    });

    it('should return error for failed connection', async () => {
      mockHttpService.get.mockReturnValue(throwError(() => new Error('Connection refused')));

      const result = await service.testConnection('http://localhost:8096', 'api-key-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });

    it('should strip trailing slash from URL', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: { ServerName: 'Test', Version: '1.0' },
        })
      );

      await service.testConnection('http://localhost:8096/', 'api-key-123');

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'http://localhost:8096/System/Info',
        expect.objectContaining({
          headers: { 'X-Emby-Token': 'api-key-123' },
        })
      );
    });
  });

  describe('findFileByNameAndSize', () => {
    beforeEach(() => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'api-key-123',
      });
    });

    it('should return not found when Jellyfin is not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      const result = await service.findFileByNameAndSize('/media/movies/test.mkv', 1024);

      expect(result.found).toBe(false);
    });

    it('should return not found when no items match search', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: { Items: [] },
        })
      );

      const result = await service.findFileByNameAndSize('/media/movies/test.mkv', 1024);

      expect(result.found).toBe(false);
    });

    it('should find item with exact size match', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            Items: [
              {
                Id: 'item-123',
                Name: 'Test Movie',
                Path: '/media/movies/Test Movie (2024)/test.mkv',
                Type: 'Movie',
                Size: 1024,
              },
            ],
          },
        })
      );

      const result = await service.findFileByNameAndSize('/media/movies/test.mkv', 1024);

      expect(result.found).toBe(true);
      expect(result.itemId).toBe('item-123');
      expect(result.name).toBe('Test Movie');
      expect(result.path).toBe('/media/movies/Test Movie (2024)/test.mkv');
      expect(result.size).toBe(1024);
    });

    it('should find item within size tolerance (1KB)', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            Items: [
              {
                Id: 'item-123',
                Name: 'Test Movie',
                Path: '/media/movies/test.mkv',
                Type: 'Movie',
                Size: 1500, // Within 1024 bytes of expected
              },
            ],
          },
        })
      );

      const result = await service.findFileByNameAndSize('/media/movies/test.mkv', 1024);

      expect(result.found).toBe(true);
    });

    it('should find item in MediaSources array', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            Items: [
              {
                Id: 'item-123',
                Name: 'Test Movie',
                Type: 'Movie',
                MediaSources: [
                  {
                    Path: '/media/movies/test-version1.mkv',
                    Size: 5000,
                  },
                  {
                    Path: '/media/movies/test-version2.mkv',
                    Size: 1024,
                  },
                ],
              },
            ],
          },
        })
      );

      const result = await service.findFileByNameAndSize('/media/movies/test.mkv', 1024);

      expect(result.found).toBe(true);
      expect(result.path).toBe('/media/movies/test-version2.mkv');
    });

    it('should fallback to path similarity when no size match', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            Items: [
              {
                Id: 'item-123',
                Name: 'Test Movie',
                Path: '/media/movies/renamed.mkv',
                Type: 'Movie',
                Size: 999999, // Different size
              },
            ],
          },
        })
      );

      const result = await service.findFileByNameAndSize('/media/movies/test.mkv', 1024);

      expect(result.found).toBe(true);
      expect(result.path).toBe('/media/movies/renamed.mkv');
    });

    it('should return not found on API error', async () => {
      mockHttpService.get.mockReturnValue(throwError(() => new Error('API error')));

      const result = await service.findFileByNameAndSize('/media/movies/test.mkv', 1024);

      expect(result.found).toBe(false);
    });

    it('should handle bigint size parameter', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            Items: [
              {
                Id: 'item-123',
                Name: 'Test Movie',
                Path: '/media/movies/test.mkv',
                Type: 'Movie',
                Size: 1073741824,
              },
            ],
          },
        })
      );

      const result = await service.findFileByNameAndSize(
        '/media/movies/test.mkv',
        BigInt(1073741824)
      );

      expect(result.found).toBe(true);
    });
  });

  describe('getItemById', () => {
    it('should return null when Jellyfin is not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      const result = await service.getItemById('item-123');

      expect(result).toBeNull();
    });

    it('should return item data on success', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'api-key-123',
      });

      mockHttpService.get.mockReturnValue(
        of({
          data: {
            Id: 'item-123',
            Name: 'Test Movie',
            Path: '/media/movies/test.mkv',
            Type: 'Movie',
          },
        })
      );

      const result = await service.getItemById('item-123');

      expect(result).toEqual({
        Id: 'item-123',
        Name: 'Test Movie',
        Path: '/media/movies/test.mkv',
        Type: 'Movie',
      });
    });

    it('should return null on API error', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'api-key-123',
      });

      mockHttpService.get.mockReturnValue(throwError(() => new Error('Not found')));

      const result = await service.getItemById('item-123');

      expect(result).toBeNull();
    });
  });

  describe('refreshLibrary', () => {
    it('should not call API when Jellyfin is not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      await service.refreshLibrary();

      expect(mockHttpService.post).not.toHaveBeenCalled();
    });

    it('should not call API when refreshOnComplete is false', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'api-key-123',
        jellyfinRefreshOnComplete: false,
      });

      await service.refreshLibrary();

      expect(mockHttpService.post).not.toHaveBeenCalled();
    });

    it('should trigger library refresh when configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'api-key-123',
        jellyfinRefreshOnComplete: true,
      });

      mockHttpService.post.mockReturnValue(of({ data: {} }));

      await service.refreshLibrary();

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://localhost:8096/Library/Refresh',
        {},
        expect.objectContaining({
          headers: { 'X-Emby-Token': 'api-key-123' },
        })
      );
    });

    it('should default refreshOnComplete to true when undefined', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'api-key-123',
        // jellyfinRefreshOnComplete not set
      });

      mockHttpService.post.mockReturnValue(of({ data: {} }));

      await service.refreshLibrary();

      expect(mockHttpService.post).toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'api-key-123',
        jellyfinRefreshOnComplete: true,
      });

      mockHttpService.post.mockReturnValue(throwError(() => new Error('API error')));

      // Should not throw
      await expect(service.refreshLibrary()).resolves.not.toThrow();
    });
  });

  describe('search term extraction', () => {
    beforeEach(() => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'api-key-123',
      });
    });

    it('should extract clean title from complex filename', async () => {
      mockHttpService.get.mockReturnValue(of({ data: { Items: [] } }));

      await service.findFileByNameAndSize(
        '/media/movies/The.Matrix.1999.2160p.UHD.BluRay.REMUX.HDR.HEVC.DTS-HD.MA.7.1-GROUP.mkv',
        1024
      );

      // Check that the search was made with cleaned title
      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.stringContaining('/Items'),
        expect.objectContaining({
          params: expect.objectContaining({
            searchTerm: expect.stringMatching(/Matrix/i),
          }),
        })
      );
    });

    it('should handle year in brackets', async () => {
      mockHttpService.get.mockReturnValue(of({ data: { Items: [] } }));

      await service.findFileByNameAndSize('/media/movies/Inception (2010).mkv', 1024);

      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.stringContaining('/Items'),
        expect.objectContaining({
          params: expect.objectContaining({
            searchTerm: 'Inception',
          }),
        })
      );
    });

    it('should handle underscores and dots as separators', async () => {
      mockHttpService.get.mockReturnValue(of({ data: { Items: [] } }));

      await service.findFileByNameAndSize('/media/movies/The_Dark_Knight.mkv', 1024);

      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.stringContaining('/Items'),
        expect.objectContaining({
          params: expect.objectContaining({
            searchTerm: expect.stringMatching(/Dark Knight/i),
          }),
        })
      );
    });
  });

  describe('path similarity', () => {
    beforeEach(() => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'api-key-123',
      });
    });

    it('should match files in same directory', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            Items: [
              {
                Id: 'item-123',
                Name: 'Test Movie',
                Path: '/media/movies/collection/renamed.mkv',
                Type: 'Movie',
                Size: 999999,
              },
            ],
          },
        })
      );

      const result = await service.findFileByNameAndSize(
        '/media/movies/collection/original.mkv',
        1024
      );

      expect(result.found).toBe(true);
    });

    it('should not match files in completely different directories', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            Items: [
              {
                Id: 'item-123',
                Name: 'Test Movie',
                Path: '/other/location/file.mkv',
                Type: 'Movie',
                Size: 999999,
              },
            ],
          },
        })
      );

      const result = await service.findFileByNameAndSize('/media/movies/original.mkv', 1024);

      expect(result.found).toBe(false);
    });
  });

  describe('findFileByNameAndSize – additional branches', () => {
    beforeEach(() => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'api-key-123',
      });
    });

    it('should return not found when items have no Path and no MediaSources', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            Items: [{ Id: 'item-1', Name: 'No Path Movie', Type: 'Movie' }],
          },
        })
      );

      const result = await service.findFileByNameAndSize('/media/movies/nope.mkv', 1024);

      expect(result.found).toBe(false);
    });

    it('should skip MediaSource entries missing Path or Size', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            Items: [
              {
                Id: 'item-1',
                Name: 'Partial Sources',
                Type: 'Movie',
                Size: 999999,
                MediaSources: [
                  { Path: '/media/a.mkv' }, // no Size
                  { Size: 500 }, // no Path
                ],
              },
            ],
          },
        })
      );

      // none match by size; none have valid path+size in MediaSources; path dissimilar
      const result = await service.findFileByNameAndSize('/totally/different/path.mkv', 1024);

      expect(result.found).toBe(false);
    });

    it('should handle response.data with no Items key (undefined)', async () => {
      mockHttpService.get.mockReturnValue(of({ data: {} }));

      const result = await service.findFileByNameAndSize('/media/movies/test.mkv', 1024);

      expect(result.found).toBe(false);
    });

    it('should use MediaSources first path for path-similarity fallback', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            Items: [
              {
                Id: 'item-via-source',
                Name: 'Source Movie',
                Type: 'Movie',
                MediaSources: [{ Path: '/media/movies/collection/source.mkv', Size: 99999 }],
              },
            ],
          },
        })
      );

      const result = await service.findFileByNameAndSize(
        '/media/movies/collection/original.mkv',
        1024
      );

      expect(result.found).toBe(true);
      expect(result.path).toBe('/media/movies/collection/source.mkv');
    });

    it('should return not found when settingsRepository throws', async () => {
      mockSettingsRepository.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.findFileByNameAndSize('/media/movies/test.mkv', 1024);

      expect(result.found).toBe(false);
    });
  });

  describe('getItemById – additional branches', () => {
    it('should strip trailing slash from Jellyfin URL', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096/',
        jellyfinApiKey: 'key-abc',
      });
      mockHttpService.get.mockReturnValue(of({ data: { Id: 'x', Name: 'X', Type: 'Movie' } }));

      await service.getItemById('x');

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'http://localhost:8096/Items/x',
        expect.anything()
      );
    });
  });

  describe('testConnection – additional branches', () => {
    it('should return success with undefined serverName/version when fields absent', async () => {
      mockHttpService.get.mockReturnValue(of({ data: {} }));

      const result = await service.testConnection('http://localhost:8096', 'key');

      expect(result.success).toBe(true);
      expect(result.serverName).toBeUndefined();
      expect(result.version).toBeUndefined();
    });
  });

  describe('refreshLibrary – additional branches', () => {
    it('should handle non-Error thrown by post gracefully', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'api-key-123',
        jellyfinRefreshOnComplete: true,
      });

      mockHttpService.post.mockReturnValue(throwError(() => 'string error'));

      await expect(service.refreshLibrary()).resolves.not.toThrow();
    });
  });

  describe('search term extraction – additional branches', () => {
    beforeEach(() => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'api-key-123',
      });
    });

    it('should strip release group suffix', async () => {
      mockHttpService.get.mockReturnValue(of({ data: { Items: [] } }));

      await service.findFileByNameAndSize('/media/Interstellar-YIFY.mkv', 1024);

      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.stringContaining('/Items'),
        expect.objectContaining({
          params: expect.objectContaining({
            searchTerm: expect.not.stringContaining('YIFY'),
          }),
        })
      );
    });

    it('should remove bracket content from filename', async () => {
      mockHttpService.get.mockReturnValue(of({ data: { Items: [] } }));

      await service.findFileByNameAndSize('/media/Dune [4K Remaster].mkv', 1024);

      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.stringContaining('/Items'),
        expect.objectContaining({
          params: expect.objectContaining({
            searchTerm: expect.not.stringContaining('4K Remaster'),
          }),
        })
      );
    });
  });
});
