import { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { TorrentClient, TorrentIntegrationService } from '../../torrent.service';

describe('TorrentIntegrationService', () => {
  let service: TorrentIntegrationService;
  let _httpService: jest.Mocked<HttpService>;

  const mockPrismaService = {
    settings: {
      findFirst: jest.fn(),
    },
  };

  const mockHttpService = {
    get: jest.fn(),
    post: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TorrentIntegrationService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
      ],
    }).compile();

    service = module.get<TorrentIntegrationService>(TorrentIntegrationService);
    _httpService = module.get(HttpService);
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });
  });

  describe('isFileSeeding', () => {
    it('should return false when no torrent config', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue(null);

      const result = await service.isFileSeeding('/media/movies/test.mkv');

      expect(result).toBe(false);
    });

    it('should return false when torrent client not configured', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({
        torrentClient: null,
        torrentUrl: null,
      });

      const result = await service.isFileSeeding('/media/movies/test.mkv');

      expect(result).toBe(false);
    });

    it('should return true when file is being seeded in qBittorrent', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.QBITTORRENT,
        torrentUrl: 'http://localhost:8080',
        torrentUsername: 'admin',
        torrentPassword: 'password',
        skipSeeding: true,
      });

      // Mock login
      mockHttpService.post.mockReturnValueOnce(
        of({
          headers: { 'set-cookie': ['SID=abc123; path=/'] },
          data: 'Ok.',
        })
      );

      // Mock torrents list
      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [
            {
              hash: 'abc123',
              name: 'Test.Movie.2024',
              state: 'seeding',
              progress: 1,
              ratio: 2.5,
              save_path: '/media/movies',
            },
          ],
        })
      );

      // Mock files list
      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [{ name: 'test.mkv' }],
        })
      );

      const result = await service.isFileSeeding('/media/movies/test.mkv');

      expect(result).toBe(true);
    });

    it('should return false when file is not in any torrent', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.QBITTORRENT,
        torrentUrl: 'http://localhost:8080',
        torrentUsername: 'admin',
        torrentPassword: 'password',
        skipSeeding: true,
      });

      // Mock login
      mockHttpService.post.mockReturnValueOnce(
        of({
          headers: { 'set-cookie': ['SID=abc123; path=/'] },
          data: 'Ok.',
        })
      );

      // Mock torrents list
      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [
            {
              hash: 'abc123',
              name: 'Different.Movie.2024',
              state: 'seeding',
              progress: 1,
              ratio: 2.5,
              save_path: '/media/movies',
            },
          ],
        })
      );

      // Mock files list
      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [{ name: 'different.mkv' }],
        })
      );

      const result = await service.isFileSeeding('/media/movies/test.mkv');

      expect(result).toBe(false);
    });

    it('should return false when torrent is not seeding', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.QBITTORRENT,
        torrentUrl: 'http://localhost:8080',
        skipSeeding: true,
      });

      // Mock login
      mockHttpService.post.mockReturnValueOnce(
        of({
          headers: { 'set-cookie': ['SID=abc123; path=/'] },
          data: 'Ok.',
        })
      );

      // Mock torrents list - downloading state, not seeding
      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [
            {
              hash: 'abc123',
              name: 'Test.Movie.2024',
              state: 'downloading',
              progress: 0.5,
              ratio: 0,
              save_path: '/media/movies',
            },
          ],
        })
      );

      const result = await service.isFileSeeding('/media/movies/test.mkv');

      expect(result).toBe(false);
    });

    it('should return false on connection error', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.QBITTORRENT,
        torrentUrl: 'http://localhost:8080',
        skipSeeding: true,
      });

      // Mock login failure
      mockHttpService.post.mockReturnValueOnce(throwError(() => new Error('Connection refused')));

      const result = await service.isFileSeeding('/media/movies/test.mkv');

      expect(result).toBe(false); // Should not block on error
    });
  });

  describe('getSeedingFiles', () => {
    it('should return empty array when no config', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue(null);

      const result = await service.getSeedingFiles();

      expect(result).toEqual([]);
    });

    it('should return list of seeding files', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.QBITTORRENT,
        torrentUrl: 'http://localhost:8080',
        skipSeeding: true,
      });

      // Mock login
      mockHttpService.post.mockReturnValueOnce(
        of({
          headers: { 'set-cookie': ['SID=abc123; path=/'] },
          data: 'Ok.',
        })
      );

      // Mock torrents list
      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [
            {
              hash: 'abc123',
              name: 'Test.Movie.2024',
              state: 'seeding',
              progress: 1,
              ratio: 2.5,
              save_path: '/media/movies',
            },
          ],
        })
      );

      // Mock files list
      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [{ name: 'movie1.mkv' }, { name: 'movie2.mkv' }],
        })
      );

      const result = await service.getSeedingFiles();

      expect(result).toContain('/media/movies/movie1.mkv');
      expect(result).toContain('/media/movies/movie2.mkv');
    });

    it('should return empty array on error', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.QBITTORRENT,
        torrentUrl: 'http://localhost:8080',
        skipSeeding: true,
      });

      mockHttpService.post.mockReturnValueOnce(throwError(() => new Error('Connection refused')));

      const result = await service.getSeedingFiles();

      expect(result).toEqual([]);
    });
  });

  describe('testConnection', () => {
    it('should return success for valid qBittorrent connection', async () => {
      // Mock login
      mockHttpService.post.mockReturnValueOnce(
        of({
          headers: { 'set-cookie': ['SID=abc123; path=/'] },
          data: 'Ok.',
        })
      );

      // Mock torrents list
      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [],
        })
      );

      const result = await service.testConnection(
        TorrentClient.QBITTORRENT,
        'http://localhost:8080',
        'admin',
        'password'
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return error for failed connection', async () => {
      mockHttpService.post.mockReturnValueOnce(throwError(() => new Error('Connection refused')));

      const result = await service.testConnection(
        TorrentClient.QBITTORRENT,
        'http://localhost:8080',
        'admin',
        'password'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });

    it('should handle Transmission client', async () => {
      // First request fails with session ID in headers (normal Transmission behavior)
      mockHttpService.post.mockReturnValueOnce(
        throwError(() => ({
          response: {
            headers: { 'x-transmission-session-id': 'session123' },
          },
        }))
      );

      // Second request succeeds with torrents
      mockHttpService.post.mockReturnValueOnce(
        of({
          data: {
            arguments: {
              torrents: [],
            },
          },
        })
      );

      const result = await service.testConnection(
        TorrentClient.TRANSMISSION,
        'http://localhost:9091',
        'admin',
        'password'
      );

      expect(result.success).toBe(true);
    });

    it('should handle Deluge client', async () => {
      // Mock login
      mockHttpService.post.mockReturnValueOnce(
        of({
          headers: { 'set-cookie': ['_session_id=abc123; path=/'] },
          data: { result: true },
        })
      );

      // Mock torrents list
      mockHttpService.post.mockReturnValueOnce(
        of({
          data: {
            result: {
              torrents: {},
            },
          },
        })
      );

      const result = await service.testConnection(
        TorrentClient.DELUGE,
        'http://localhost:8112',
        undefined,
        'deluge'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('seeding state detection', () => {
    // Test with qBittorrent's actual mixed-case states
    const seedingStates = ['seeding', 'uploading', 'stalledUP', 'forcedUP', 'queuedUP'];
    const nonSeedingStates = ['downloading', 'paused', 'checking', 'error', 'stopped'];

    seedingStates.forEach((state) => {
      it(`should detect ${state} as seeding`, async () => {
        mockPrismaService.settings.findFirst.mockResolvedValue({
          torrentClient: TorrentClient.QBITTORRENT,
          torrentUrl: 'http://localhost:8080',
          skipSeeding: true,
        });

        mockHttpService.post.mockReturnValueOnce(
          of({
            headers: { 'set-cookie': ['SID=abc123; path=/'] },
            data: 'Ok.',
          })
        );

        mockHttpService.get.mockReturnValueOnce(
          of({
            data: [
              {
                hash: 'abc123',
                name: 'Test',
                state: state,
                progress: 1,
                ratio: 1,
                save_path: '/media',
              },
            ],
          })
        );

        mockHttpService.get.mockReturnValueOnce(
          of({
            data: [{ name: 'test.mkv' }],
          })
        );

        const result = await service.isFileSeeding('/media/test.mkv');
        expect(result).toBe(true);
      });
    });

    nonSeedingStates.forEach((state) => {
      it(`should not detect ${state} as seeding`, async () => {
        mockPrismaService.settings.findFirst.mockResolvedValue({
          torrentClient: TorrentClient.QBITTORRENT,
          torrentUrl: 'http://localhost:8080',
          skipSeeding: true,
        });

        mockHttpService.post.mockReturnValueOnce(
          of({
            headers: { 'set-cookie': ['SID=abc123; path=/'] },
            data: 'Ok.',
          })
        );

        mockHttpService.get.mockReturnValueOnce(
          of({
            data: [
              {
                hash: 'abc123',
                name: 'Test',
                state: state,
                progress: 0.5,
                ratio: 0,
                save_path: '/media',
              },
            ],
          })
        );

        const result = await service.isFileSeeding('/media/test.mkv');
        expect(result).toBe(false);
      });
    });
  });

  describe('path matching', () => {
    it('should match exact file path', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.QBITTORRENT,
        torrentUrl: 'http://localhost:8080',
        skipSeeding: true,
      });

      mockHttpService.post.mockReturnValueOnce(
        of({
          headers: { 'set-cookie': ['SID=abc123; path=/'] },
          data: 'Ok.',
        })
      );

      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [
            {
              hash: 'abc123',
              name: 'Test',
              state: 'seeding',
              progress: 1,
              ratio: 1,
              save_path: '/media/movies',
            },
          ],
        })
      );

      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [{ name: 'Test.Movie.2024.mkv' }],
        })
      );

      const result = await service.isFileSeeding('/media/movies/Test.Movie.2024.mkv');
      expect(result).toBe(true);
    });

    it('should match partial file path', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.QBITTORRENT,
        torrentUrl: 'http://localhost:8080',
        skipSeeding: true,
      });

      mockHttpService.post.mockReturnValueOnce(
        of({
          headers: { 'set-cookie': ['SID=abc123; path=/'] },
          data: 'Ok.',
        })
      );

      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [
            {
              hash: 'abc123',
              name: 'Test',
              state: 'seeding',
              progress: 1,
              ratio: 1,
              save_path: '/media/movies',
            },
          ],
        })
      );

      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [{ name: 'Test.Movie.2024/Test.Movie.2024.mkv' }],
        })
      );

      // File path includes the torrent file name
      const result = await service.isFileSeeding(
        '/media/movies/Test.Movie.2024/Test.Movie.2024.mkv'
      );
      expect(result).toBe(true);
    });

    it('should handle double slashes in paths', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.QBITTORRENT,
        torrentUrl: 'http://localhost:8080',
        skipSeeding: true,
      });

      mockHttpService.post.mockReturnValueOnce(
        of({
          headers: { 'set-cookie': ['SID=abc123; path=/'] },
          data: 'Ok.',
        })
      );

      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [
            {
              hash: 'abc123',
              name: 'Test',
              state: 'seeding',
              progress: 1,
              ratio: 1,
              save_path: '/media/movies/',
            },
          ],
        })
      );

      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [{ name: 'test.mkv' }],
        })
      );

      const result = await service.isFileSeeding('/media/movies/test.mkv');
      expect(result).toBe(true);
    });
  });
});
