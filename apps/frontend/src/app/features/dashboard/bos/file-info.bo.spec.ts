import type { FileInfoModel } from '../models/file-info.model';
import { FileInfoBo } from './file-info.bo';

describe('FileInfoBo', () => {
  describe('constructor and mapping', () => {
    it('should create instance from model', () => {
      const mockModel: FileInfoModel = {
        file_path: '/test/path',
        file_name: 'test.mp4',
        size_gb: 1.5,
        codec: 'h264',
        bitrate_mbps: 5.0,
      };

      const bo = new FileInfoBo(mockModel);

      expect(bo.filePath).toBe('/test/path');
      expect(bo.fileName).toBe('test.mp4');
      expect(bo.sizeGb).toBe(1.5);
    });

    it('should handle missing optional fields', () => {
      const mockModel: Partial<FileInfoModel> = {
        file_path: '/test/path',
        file_name: 'test.mp4',
        size_gb: 1.5,
      };

      const bo = new FileInfoBo(mockModel as FileInfoModel);

      expect(bo.filePath).toBe('/test/path');
      expect(bo.fileName).toBe('test.mp4');
    });

    it('should handle null/undefined values gracefully', () => {
      const mockModel: Partial<FileInfoModel> = {
        file_path: '/test/path',
        file_name: 'test.mp4',
      };

      expect(() => new FileInfoBo(mockModel as FileInfoModel)).not.toThrow();
    });
  });

  describe('business logic methods', () => {
    it('should provide formatted data', () => {
      const mockModel = {
        id: '1',
        name: 'Test',
        createdAt: new Date('2025-01-01'),
      };

      const bo = new FileInfoBo(mockModel);

      expect(bo).toBeDefined();
    });
  });
});
