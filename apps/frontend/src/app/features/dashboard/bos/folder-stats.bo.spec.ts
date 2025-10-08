import type { FolderStatsModel } from '../models/folder-stats.model';
import { FolderStatsBo } from './folder-stats.bo';

describe('FolderStatsBo', () => {
  describe('constructor and mapping', () => {
    it('should create instance from model', () => {
      const mockModel: FolderStatsModel = {
        name: 'Test Folder',
        path: '/test/path',
        total_size_gb: 100,
        file_count: 10,
        codec_distribution: { hevc: 5, h264: 3, av1: 1, other: 1 },
        percent_h265: 50,
        sampled: 10,
        avg_bitrate_mbps: 5.5,
        space_saved_estimate_gb: 20,
      };

      const bo = new FolderStatsBo(mockModel);

      expect(bo.name).toBe('Test Folder');
      expect(bo.path).toBe('/test/path');
      expect(bo.totalSizeGB).toBe(100);
    });

    it('should handle missing optional fields', () => {
      const mockModel: Partial<FolderStatsModel> = {
        name: 'Test',
        path: '/test',
      };

      const bo = new FolderStatsBo(mockModel as FolderStatsModel);

      expect(bo.name).toBe('Test');
      expect(bo.path).toBe('/test');
    });

    it('should handle null/undefined values gracefully', () => {
      const mockModel: Partial<FolderStatsModel> = {
        name: 'Test',
      };

      expect(() => new FolderStatsBo(mockModel as FolderStatsModel)).not.toThrow();
    });
  });

  describe('business logic methods', () => {
    it('should provide formatted data', () => {
      const mockModel = {
        id: '1',
        name: 'Test',
        createdAt: new Date('2025-01-01'),
      };

      const bo = new FolderStatsBo(mockModel);

      expect(bo).toBeDefined();
    });
  });
});
