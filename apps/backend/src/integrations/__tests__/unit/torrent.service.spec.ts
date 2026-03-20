import { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { SettingsRepository } from '../../../common/repositories/settings.repository';
import { TorrentClient, TorrentIntegrationService } from '../../torrent.service';

describe('TorrentIntegrationService', () => {
  let service: TorrentIntegrationService;
  let _httpService: jest.Mocked<HttpService>;

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
        TorrentIntegrationService,
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
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      const result = await service.isFileSeeding('/media/movies/test.mkv');

      expect(result).toBe(false);
    });

    it('should return false when torrent client not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        torrentClient: null,
        torrentUrl: null,
      });

      const result = await service.isFileSeeding('/media/movies/test.mkv');

      expect(result).toBe(false);
    });

    it('should return true when file is being seeded in qBittorrent', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
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
      mockSettingsRepository.findFirst.mockResolvedValue({
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
      mockSettingsRepository.findFirst.mockResolvedValue({
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
      mockSettingsRepository.findFirst.mockResolvedValue({
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
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      const result = await service.getSeedingFiles();

      expect(result).toEqual([]);
    });

    it('should return list of seeding files', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
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
      mockSettingsRepository.findFirst.mockResolvedValue({
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
        mockSettingsRepository.findFirst.mockResolvedValue({
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
        mockSettingsRepository.findFirst.mockResolvedValue({
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
      mockSettingsRepository.findFirst.mockResolvedValue({
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
      mockSettingsRepository.findFirst.mockResolvedValue({
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
      mockSettingsRepository.findFirst.mockResolvedValue({
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

  describe('getActiveTorrents - unknown client (default branch)', () => {
    it('returns empty array for unknown client via testConnection', async () => {
      // testConnection calls getActiveTorrents; with an unknown client string it hits the default branch
      mockHttpService.post.mockReturnValue(of({ headers: {}, data: {} }));
      mockHttpService.get.mockReturnValue(of({ headers: {}, data: [] }));

      const result = await service.testConnection(
        'unknown_client' as TorrentClient,
        'http://localhost:9999'
      );
      expect(result.success).toBe(true);
    });
  });

  describe('Transmission - no-auth path', () => {
    it('returns torrents when no username/password configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.TRANSMISSION,
        torrentUrl: 'http://localhost:9091',
        torrentUsername: null,
        torrentPassword: null,
        skipSeeding: true,
      });

      // First POST: 409 to get session-id (no-auth path - error thrown with response header)
      const sessionError = Object.assign(new Error('409'), {
        response: { headers: { 'x-transmission-session-id': 'sess-xyz' } },
      });
      mockHttpService.post
        .mockReturnValueOnce(throwError(() => sessionError)) // session-id request
        .mockReturnValueOnce(
          of({
            data: {
              arguments: {
                torrents: [
                  {
                    hashString: 'hash1',
                    name: 'Movie',
                    status: 6,
                    percentDone: 1,
                    uploadRatio: 1.5,
                    downloadDir: '/downloads/',
                  },
                ],
              },
            },
          })
        );

      const result = await service.isFileSeeding('/downloads/Movie/movie.mkv');
      expect(result).toBe(false); // seeding but no file match
    });

    it('handles Transmission when session-id request succeeds (no 409)', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.TRANSMISSION,
        torrentUrl: 'http://localhost:9091',
        torrentUsername: null,
        torrentPassword: null,
        skipSeeding: true,
      });

      // First POST succeeds (no 409) → sessionId stays ''
      mockHttpService.post
        .mockReturnValueOnce(of({ headers: {}, data: {} })) // session-id request succeeds
        .mockReturnValueOnce(
          of({
            data: { arguments: { torrents: [] } },
          })
        );

      const result = await service.isFileSeeding('/downloads/any.mkv');
      expect(result).toBe(false);
    });
  });

  describe('Transmission files - no-auth path', () => {
    it('returns files via isFileSeeding with transmission seeding torrent', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.TRANSMISSION,
        torrentUrl: 'http://localhost:9091',
        torrentUsername: null,
        torrentPassword: null,
        skipSeeding: true,
      });

      const sessionError = Object.assign(new Error('409'), {
        response: { headers: { 'x-transmission-session-id': 'sess-abc' } },
      });

      // torrents call: session + data
      mockHttpService.post
        .mockReturnValueOnce(throwError(() => sessionError))
        .mockReturnValueOnce(
          of({
            data: {
              arguments: {
                torrents: [
                  {
                    hashString: 'abc123',
                    name: 'Movie',
                    status: 6, // seeding
                    percentDone: 1,
                    uploadRatio: 2.0,
                    downloadDir: '/media/movies',
                  },
                ],
              },
            },
          })
        )
        // files call: session + data
        .mockReturnValueOnce(throwError(() => sessionError))
        .mockReturnValueOnce(
          of({
            data: {
              arguments: {
                torrents: [{ files: [{ name: 'Movie/movie.mkv' }] }],
              },
            },
          })
        );

      const result = await service.isFileSeeding('/media/movies/Movie/movie.mkv');
      expect(result).toBe(true);
    });
  });

  describe('Deluge - extractFiles recursive function', () => {
    it('extracts files from nested directory structure', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.DELUGE,
        torrentUrl: 'http://localhost:8112',
        torrentPassword: 'deluge',
        skipSeeding: true,
      });

      // getDelugeTorrents: login + web.update_ui
      mockHttpService.post
        .mockReturnValueOnce(
          of({ headers: { 'set-cookie': ['_session_id=abc; path=/'] }, data: { result: true } })
        )
        .mockReturnValueOnce(
          of({
            data: {
              result: {
                torrents: {
                  hash999: {
                    name: 'Series',
                    state: 'Seeding',
                    progress: 100,
                    ratio: 1.2,
                    save_path: '/media/tv',
                  },
                },
              },
            },
          })
        )
        // getDelugeFiles: login + web.get_torrent_files with nested directory
        .mockReturnValueOnce(
          of({ headers: { 'set-cookie': ['_session_id=abc; path=/'] }, data: { result: true } })
        )
        .mockReturnValueOnce(
          of({
            data: {
              result: {
                type: 'dir',
                contents: {
                  'Season 1': {
                    type: 'dir',
                    contents: {
                      'episode1.mkv': { type: 'file', name: 'episode1.mkv' },
                      'episode2.mkv': { type: 'file', name: 'episode2.mkv' },
                    },
                  },
                },
              },
            },
          })
        );

      // extractFiles produces 'Season 1/episode1.mkv/episode1.mkv' (key/name both used as path segments)
      // fullPath = '/media/tv/Season 1/episode1.mkv/episode1.mkv'
      const result = await service.isFileSeeding('/media/tv/Season 1/episode1.mkv/episode1.mkv');
      expect(result).toBe(true);
    });

    it('extracts a single top-level file node', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.DELUGE,
        torrentUrl: 'http://localhost:8112',
        torrentPassword: 'deluge',
        skipSeeding: true,
      });

      mockHttpService.post
        .mockReturnValueOnce(
          of({ headers: { 'set-cookie': ['_session_id=x; path=/'] }, data: { result: true } })
        )
        .mockReturnValueOnce(
          of({
            data: {
              result: {
                torrents: {
                  hashAAA: {
                    name: 'Movie',
                    state: 'Seeding',
                    progress: 100,
                    ratio: 1.5,
                    save_path: '/media/movies',
                  },
                },
              },
            },
          })
        )
        .mockReturnValueOnce(
          of({ headers: { 'set-cookie': ['_session_id=x; path=/'] }, data: { result: true } })
        )
        .mockReturnValueOnce(
          of({
            data: {
              result: { type: 'file', name: 'movie.mkv' },
            },
          })
        );

      const result = await service.isFileSeeding('/media/movies/movie.mkv');
      expect(result).toBe(true);
    });

    it('handles empty/null result from getDelugeFiles', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.DELUGE,
        torrentUrl: 'http://localhost:8112',
        torrentPassword: 'deluge',
        skipSeeding: true,
      });

      mockHttpService.post
        .mockReturnValueOnce(
          of({ headers: { 'set-cookie': ['_session_id=x; path=/'] }, data: { result: true } })
        )
        .mockReturnValueOnce(
          of({
            data: {
              result: {
                torrents: {
                  hashBBB: {
                    name: 'Movie',
                    state: 'Seeding',
                    progress: 100,
                    ratio: 1.5,
                    save_path: '/media/movies',
                  },
                },
              },
            },
          })
        )
        .mockReturnValueOnce(
          of({ headers: { 'set-cookie': ['_session_id=x; path=/'] }, data: { result: true } })
        )
        .mockReturnValueOnce(
          of({ data: { result: null } }) // null result → extractFiles({})
        );

      const result = await service.isFileSeeding('/media/movies/movie.mkv');
      expect(result).toBe(false);
    });
  });

  describe('getSeedingFiles', () => {
    it('returns empty array when no config', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);
      const result = await service.getSeedingFiles();
      expect(result).toEqual([]);
    });

    it('returns seeding file paths for qBittorrent', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.QBITTORRENT,
        torrentUrl: 'http://localhost:8080',
        torrentUsername: 'admin',
        torrentPassword: 'pass',
        skipSeeding: true,
      });

      mockHttpService.post.mockReturnValueOnce(
        of({ headers: { 'set-cookie': ['SID=abc; path=/'] }, data: 'Ok.' })
      );
      mockHttpService.get
        .mockReturnValueOnce(
          of({
            data: [
              {
                hash: 'h1',
                name: 'Film',
                state: 'seeding',
                progress: 1,
                ratio: 1,
                save_path: '/media/movies/',
              },
            ],
          })
        )
        .mockReturnValueOnce(of({ data: [{ name: 'Film/film.mkv' }] }));

      const result = await service.getSeedingFiles();
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('film.mkv');
    });

    it('returns empty array on error', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.QBITTORRENT,
        torrentUrl: 'http://localhost:8080',
        torrentUsername: 'admin',
        torrentPassword: 'pass',
        skipSeeding: true,
      });

      mockHttpService.post.mockReturnValueOnce(throwError(() => new Error('network error')));

      const result = await service.getSeedingFiles();
      expect(result).toEqual([]);
    });

    it('skips non-seeding torrents', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        torrentClient: TorrentClient.QBITTORRENT,
        torrentUrl: 'http://localhost:8080',
        torrentUsername: 'admin',
        torrentPassword: 'pass',
        skipSeeding: true,
      });

      mockHttpService.post.mockReturnValueOnce(
        of({ headers: { 'set-cookie': ['SID=abc; path=/'] }, data: 'Ok.' })
      );
      mockHttpService.get.mockReturnValueOnce(
        of({
          data: [
            {
              hash: 'h2',
              name: 'Downloading',
              state: 'downloading',
              progress: 0.5,
              ratio: 0,
              save_path: '/media/',
            },
          ],
        })
      );

      const result = await service.getSeedingFiles();
      expect(result).toEqual([]);
    });
  });
});
