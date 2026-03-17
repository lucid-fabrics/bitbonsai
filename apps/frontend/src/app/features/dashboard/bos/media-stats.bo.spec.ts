import { MediaStatsBo } from './media-stats.bo';

describe('MediaStatsBo', () => {
  describe('constructor and mapping', () => {
    it('should create instance from model', () => {
      const mockModel = {
        total_size_gb: 100,
        total_files: 50,
        average_bitrate_mbps: 5.5,
        codec_distribution: {
          hevc: 30,
          h264: 15,
          av1: 3,
          other: 2,
        },
        folders: [],
        scan_timestamp: '2025-01-01T00:00:00Z',
      };

      const bo = new MediaStatsBo(mockModel);

      expect(bo.totalSizeGB).toBe(100);
      expect(bo.totalFiles).toBe(50);
      expect(bo.averageBitrateMbps).toBe(5.5);
      expect(bo.codecDistribution.hevc).toBe(30);
      expect(bo.codecDistribution.h264).toBe(15);
      expect(bo.codecDistribution.av1).toBe(3);
      expect(bo.codecDistribution.other).toBe(2);
      expect(bo.scanTimestamp).toEqual(new Date('2025-01-01T00:00:00Z'));
    });

    it('should handle missing optional fields', () => {
      const mockModel = {
        total_size_gb: 100,
        total_files: 50,
        scan_timestamp: '2025-01-01T00:00:00Z',
      };

      const bo = new MediaStatsBo(mockModel as never);

      expect(bo.totalSizeGB).toBe(100);
      expect(bo.totalFiles).toBe(50);
      expect(bo.averageBitrateMbps).toBe(0);
      expect(bo.codecDistribution.hevc).toBe(0);
      expect(bo.folders).toEqual([]);
    });

    it('should handle null/undefined values gracefully', () => {
      const mockModel = {
        total_size_gb: null,
        total_files: undefined,
        scan_timestamp: '2025-01-01T00:00:00Z',
      };

      expect(() => new MediaStatsBo(mockModel as never)).not.toThrow();
    });
  });

  describe('business logic methods', () => {
    it('should provide formatted data', () => {
      const mockModel = {
        total_size_gb: 1500,
        total_files: 100,
        average_bitrate_mbps: 5.5,
        codec_distribution: {
          hevc: 60,
          h264: 30,
          av1: 5,
          other: 5,
        },
        folders: [],
        scan_timestamp: '2025-01-01T00:00:00Z',
      };

      const bo = new MediaStatsBo(mockModel);

      expect(bo.totalSizeFormatted).toBe('1500.00 GB');
      expect(bo.totalSizeFormattedLarge).toBe('1.50 TB');
      expect(bo.hevcPercentage).toBe(60);
      expect(bo.h264Percentage).toBe(30);
      expect(bo.completionPercentage).toBe(60);
      expect(bo.h264RemainingCount).toBe(30);
    });
  });
});
