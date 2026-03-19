import { Test, type TestingModule } from '@nestjs/testing';
import { ContentFingerprintService } from '../../content-fingerprint.service';

// Mock fs/promises
jest.mock('node:fs/promises', () => ({
  stat: jest.fn(),
  open: jest.fn(),
}));

// Mock xxhash-wasm — the service does `await import('xxhash-wasm')` then calls `.default()`
const mockXxhashInitFn = jest.fn();
jest.mock('xxhash-wasm', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockXxhashInitFn(...args),
}));

import { open, stat } from 'node:fs/promises';

const mockStat = stat as jest.MockedFunction<typeof stat>;
const mockOpen = open as jest.MockedFunction<typeof open>;

const SMALL_FILE_SIZE = 50 * 1024; // 50KB - below 100KB threshold
const LARGE_FILE_SIZE = 200 * 1024; // 200KB - above 100KB threshold

function makeMockFileHandle(readImpl?: jest.Mock): ReturnType<typeof open> {
  const mockRead = readImpl ?? jest.fn().mockResolvedValue({ bytesRead: 4096 });
  const mockClose = jest.fn().mockResolvedValue(undefined);
  return Promise.resolve({ read: mockRead, close: mockClose } as unknown as Awaited<
    ReturnType<typeof open>
  >);
}

function makeHasher(hashValue = BigInt('0xdeadbeefcafebabe')) {
  return { h64Raw: jest.fn().mockReturnValue(hashValue) };
}

describe('ContentFingerprintService', () => {
  let service: ContentFingerprintService;
  let mockHasher: ReturnType<typeof makeHasher>;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockHasher = makeHasher();
    mockXxhashInitFn.mockResolvedValue(mockHasher);

    const module: TestingModule = await Test.createTestingModule({
      providers: [ContentFingerprintService],
    }).compile();

    service = module.get<ContentFingerprintService>(ContentFingerprintService);
  });

  it('should be defined', () => {
    expect(service).toBeInstanceOf(ContentFingerprintService);
  });

  describe('computeFingerprint', () => {
    it('should return null for empty file', async () => {
      mockStat.mockResolvedValue({ size: 0 } as Awaited<ReturnType<typeof stat>>);

      const result = await service.computeFingerprint('/path/to/empty.mkv');

      expect(result).toBeNull();
    });

    it('should return null when stat throws', async () => {
      mockStat.mockRejectedValue(new Error('ENOENT: no such file'));

      const result = await service.computeFingerprint('/path/to/missing.mkv');

      expect(result).toBeNull();
    });

    it('should return null when file open throws', async () => {
      mockStat.mockResolvedValue({ size: SMALL_FILE_SIZE } as Awaited<ReturnType<typeof stat>>);
      mockOpen.mockRejectedValue(new Error('EACCES: permission denied'));

      const result = await service.computeFingerprint('/path/to/locked.mkv');

      expect(result).toBeNull();
    });

    it('should hash entire content for small files (< 100KB)', async () => {
      mockStat.mockResolvedValue({ size: SMALL_FILE_SIZE } as Awaited<ReturnType<typeof stat>>);
      const fhClose = jest.fn().mockResolvedValue(undefined);
      const fhRead = jest.fn().mockResolvedValue({ bytesRead: SMALL_FILE_SIZE });
      mockOpen.mockResolvedValue({ read: fhRead, close: fhClose } as unknown as Awaited<
        ReturnType<typeof open>
      >);

      const result = await service.computeFingerprint('/path/to/small.mkv');

      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result!.length).toBe(16); // 16 hex chars = 64-bit hash
      expect(fhRead).toHaveBeenCalledTimes(1);
      expect(fhRead).toHaveBeenCalledWith(expect.any(Buffer), 0, SMALL_FILE_SIZE, 0);
      expect(fhClose).toHaveBeenCalled();
    });

    it('should sample at 10 positions for large files (>= 100KB)', async () => {
      mockStat.mockResolvedValue({ size: LARGE_FILE_SIZE } as Awaited<ReturnType<typeof stat>>);
      const fhClose = jest.fn().mockResolvedValue(undefined);
      const fhRead = jest.fn().mockResolvedValue({ bytesRead: 4096 });
      mockOpen.mockResolvedValue({ read: fhRead, close: fhClose } as unknown as Awaited<
        ReturnType<typeof open>
      >);

      const result = await service.computeFingerprint('/path/to/large.mkv');

      expect(result).not.toBeNull();
      expect(fhRead).toHaveBeenCalledTimes(10); // SAMPLE_COUNT = 10
      expect(fhClose).toHaveBeenCalled();
    });

    it('should call fh.close even when read throws (small file)', async () => {
      mockStat.mockResolvedValue({ size: SMALL_FILE_SIZE } as Awaited<ReturnType<typeof stat>>);
      const fhClose = jest.fn().mockResolvedValue(undefined);
      const fhRead = jest.fn().mockRejectedValue(new Error('read error'));
      mockOpen.mockResolvedValue({ read: fhRead, close: fhClose } as unknown as Awaited<
        ReturnType<typeof open>
      >);

      const result = await service.computeFingerprint('/path/to/bad.mkv');

      expect(result).toBeNull();
      expect(fhClose).toHaveBeenCalled();
    });

    it('should call fh.close even when read throws (large file)', async () => {
      mockStat.mockResolvedValue({ size: LARGE_FILE_SIZE } as Awaited<ReturnType<typeof stat>>);
      const fhClose = jest.fn().mockResolvedValue(undefined);
      const fhRead = jest.fn().mockRejectedValue(new Error('read error'));
      mockOpen.mockResolvedValue({ read: fhRead, close: fhClose } as unknown as Awaited<
        ReturnType<typeof open>
      >);

      const result = await service.computeFingerprint('/path/to/bad-large.mkv');

      expect(result).toBeNull();
      expect(fhClose).toHaveBeenCalled();
    });

    it('should return a 16-character hex string', async () => {
      mockStat.mockResolvedValue({ size: SMALL_FILE_SIZE } as Awaited<ReturnType<typeof stat>>);
      mockOpen.mockImplementation(() => makeMockFileHandle());
      mockHasher.h64Raw.mockReturnValue(BigInt('0x000000000000000f'));

      const result = await service.computeFingerprint('/path/to/file.mkv');

      expect(result).toBe('000000000000000f');
    });

    it('should include file size in the hash data', async () => {
      mockStat.mockResolvedValue({ size: SMALL_FILE_SIZE } as Awaited<ReturnType<typeof stat>>);
      mockOpen.mockImplementation(() => makeMockFileHandle());

      await service.computeFingerprint('/path/to/file.mkv');

      const callArg = mockHasher.h64Raw.mock.calls[0][0] as Uint8Array;
      // First 8 bytes are the size (little-endian int64)
      const view = new DataView(callArg.buffer, callArg.byteOffset, 8);
      const sizeInData = Number(view.getBigInt64(0, true));
      expect(sizeInData).toBe(SMALL_FILE_SIZE);
    });

    it('should lazily initialize xxhash-wasm only once across multiple calls', async () => {
      // Use a fresh service instance (not re-created between calls) to test caching
      mockStat.mockResolvedValue({ size: SMALL_FILE_SIZE } as Awaited<ReturnType<typeof stat>>);
      mockOpen.mockImplementation(() => makeMockFileHandle());

      // Both calls on the same `service` instance — xxhash init cached after first call
      await service.computeFingerprint('/path/1.mkv');
      // Reset call count but NOT the cached hasher on the service
      mockXxhashInitFn.mockClear();
      await service.computeFingerprint('/path/2.mkv');

      // Should not have been called again — result was cached
      expect(mockXxhashInitFn).toHaveBeenCalledTimes(0);
    });

    it('should handle large files at exactly the threshold boundary (100KB)', async () => {
      const BOUNDARY_SIZE = 100 * 1024; // exactly 100KB - boundary is < threshold so this is large
      mockStat.mockResolvedValue({ size: BOUNDARY_SIZE } as Awaited<ReturnType<typeof stat>>);
      const fhClose = jest.fn().mockResolvedValue(undefined);
      const fhRead = jest.fn().mockResolvedValue({ bytesRead: 4096 });
      mockOpen.mockResolvedValue({ read: fhRead, close: fhClose } as unknown as Awaited<
        ReturnType<typeof open>
      >);

      await service.computeFingerprint('/path/to/boundary.mkv');

      // 100KB is NOT < 100KB threshold, so it uses sampling (10 reads)
      expect(fhRead).toHaveBeenCalledTimes(10);
    });

    it('should sample evenly-spaced positions for large files', async () => {
      mockStat.mockResolvedValue({ size: LARGE_FILE_SIZE } as Awaited<ReturnType<typeof stat>>);
      const fhClose = jest.fn().mockResolvedValue(undefined);
      const fhRead = jest.fn().mockResolvedValue({ bytesRead: 4096 });
      mockOpen.mockResolvedValue({ read: fhRead, close: fhClose } as unknown as Awaited<
        ReturnType<typeof open>
      >);

      await service.computeFingerprint('/path/to/large.mkv');

      // First sample at position 0, others evenly spaced
      const positions = fhRead.mock.calls.map((call: unknown[]) => call[3] as number);
      expect(positions[0]).toBe(0);
      for (let i = 1; i < 10; i++) {
        expect(positions[i]).toBe(Math.floor((LARGE_FILE_SIZE / 10) * i));
      }
    });
  });
});
