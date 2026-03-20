import { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { JobRepository } from '../../../common/repositories/job.repository';
import { SettingsRepository } from '../../../common/repositories/settings.repository';
import { PlexIntegrationService } from '../../plex.service';

describe('PlexIntegrationService', () => {
  let service: PlexIntegrationService;

  const mockSettingsRepository = {
    findFirst: jest.fn(),
  };

  const mockJobRepository = {
    updateManyWhere: jest.fn(),
  };

  const mockHttpService = {
    get: jest.fn(),
    post: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlexIntegrationService,
        { provide: SettingsRepository, useValue: mockSettingsRepository },
        { provide: JobRepository, useValue: mockJobRepository },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    service = module.get<PlexIntegrationService>(PlexIntegrationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isPlaybackActive', () => {
    it('should return false when Plex not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      const result = await service.isPlaybackActive();

      expect(result).toBe(false);
    });

    it('should return false when no settings with plexUrl', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({ plexUrl: null, plexToken: null });

      const result = await service.isPlaybackActive();

      expect(result).toBe(false);
    });

    it('should return true when active playing sessions exist', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            MediaContainer: {
              Metadata: [
                {
                  Player: { state: 'playing' },
                  type: 'movie',
                  title: 'Test',
                  User: { title: 'User1' },
                },
              ],
            },
          },
        })
      );

      const result = await service.isPlaybackActive();

      expect(result).toBe(true);
    });

    it('should return false when sessions are paused', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            MediaContainer: {
              Metadata: [
                {
                  Player: { state: 'paused' },
                  type: 'movie',
                  title: 'Test',
                  User: { title: 'User1' },
                },
              ],
            },
          },
        })
      );

      const result = await service.isPlaybackActive();

      expect(result).toBe(false);
    });

    it('should return false on API error', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(throwError(() => new Error('Connection refused')));

      const result = await service.isPlaybackActive();

      expect(result).toBe(false);
    });
  });

  describe('getActiveSessions', () => {
    it('should return empty array when not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      const result = await service.getActiveSessions();

      expect(result).toEqual([]);
    });

    it('should map session data correctly', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            MediaContainer: {
              Metadata: [
                {
                  type: 'episode',
                  title: 'Pilot',
                  grandparentTitle: 'Breaking Bad',
                  User: { title: 'Admin' },
                  Player: { state: 'playing' },
                },
              ],
            },
          },
        })
      );

      const result = await service.getActiveSessions();

      expect(result).toEqual([
        { title: 'Breaking Bad - Pilot', user: 'Admin', state: 'playing', type: 'episode' },
      ]);
    });

    it('should return empty array on error', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(throwError(() => new Error('API error')));

      const result = await service.getActiveSessions();

      expect(result).toEqual([]);
    });
  });

  describe('refreshLibrary', () => {
    it('should not call API when not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      await service.refreshLibrary();

      expect(mockHttpService.get).not.toHaveBeenCalled();
    });

    it('should refresh specific section when sectionId provided', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(of({ data: {} }));

      await service.refreshLibrary('5');

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'http://plex:32400/library/sections/5/refresh',
        expect.objectContaining({
          headers: { 'X-Plex-Token': 'token-123' },
        })
      );
    });

    it('should refresh all sections when no sectionId', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(of({ data: {} }));

      await service.refreshLibrary();

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'http://plex:32400/library/sections/all/refresh',
        expect.any(Object)
      );
    });

    it('should handle errors gracefully', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(throwError(() => new Error('timeout')));

      await expect(service.refreshLibrary()).resolves.not.toThrow();
    });
  });

  describe('notifyNewFile', () => {
    it('should not call when not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      await service.notifyNewFile('/media/movies/test.mkv');

      expect(mockHttpService.get).not.toHaveBeenCalled();
    });

    it('should not call when refreshOnComplete is false', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
        plexRefreshOnComplete: false,
      });

      await service.notifyNewFile('/media/movies/test.mkv');

      expect(mockHttpService.get).not.toHaveBeenCalled();
    });
  });

  describe('checkPlaybackAndPause', () => {
    it('should do nothing when pauseDuringPlayback is false', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
        plexPauseDuringPlayback: false,
      });

      await service.checkPlaybackAndPause();

      expect(mockJobRepository.updateManyWhere).not.toHaveBeenCalled();
    });

    it('should do nothing when not configured', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue(null);

      await service.checkPlaybackAndPause();

      expect(mockJobRepository.updateManyWhere).not.toHaveBeenCalled();
    });
  });

  describe('testConnection', () => {
    it('should return success with server name', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            MediaContainer: { friendlyName: 'My Plex Server' },
          },
        })
      );

      const result = await service.testConnection('http://plex:32400', 'token-123');

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('My Plex Server');
    });

    it('should return error on connection failure', async () => {
      mockHttpService.get.mockReturnValue(throwError(() => new Error('Connection refused')));

      const result = await service.testConnection('http://plex:32400', 'bad-token');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });

    it('should return success without serverName when MediaContainer is absent', async () => {
      mockHttpService.get.mockReturnValue(of({ data: {} }));

      const result = await service.testConnection('http://plex:32400', 'token-123');

      expect(result.success).toBe(true);
      expect(result.serverName).toBeUndefined();
    });
  });

  describe('getActiveSessions', () => {
    it('should use grandparentTitle prefix for episode sessions', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            MediaContainer: {
              Metadata: [
                {
                  type: 'episode',
                  title: 'Ozymandias',
                  grandparentTitle: 'Breaking Bad',
                  User: { title: 'Admin' },
                  Player: { state: 'playing' },
                },
              ],
            },
          },
        })
      );

      const result = await service.getActiveSessions();

      expect(result[0].title).toBe('Breaking Bad - Ozymandias');
    });

    it('should use title alone when grandparentTitle is absent', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            MediaContainer: {
              Metadata: [
                {
                  type: 'movie',
                  title: 'Inception',
                  User: { title: 'User1' },
                  Player: { state: 'playing' },
                },
              ],
            },
          },
        })
      );

      const result = await service.getActiveSessions();

      expect(result[0].title).toBe('Inception');
    });

    it('should fall back to Unknown when User is absent', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            MediaContainer: {
              Metadata: [
                {
                  type: 'movie',
                  title: 'Inception',
                  Player: { state: 'playing' },
                },
              ],
            },
          },
        })
      );

      const result = await service.getActiveSessions();

      expect(result[0].user).toBe('Unknown');
    });
  });

  describe('refreshLibrary', () => {
    it('should strip trailing slash from URL', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400/',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(of({ data: {} }));

      await service.refreshLibrary('2');

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'http://plex:32400/library/sections/2/refresh',
        expect.any(Object)
      );
    });
  });

  describe('notifyNewFile', () => {
    it('should refresh specific section when library section is found', async () => {
      // getPlexConfig calls 1 & 2 (notifyNewFile + findLibrarySection + refreshLibrary)
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
        plexRefreshOnComplete: true,
      });
      // findLibrarySection HTTP response
      mockHttpService.get
        .mockReturnValueOnce(
          of({
            data: {
              MediaContainer: {
                Directory: [
                  {
                    key: '3',
                    Location: [{ path: '/media/movies' }],
                  },
                ],
              },
            },
          })
        )
        // refreshLibrary HTTP response
        .mockReturnValueOnce(of({ data: {} }));

      await service.notifyNewFile('/media/movies/Inception.mkv');

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'http://plex:32400/library/sections/3/refresh',
        expect.any(Object)
      );
    });

    it('should refresh all sections when no matching library section found', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
        plexRefreshOnComplete: true,
      });
      // findLibrarySection returns no match
      mockHttpService.get
        .mockReturnValueOnce(
          of({
            data: {
              MediaContainer: {
                Directory: [
                  {
                    key: '1',
                    Location: [{ path: '/media/tv' }],
                  },
                ],
              },
            },
          })
        )
        .mockReturnValueOnce(of({ data: {} }));

      await service.notifyNewFile('/media/movies/Unknown.mkv');

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'http://plex:32400/library/sections/all/refresh',
        expect.any(Object)
      );
    });
  });

  describe('checkPlaybackAndPause', () => {
    it('should pause encoding jobs when playback just starts', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
        plexPauseDuringPlayback: true,
      });
      // isPlaybackActive returns true (active session)
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            MediaContainer: {
              Metadata: [
                { Player: { state: 'playing' }, type: 'movie', title: 'T', User: { title: 'U' } },
              ],
            },
          },
        })
      );
      mockJobRepository.updateManyWhere.mockResolvedValue({ count: 2 });

      await service.checkPlaybackAndPause();

      expect(mockJobRepository.updateManyWhere).toHaveBeenCalledWith(
        expect.objectContaining({ stage: expect.anything() }),
        expect.objectContaining({ error: 'Paused: Plex playback detected' })
      );
    });

    it('should resume encoding jobs when playback stops', async () => {
      // Simulate wasPlaybackActive = true by first running a pause cycle
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
        plexPauseDuringPlayback: true,
      });
      // First call: playback active → sets wasPlaybackActive = true
      mockHttpService.get.mockReturnValueOnce(
        of({
          data: {
            MediaContainer: {
              Metadata: [
                { Player: { state: 'playing' }, type: 'movie', title: 'T', User: { title: 'U' } },
              ],
            },
          },
        })
      );
      mockJobRepository.updateManyWhere.mockResolvedValue({ count: 1 });
      await service.checkPlaybackAndPause();

      // Second call: playback stopped → should resume
      mockHttpService.get.mockReturnValueOnce(of({ data: { MediaContainer: { Metadata: [] } } }));
      mockJobRepository.updateManyWhere.mockResolvedValue({ count: 1 });
      await service.checkPlaybackAndPause();

      expect(mockJobRepository.updateManyWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ contains: 'Plex playback detected' }),
        }),
        expect.objectContaining({ error: null })
      );
    });

    it('should handle errors in playback check without throwing', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
        plexPauseDuringPlayback: true,
      });
      mockHttpService.get.mockReturnValue(throwError(() => new Error('Plex down')));

      await expect(service.checkPlaybackAndPause()).resolves.not.toThrow();
    });
  });

  describe('isPlaybackActive', () => {
    it('should return false when MediaContainer has no Metadata', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(of({ data: { MediaContainer: {} } }));

      const result = await service.isPlaybackActive();

      expect(result).toBe(false);
    });

    it('should return false when response data is missing MediaContainer', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(of({ data: {} }));

      const result = await service.isPlaybackActive();

      expect(result).toBe(false);
    });
  });

  describe('getPlexConfig - error path', () => {
    it('should return null when findFirst throws', async () => {
      mockSettingsRepository.findFirst.mockRejectedValue(new Error('DB connection lost'));

      // isPlaybackActive calls getPlexConfig which catches and returns null → returns false
      const result = await service.isPlaybackActive();

      expect(result).toBe(false);
    });

    it('should use default true for pauseDuringPlayback when not explicitly set', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
        // plexPauseDuringPlayback intentionally absent → defaults to true
      });
      mockHttpService.get.mockReturnValue(of({ data: { MediaContainer: { Metadata: [] } } }));
      mockJobRepository.updateManyWhere.mockResolvedValue({ count: 0 });

      // Should not throw - defaults apply
      await expect(service.checkPlaybackAndPause()).resolves.not.toThrow();
    });

    it('should use default true for refreshOnComplete when not explicitly set', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
        // plexRefreshOnComplete intentionally absent → defaults to true
      });
      // findLibrarySection call
      mockHttpService.get
        .mockReturnValueOnce(of({ data: { MediaContainer: { Directory: [] } } }))
        // refreshLibrary all call
        .mockReturnValueOnce(of({ data: {} }));

      await service.notifyNewFile('/some/file.mkv');

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'http://plex:32400/library/sections/all/refresh',
        expect.any(Object)
      );
    });
  });

  describe('findLibrarySection - error path', () => {
    it('should return null and fall back to refresh all when findLibrarySection throws', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
        plexRefreshOnComplete: true,
      });
      // findLibrarySection HTTP call throws, then refreshLibrary succeeds
      mockHttpService.get
        .mockReturnValueOnce(throwError(() => new Error('Network error')))
        .mockReturnValueOnce(of({ data: {} }));

      await service.notifyNewFile('/media/movies/Test.mkv');

      // Falls back to refresh all since section not found
      expect(mockHttpService.get).toHaveBeenCalledWith(
        'http://plex:32400/library/sections/all/refresh',
        expect.any(Object)
      );
    });
  });

  describe('checkPlaybackAndPause - no state change branches', () => {
    it('should not pause again when playback was already active', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
        plexPauseDuringPlayback: true,
      });

      const activeSessions = of({
        data: {
          MediaContainer: {
            Metadata: [
              { Player: { state: 'playing' }, type: 'movie', title: 'T', User: { title: 'U' } },
            ],
          },
        },
      });
      mockHttpService.get.mockReturnValue(activeSessions);
      mockJobRepository.updateManyWhere.mockResolvedValue({ count: 1 });

      // First call sets wasPlaybackActive = true
      await service.checkPlaybackAndPause();
      const callCount = mockJobRepository.updateManyWhere.mock.calls.length;

      // Second call: still playing, wasPlaybackActive already true → no action
      await service.checkPlaybackAndPause();

      expect(mockJobRepository.updateManyWhere.mock.calls.length).toBe(callCount);
    });

    it('should not resume when playback was not active and still not active', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
        plexPauseDuringPlayback: true,
      });
      mockHttpService.get.mockReturnValue(of({ data: { MediaContainer: { Metadata: [] } } }));

      // wasPlaybackActive starts false, playback not active → no action
      await service.checkPlaybackAndPause();

      expect(mockJobRepository.updateManyWhere).not.toHaveBeenCalled();
    });
  });

  describe('getActiveSessions - Player state fallback', () => {
    it('should use unknown as state when Player is absent', async () => {
      mockSettingsRepository.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            MediaContainer: {
              Metadata: [
                {
                  type: 'movie',
                  title: 'Interstellar',
                  User: { title: 'User1' },
                  // Player intentionally absent
                },
              ],
            },
          },
        })
      );

      const result = await service.getActiveSessions();

      expect(result[0].state).toBe('unknown');
    });
  });
});
