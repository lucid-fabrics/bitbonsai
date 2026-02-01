import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { MediaStatsService } from '../../media-stats.service';

// Create mock for LibrariesService before importing MediaStatsService
const mockGetAllLibraryPaths = jest.fn();
jest.mock('../../../libraries/libraries.service', () => ({
  LibrariesService: jest.fn().mockImplementation(() => ({
    getAllLibraryPaths: mockGetAllLibraryPaths,
  })),
}));

// Mock fs module
const mockReaddirSync = jest.fn();
const mockStatSync = jest.fn();
jest.mock('fs', () => ({
  readdirSync: (...args: any[]) => mockReaddirSync(...args),
  statSync: (...args: any[]) => mockStatSync(...args),
}));

// Mock child_process
const mockSpawnSync = jest.fn();
jest.mock('child_process', () => ({
  spawnSync: (...args: any[]) => mockSpawnSync(...args),
}));

// Import after mocks are set up
import { LibrariesService } from '../../../libraries/libraries.service';

describe('MediaStatsService', () => {
  let service: MediaStatsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaStatsService,
        {
          provide: LibrariesService,
          useValue: {
            getAllLibraryPaths: mockGetAllLibraryPaths,
          },
        },
      ],
    }).compile();

    service = module.get<MediaStatsService>(MediaStatsService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });
  });

  describe('getMediaStats', () => {
    it('should trigger scan if no cache exists', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);
      mockReaddirSync.mockReturnValue([]);

      const result = await service.getMediaStats();

      expect(mockGetAllLibraryPaths).toHaveBeenCalled();
      expect(result).toHaveProperty('total_files', 0);
      expect(result).toHaveProperty('scan_timestamp');
    });

    it('should return cached stats on second call', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);
      mockReaddirSync.mockReturnValue([]);

      await service.getMediaStats();
      const secondCall = await service.getMediaStats();

      // getAllLibraryPaths should only be called once (during first scan)
      expect(mockGetAllLibraryPaths).toHaveBeenCalledTimes(1);
      expect(secondCall).toHaveProperty('total_files', 0);
    });
  });

  describe('triggerScan', () => {
    it('should scan empty folders correctly', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);
      mockReaddirSync.mockReturnValue([]);

      await service.triggerScan();
      const stats = await service.getMediaStats();

      expect(stats.total_files).toBe(0);
      expect(stats.codec_distribution).toEqual({
        hevc: 0,
        h264: 0,
        av1: 0,
        other: 0,
      });
    });

    it('should scan folders with video files', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);

      // Mock directory contents
      mockReaddirSync.mockReturnValue([
        { name: 'movie1.mp4', isDirectory: () => false, isFile: () => true },
        { name: 'movie2.mkv', isDirectory: () => false, isFile: () => true },
      ]);

      // Mock file stats
      mockStatSync.mockReturnValue({ size: 1024 * 1024 * 500 }); // 500MB

      // Mock ffprobe output
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({
          streams: [{ codec_name: 'h264', bit_rate: '5000000' }],
        }),
        stderr: '',
      });

      await service.triggerScan();
      const stats = await service.getMediaStats();

      expect(stats.total_files).toBe(2);
      expect(stats.codec_distribution.h264).toBe(2);
    });

    it('should handle nested directories', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);

      // First call returns a directory
      mockReaddirSync.mockImplementation((path: string) => {
        if (path === '/media/movies') {
          return [{ name: 'action', isDirectory: () => true, isFile: () => false }];
        }
        if (path === '/media/movies/action') {
          return [{ name: 'movie.mp4', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });

      mockStatSync.mockReturnValue({ size: 1024 * 1024 * 100 });

      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({
          streams: [{ codec_name: 'hevc', bit_rate: '3000000' }],
        }),
        stderr: '',
      });

      await service.triggerScan();
      const stats = await service.getMediaStats();

      expect(stats.total_files).toBe(1);
      expect(stats.codec_distribution.hevc).toBe(1);
    });

    it('should fallback to /media when no libraries configured', async () => {
      mockGetAllLibraryPaths.mockResolvedValue([]);
      mockReaddirSync.mockReturnValue([]);

      await service.triggerScan();

      // Should have called readdirSync with /media fallback
      expect(mockReaddirSync).toHaveBeenCalledWith('/media', { withFileTypes: true });
    });
  });

  describe('codec categorization', () => {
    it('should categorize hevc/h265 correctly', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);
      mockReaddirSync.mockReturnValue([
        { name: 'movie.mkv', isDirectory: () => false, isFile: () => true },
      ]);
      mockStatSync.mockReturnValue({ size: 1024 * 1024 });

      // Test h265 alias
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({ streams: [{ codec_name: 'h265', bit_rate: '3000000' }] }),
        stderr: '',
      });

      await service.triggerScan();
      const stats = await service.getMediaStats();

      expect(stats.codec_distribution.hevc).toBe(1);
    });

    it('should categorize av1 correctly', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);
      mockReaddirSync.mockReturnValue([
        { name: 'movie.mkv', isDirectory: () => false, isFile: () => true },
      ]);
      mockStatSync.mockReturnValue({ size: 1024 * 1024 });

      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({ streams: [{ codec_name: 'av1', bit_rate: '2000000' }] }),
        stderr: '',
      });

      await service.triggerScan();
      const stats = await service.getMediaStats();

      expect(stats.codec_distribution.av1).toBe(1);
    });

    it('should categorize unknown codecs as other', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);
      mockReaddirSync.mockReturnValue([
        { name: 'movie.avi', isDirectory: () => false, isFile: () => true },
      ]);
      mockStatSync.mockReturnValue({ size: 1024 * 1024 });

      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({ streams: [{ codec_name: 'mpeg4', bit_rate: '1000000' }] }),
        stderr: '',
      });

      await service.triggerScan();
      const stats = await service.getMediaStats();

      expect(stats.codec_distribution.other).toBe(1);
    });
  });

  describe('getFolderFiles', () => {
    it('should throw NotFoundException for unknown folder', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);

      await expect(service.getFolderFiles('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should return files for valid folder', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);
      mockReaddirSync.mockReturnValue([
        { name: 'movie.mp4', isDirectory: () => false, isFile: () => true },
      ]);
      mockStatSync.mockReturnValue({ size: 1024 * 1024 * 1024 }); // 1GB

      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({ streams: [{ codec_name: 'h264', bit_rate: '5000000' }] }),
        stderr: '',
      });

      const result = await service.getFolderFiles('movies');

      expect(result.folder_name).toBe('movies');
      expect(result.total_files).toBe(1);
      expect(result.files[0].codec).toBe('h264');
    });

    it('should filter files by codec', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);
      mockReaddirSync.mockReturnValue([
        { name: 'movie1.mp4', isDirectory: () => false, isFile: () => true },
        { name: 'movie2.mkv', isDirectory: () => false, isFile: () => true },
      ]);
      mockStatSync.mockReturnValue({ size: 1024 * 1024 * 500 });

      let callCount = 0;
      mockSpawnSync.mockImplementation(() => {
        callCount++;
        const codec = callCount === 1 ? 'h264' : 'hevc';
        return {
          status: 0,
          stdout: JSON.stringify({ streams: [{ codec_name: codec, bit_rate: '5000000' }] }),
          stderr: '',
        };
      });

      const result = await service.getFolderFiles('movies', 'h264');

      expect(result.total_files).toBe(1);
      expect(result.files[0].codec).toBe('h264');
    });
  });

  describe('error handling', () => {
    it('should handle ffprobe failures gracefully', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);
      mockReaddirSync.mockReturnValue([
        { name: 'corrupt.mp4', isDirectory: () => false, isFile: () => true },
      ]);
      mockStatSync.mockReturnValue({ size: 1024 * 1024 });

      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'Invalid data found',
        error: null,
      });

      await service.triggerScan();
      const stats = await service.getMediaStats();

      // Should still complete scan with unknown codec
      expect(stats.total_files).toBe(1);
      expect(stats.codec_distribution.other).toBe(1);
    });

    it('should handle invalid JSON from ffprobe', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);
      mockReaddirSync.mockReturnValue([
        { name: 'movie.mp4', isDirectory: () => false, isFile: () => true },
      ]);
      mockStatSync.mockReturnValue({ size: 1024 * 1024 });

      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'not valid json',
        stderr: '',
      });

      await service.triggerScan();
      const stats = await service.getMediaStats();

      // Should handle gracefully
      expect(stats.total_files).toBe(1);
      expect(stats.codec_distribution.other).toBe(1);
    });

    it('should handle directory read errors', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);
      mockReaddirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await service.triggerScan();
      const stats = await service.getMediaStats();

      // Should complete with 0 files
      expect(stats.total_files).toBe(0);
    });
  });

  describe('video extension filtering', () => {
    it('should only process supported video extensions', async () => {
      mockGetAllLibraryPaths.mockResolvedValue(['/media/movies']);
      mockReaddirSync.mockReturnValue([
        { name: 'movie.mp4', isDirectory: () => false, isFile: () => true },
        { name: 'movie.mkv', isDirectory: () => false, isFile: () => true },
        { name: 'movie.avi', isDirectory: () => false, isFile: () => true },
        { name: 'movie.mov', isDirectory: () => false, isFile: () => true },
        { name: 'movie.wmv', isDirectory: () => false, isFile: () => true },
        { name: 'movie.flv', isDirectory: () => false, isFile: () => true },
        { name: 'subtitles.srt', isDirectory: () => false, isFile: () => true },
        { name: 'poster.jpg', isDirectory: () => false, isFile: () => true },
        { name: 'readme.txt', isDirectory: () => false, isFile: () => true },
      ]);

      mockStatSync.mockReturnValue({ size: 1024 * 1024 });
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({ streams: [{ codec_name: 'h264', bit_rate: '5000000' }] }),
        stderr: '',
      });

      await service.triggerScan();
      const stats = await service.getMediaStats();

      // Should only count video files (mp4, mkv, avi, mov, wmv, flv)
      expect(stats.total_files).toBe(6);
    });
  });
});
