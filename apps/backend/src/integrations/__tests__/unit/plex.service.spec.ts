import { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlexIntegrationService } from '../../plex.service';

describe('PlexIntegrationService', () => {
  let service: PlexIntegrationService;

  const mockPrismaService = {
    settings: { findFirst: jest.fn() },
    job: { updateMany: jest.fn() },
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
        { provide: PrismaService, useValue: mockPrismaService },
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
      mockPrismaService.settings.findFirst.mockResolvedValue(null);

      const result = await service.isPlaybackActive();

      expect(result).toBe(false);
    });

    it('should return false when no settings with plexUrl', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({ plexUrl: null, plexToken: null });

      const result = await service.isPlaybackActive();

      expect(result).toBe(false);
    });

    it('should return true when active playing sessions exist', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({
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
      mockPrismaService.settings.findFirst.mockResolvedValue({
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
      mockPrismaService.settings.findFirst.mockResolvedValue({
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
      mockPrismaService.settings.findFirst.mockResolvedValue(null);

      const result = await service.getActiveSessions();

      expect(result).toEqual([]);
    });

    it('should map session data correctly', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({
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
      mockPrismaService.settings.findFirst.mockResolvedValue({
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
      mockPrismaService.settings.findFirst.mockResolvedValue(null);

      await service.refreshLibrary();

      expect(mockHttpService.get).not.toHaveBeenCalled();
    });

    it('should refresh specific section when sectionId provided', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({
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
      mockPrismaService.settings.findFirst.mockResolvedValue({
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
      mockPrismaService.settings.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
      });
      mockHttpService.get.mockReturnValue(throwError(() => new Error('timeout')));

      await expect(service.refreshLibrary()).resolves.not.toThrow();
    });
  });

  describe('notifyNewFile', () => {
    it('should not call when not configured', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue(null);

      await service.notifyNewFile('/media/movies/test.mkv');

      expect(mockHttpService.get).not.toHaveBeenCalled();
    });

    it('should not call when refreshOnComplete is false', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({
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
      mockPrismaService.settings.findFirst.mockResolvedValue({
        plexUrl: 'http://plex:32400',
        plexToken: 'token-123',
        plexPauseDuringPlayback: false,
      });

      await service.checkPlaybackAndPause();

      expect(mockPrismaService.job.updateMany).not.toHaveBeenCalled();
    });

    it('should do nothing when not configured', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue(null);

      await service.checkPlaybackAndPause();

      expect(mockPrismaService.job.updateMany).not.toHaveBeenCalled();
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
  });
});
