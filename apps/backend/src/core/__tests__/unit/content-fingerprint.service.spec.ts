import { Test, type TestingModule } from '@nestjs/testing';
import { ContentFingerprintService } from '../../services/content-fingerprint.service';

jest.mock('node:fs/promises', () => ({
  stat: jest.fn(),
  open: jest.fn(),
}));

import { open, stat } from 'node:fs/promises';

const mockStat = stat as jest.MockedFunction<typeof stat>;
const mockOpen = open as jest.MockedFunction<typeof open>;

function createMockFileHandle(content: Buffer) {
  return {
    read: jest.fn((buffer: Buffer, offset: number, length: number, position: number) => {
      const src = content.subarray(position, position + length);
      src.copy(buffer, offset);
      return Promise.resolve({ bytesRead: src.length, buffer });
    }),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

describe('ContentFingerprintService', () => {
  let service: ContentFingerprintService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ContentFingerprintService],
    }).compile();

    service = module.get<ContentFingerprintService>(ContentFingerprintService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('computeFingerprint', () => {
    it('should return null for zero-byte files', async () => {
      mockStat.mockResolvedValue({ size: 0 } as any);

      const result = await service.computeFingerprint('/path/to/empty.mp4');

      expect(result).toBeNull();
      expect(mockOpen).not.toHaveBeenCalled();
    });

    it('should return null for inaccessible files (ENOENT)', async () => {
      const error = new Error('ENOENT: no such file or directory');
      (error as any).code = 'ENOENT';
      mockStat.mockRejectedValue(error);

      const result = await service.computeFingerprint('/path/to/missing.mp4');

      expect(result).toBeNull();
    });

    it('should hash entire content for small files (<100KB)', async () => {
      const fileSize = 50 * 1024; // 50KB
      const content = Buffer.alloc(fileSize, 0xab);
      const mockFh = createMockFileHandle(content);

      mockStat.mockResolvedValue({ size: fileSize } as any);
      mockOpen.mockResolvedValue(mockFh as any);

      const result = await service.computeFingerprint('/path/to/small.mp4');

      expect(result).not.toBeNull();
      expect(mockFh.read).toHaveBeenCalledTimes(1);
      expect(mockFh.read).toHaveBeenCalledWith(expect.any(Buffer), 0, fileSize, 0);
      expect(mockFh.close).toHaveBeenCalled();
    });

    it('should sample 10 positions for large files (>=100KB)', async () => {
      const fileSize = 1024 * 1024; // 1MB
      const content = Buffer.alloc(fileSize, 0xcd);
      const mockFh = createMockFileHandle(content);

      mockStat.mockResolvedValue({ size: fileSize } as any);
      mockOpen.mockResolvedValue(mockFh as any);

      const result = await service.computeFingerprint('/path/to/large.mp4');

      expect(result).not.toBeNull();
      expect(mockFh.read).toHaveBeenCalledTimes(10);
      expect(mockFh.close).toHaveBeenCalled();
    });

    it('should return consistent hash for same content', async () => {
      const fileSize = 200 * 1024;
      const content = Buffer.alloc(fileSize, 0xef);

      mockStat.mockResolvedValue({ size: fileSize } as any);

      mockOpen.mockResolvedValue(createMockFileHandle(content) as any);
      const result1 = await service.computeFingerprint('/path/to/file.mp4');

      mockOpen.mockResolvedValue(createMockFileHandle(content) as any);
      const result2 = await service.computeFingerprint('/path/to/file.mp4');

      expect(result1).toBe(result2);
    });

    it('should return different hash for different content', async () => {
      const fileSize = 50 * 1024;

      const content1 = Buffer.alloc(fileSize, 0xaa);
      const content2 = Buffer.alloc(fileSize, 0xbb);

      mockStat.mockResolvedValue({ size: fileSize } as any);

      mockOpen.mockResolvedValue(createMockFileHandle(content1) as any);
      const result1 = await service.computeFingerprint('/path/to/file1.mp4');

      mockOpen.mockResolvedValue(createMockFileHandle(content2) as any);
      const result2 = await service.computeFingerprint('/path/to/file2.mp4');

      expect(result1).not.toBe(result2);
    });

    it('should return different hash for same content but different file size', async () => {
      // Same byte pattern but different sizes — size is included in hash input
      const content1 = Buffer.alloc(1000, 0xaa);
      const content2 = Buffer.alloc(2000, 0xaa);

      mockStat.mockResolvedValueOnce({ size: 1000 } as any);
      mockOpen.mockResolvedValueOnce(createMockFileHandle(content1) as any);
      const result1 = await service.computeFingerprint('/path/to/file.mp4');

      mockStat.mockResolvedValueOnce({ size: 2000 } as any);
      mockOpen.mockResolvedValueOnce(createMockFileHandle(content2) as any);
      const result2 = await service.computeFingerprint('/path/to/file.mp4');

      expect(result1).not.toBe(result2);
    });

    it('should return a 16-character hex string', async () => {
      const fileSize = 10 * 1024;
      const content = Buffer.alloc(fileSize, 0x42);
      const mockFh = createMockFileHandle(content);

      mockStat.mockResolvedValue({ size: fileSize } as any);
      mockOpen.mockResolvedValue(mockFh as any);

      const result = await service.computeFingerprint('/path/to/file.mp4');

      expect(result).toMatch(/^[0-9a-f]{16}$/);
    });
  });
});
