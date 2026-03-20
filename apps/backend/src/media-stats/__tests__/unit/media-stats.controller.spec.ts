import { Test, type TestingModule } from '@nestjs/testing';
import { MediaStatsController } from '../../media-stats.controller';
import { MediaStatsService } from '../../media-stats.service';

describe('MediaStatsController', () => {
  let controller: MediaStatsController;

  const mockMediaStatsService = {
    getMediaStats: jest.fn(),
    triggerScan: jest.fn(),
    getFolderFiles: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MediaStatsController],
      providers: [{ provide: MediaStatsService, useValue: mockMediaStatsService }],
    }).compile();

    controller = module.get<MediaStatsController>(MediaStatsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getStats', () => {
    it('should return media stats from service', async () => {
      const result = {
        totalLibrarySize: 1000000,
        totalFileCount: 250,
        averageBitrate: 4000,
        codecDistribution: { 'H.264': 150, HEVC: 100 },
        folderStats: [],
        potentialSavings: 200000,
      };
      mockMediaStatsService.getMediaStats.mockResolvedValue(result);

      const response = await controller.getStats();

      expect(mockMediaStatsService.getMediaStats).toHaveBeenCalledTimes(1);
      expect(response).toEqual(result);
    });

    it('should propagate service errors', async () => {
      mockMediaStatsService.getMediaStats.mockRejectedValue(new Error('scan error'));
      await expect(controller.getStats()).rejects.toThrow('scan error');
    });
  });

  describe('triggerScan', () => {
    it('should trigger a scan and return void', async () => {
      mockMediaStatsService.triggerScan.mockResolvedValue(undefined);

      const response = await controller.triggerScan();

      expect(mockMediaStatsService.triggerScan).toHaveBeenCalledTimes(1);
      expect(response).toBeUndefined();
    });

    it('should propagate service errors', async () => {
      mockMediaStatsService.triggerScan.mockRejectedValue(new Error('no paths configured'));
      await expect(controller.triggerScan()).rejects.toThrow('no paths configured');
    });
  });

  describe('getFolderFiles', () => {
    it('should return files for folder and codec filter', async () => {
      const result = {
        folderName: 'Movies',
        files: [
          { name: 'movie.mkv', path: '/media/Movies/movie.mkv', codec: 'h264', size: 4000000 },
        ],
        totalCount: 1,
      };
      mockMediaStatsService.getFolderFiles.mockResolvedValue(result);

      const response = await controller.getFolderFiles('Movies', 'h264');

      expect(mockMediaStatsService.getFolderFiles).toHaveBeenCalledWith('Movies', 'h264');
      expect(response).toEqual(result);
    });

    it('should return files for folder without codec filter', async () => {
      const result = { folderName: 'TV', files: [], totalCount: 0 };
      mockMediaStatsService.getFolderFiles.mockResolvedValue(result);

      const response = await controller.getFolderFiles('TV', undefined);

      expect(mockMediaStatsService.getFolderFiles).toHaveBeenCalledWith('TV', undefined);
      expect(response).toEqual(result);
    });

    it('should propagate service errors', async () => {
      mockMediaStatsService.getFolderFiles.mockRejectedValue(new Error('folder not found'));
      await expect(controller.getFolderFiles('Unknown', 'h264')).rejects.toThrow(
        'folder not found'
      );
    });
  });
});
