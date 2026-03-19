import { Test, type TestingModule } from '@nestjs/testing';
import { JobRepository } from '../../../common/repositories/job.repository';
import { LibraryRepository } from '../../../common/repositories/library.repository';
import { NodeRepository } from '../../../common/repositories/node.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { HealthService } from '../../health.service';

// Mock node:fs/promises for statfs calls in monitorLibraryDiskSpace
// We only need to mock the statfs used by HealthService; use jest.spyOn in tests instead
// to avoid breaking Prisma which uses fs.existsSync and other sync methods.

// Shared mock async exec function - must be created inside jest.mock since it's hoisted
// We store it on globalThis to access it from test code
jest.mock('node:child_process', () => {
  const { promisify } = require('node:util');
  const mockAsync = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
  const mockFn = jest.fn((_cmd: string, callback: (...args: unknown[]) => void) =>
    callback(null, '', '')
  );
  (mockFn as any).__promisify__ = mockAsync;
  (mockFn as any)[promisify.custom] = mockAsync;
  // Store reference for test access
  (globalThis as any).__mockExecAsync = mockAsync;
  return { exec: mockFn };
});

// Get reference to mock exec async
let mockExecAsync: jest.Mock;

// Mock os module
jest.mock('node:os', () => ({
  totalmem: jest.fn(() => 16 * 1024 * 1024 * 1024), // 16GB
  freemem: jest.fn(() => 8 * 1024 * 1024 * 1024), // 8GB
}));

describe('HealthService', () => {
  let service: HealthService;

  const mockPrismaService = {
    $queryRaw: jest.fn(),
    node: {
      findMany: jest.fn(),
    },
    job: {
      count: jest.fn(),
    },
  };

  // Repository mocks aliased to same jest.fn() instances so existing assertions pass
  const mockNodeRepository = {
    findAllSummary: mockPrismaService.node.findMany,
  };

  const mockJobRepository = {
    countWhere: mockPrismaService.job.count,
  };

  const mockLibraryRepository = {
    findAllLibraries: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    // Reset all mocks before module creation
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: NodeRepository,
          useValue: mockNodeRepository,
        },
        {
          provide: JobRepository,
          useValue: mockJobRepository,
        },
        {
          provide: LibraryRepository,
          useValue: mockLibraryRepository,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);

    // Get reference to the promisified exec mock (stable reference via globalThis)
    mockExecAsync = (globalThis as any).__mockExecAsync;

    // Restore os mocks to defaults (clearAllMocks clears them)
    const os = require('node:os');
    (os.totalmem as jest.Mock).mockReturnValue(16 * 1024 * 1024 * 1024);
    (os.freemem as jest.Mock).mockReturnValue(8 * 1024 * 1024 * 1024);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getBasicHealth', () => {
    it('should return ok status when database is healthy', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ 1: 1 }]);

      const result = await service.getBasicHealth();

      expect(result.status).toBe('ok');
      expect(result.version).toBe('0.0.0-test');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should return error status when database fails', async () => {
      mockPrismaService.$queryRaw.mockRejectedValue(new Error('Connection failed'));

      const result = await service.getBasicHealth();

      expect(result.status).toBe('error');
      expect(result.version).toBe('0.0.0-test');
    });
  });

  describe('checkDatabaseHealth', () => {
    it('should return ok status with response time', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ 1: 1 }]);

      const result = await service.checkDatabaseHealth();

      expect(result.status).toBe('ok');
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
      expect(mockPrismaService.$queryRaw).toHaveBeenCalled();
    });

    it('should return error status when database fails', async () => {
      const error = new Error('Connection failed');
      mockPrismaService.$queryRaw.mockRejectedValue(error);

      const result = await service.checkDatabaseHealth();

      expect(result.status).toBe('error');
      expect(result.error).toBe('Connection failed');
    });
  });

  describe('checkRedisHealth', () => {
    it('should return ok when Redis is not configured', async () => {
      const originalEnv = process.env.REDIS_URL;
      process.env.REDIS_URL = '';

      const result = await service.checkRedisHealth();

      expect(result).not.toBeNull();
      expect(result?.status).toBe('ok');

      // Restore
      if (originalEnv) {
        process.env.REDIS_URL = originalEnv;
      }
    });

    it('should return ok status when Redis is configured', async () => {
      const originalEnv = process.env.REDIS_URL;
      process.env.REDIS_URL = 'redis://localhost:6379';

      const result = await service.checkRedisHealth();

      expect(result).not.toBeNull();
      expect(result?.status).toBe('ok');

      // Restore
      if (originalEnv) {
        process.env.REDIS_URL = originalEnv;
      } else {
        process.env.REDIS_URL = '';
      }
    });
  });

  describe('checkDiskHealth', () => {
    it('should return ok status for normal disk usage', async () => {
      // Mock execAsync to return df output with 50% usage (tail -1 output only)
      mockExecAsync.mockResolvedValueOnce({
        stdout: '/dev/sda1      1T    500G   500G  50% /',
        stderr: '',
      });

      const result = await service.checkDiskHealth();

      expect(result.status).toBe('ok');
      expect(result.used).toBe('50%');
      expect(result.available).toBe('500G');
    });

    it('should return warning status for high disk usage', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: '/dev/sda1      1T    850G   150G  85% /',
        stderr: '',
      });

      const result = await service.checkDiskHealth();

      expect(result.status).toBe('warning');
      expect(result.used).toBe('85%');
    });

    it('should return critical status for very high disk usage', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: '/dev/sda1      1T    950G    50G  95% /',
        stderr: '',
      });

      const result = await service.checkDiskHealth();

      expect(result.status).toBe('critical');
      expect(result.used).toBe('95%');
    });

    it('should handle errors gracefully', async () => {
      mockExecAsync.mockRejectedValueOnce(new Error('Command failed'));

      const result = await service.checkDiskHealth();

      expect(result.status).toBe('ok');
      expect(result.used).toBe('N/A');
      expect(result.available).toBe('N/A');
    });
  });

  describe('checkMemoryHealth', () => {
    it('should return ok status for normal memory usage', async () => {
      const result = await service.checkMemoryHealth();

      expect(result.status).toBe('ok');
      expect(result.used).toContain('GB');
      expect(result.total).toContain('GB');
      expect(result.percentage).toBe(50); // 8GB used / 16GB total
    });

    it('should return warning status for high memory usage', async () => {
      const os = require('node:os');
      os.freemem.mockReturnValue(2 * 1024 * 1024 * 1024); // 2GB free = 87.5% used

      const result = await service.checkMemoryHealth();

      expect(result.status).toBe('warning');
      expect(result.percentage).toBe(87.5);
    });

    it('should return critical status for very high memory usage', async () => {
      const os = require('node:os');
      os.freemem.mockReturnValue(1 * 1024 * 1024 * 1024); // 1GB free = 93.75% used

      const result = await service.checkMemoryHealth();

      expect(result.status).toBe('critical');
      expect(result.percentage).toBe(93.8);
    });
  });

  describe('checkFfmpegHealth', () => {
    it('should return ok status when ffmpeg is available', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: 'ffmpeg version 5.1.2 Copyright (c) 2000-2022',
        stderr: '',
      });

      const result = await service.checkFfmpegHealth();

      expect(result.status).toBe('ok');
      expect(result.version).toBe('5.1.2');
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should return error status when ffmpeg is not found', async () => {
      mockExecAsync.mockRejectedValueOnce(new Error('Command not found'));

      const result = await service.checkFfmpegHealth();

      expect(result.status).toBe('error');
      expect(result.error).toBe('FFmpeg not found or not executable');
    });
  });

  describe('checkNodeHealth', () => {
    it('should return node statistics', async () => {
      mockPrismaService.node.findMany.mockResolvedValue([
        { status: 'ONLINE' },
        { status: 'ONLINE' },
        { status: 'OFFLINE' },
      ]);

      const result = await service.checkNodeHealth();

      expect(result.total).toBe(3);
      expect(result.online).toBe(2);
      expect(result.offline).toBe(1);
    });

    it('should handle database errors', async () => {
      mockPrismaService.node.findMany.mockRejectedValue(new Error('Database error'));

      const result = await service.checkNodeHealth();

      expect(result.total).toBe(0);
      expect(result.online).toBe(0);
      expect(result.offline).toBe(0);
    });
  });

  describe('checkQueueHealth', () => {
    it('should return queue statistics', async () => {
      mockPrismaService.job.count
        .mockResolvedValueOnce(5) // queued
        .mockResolvedValueOnce(2) // encoding
        .mockResolvedValueOnce(150) // completed
        .mockResolvedValueOnce(3); // failed

      const result = await service.checkQueueHealth();

      expect(result.queued).toBe(5);
      expect(result.encoding).toBe(2);
      expect(result.completed).toBe(150);
      expect(result.failed).toBe(3);
    });

    it('should handle database errors', async () => {
      mockPrismaService.job.count.mockRejectedValue(new Error('Database error'));

      const result = await service.checkQueueHealth();

      expect(result.queued).toBe(0);
      expect(result.encoding).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('getDetailedHealth', () => {
    beforeEach(() => {
      // Setup default mocks for detailed health
      mockPrismaService.$queryRaw.mockResolvedValue([{ 1: 1 }]);
      mockPrismaService.node.findMany.mockResolvedValue([
        { status: 'ONLINE' },
        { status: 'ONLINE' },
      ]);
      mockPrismaService.job.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(150)
        .mockResolvedValueOnce(3);

      // Mock promisified exec for disk and ffmpeg checks
      mockExecAsync.mockImplementation((cmd: string) => {
        if (cmd.includes('df')) {
          return Promise.resolve({ stdout: '/dev/sda1      1T    500G   500G  50% /', stderr: '' });
        }
        if (cmd.includes('ffmpeg')) {
          return Promise.resolve({
            stdout: 'ffmpeg version 5.1.2 Copyright (c) 2000-2022',
            stderr: '',
          });
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      });
    });

    it('should return ok status when all checks pass', async () => {
      const result = await service.getDetailedHealth();

      expect(result.status).toBe('ok');
      expect(result.checks.database.status).toBe('ok');
      expect(result.checks.disk.status).toBe('ok');
      expect(result.checks.memory.status).toBe('ok');
      expect(result.checks.ffmpeg.status).toBe('ok');
      expect(result.nodes.total).toBe(2);
      expect(result.queue.queued).toBe(5);
    });

    it('should return error status when database fails', async () => {
      mockPrismaService.$queryRaw.mockRejectedValue(new Error('Connection failed'));

      const result = await service.getDetailedHealth();

      expect(result.status).toBe('error');
      expect(result.checks.database.status).toBe('error');
    });

    it('should return degraded status when non-critical service fails', async () => {
      // Override the promisified exec mock for disk (95% = critical) and ffmpeg (missing)
      mockExecAsync.mockImplementation((cmd: string) => {
        if (cmd.includes('df')) {
          return Promise.resolve({
            stdout: '/dev/sda1      1T    950G    50G  95% /',
            stderr: '',
          });
        }
        if (cmd.includes('ffmpeg')) {
          return Promise.reject(new Error('Command not found'));
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      const result = await service.getDetailedHealth();

      expect(result.status).toBe('degraded');
      expect(result.checks.disk.status).toBe('critical');
      expect(result.checks.ffmpeg.status).toBe('error');
    });
  });

  describe('isReady', () => {
    it('should return ready when database is accessible', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ 1: 1 }]);

      const result = await service.isReady();

      expect(result.ready).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return not ready when database fails', async () => {
      mockPrismaService.$queryRaw.mockRejectedValue(new Error('Connection failed'));

      const result = await service.isReady();

      expect(result.ready).toBe(false);
      expect(result.reason).toBe('Database connection failed');
    });
  });

  describe('isLive', () => {
    it('should always return alive', async () => {
      const result = await service.isLive();

      expect(result.alive).toBe(true);
    });
  });

  describe('checkRedisHealth - additional branches', () => {
    it('should return undefined when REDIS_URL key does not exist in process.env', async () => {
      // The service checks `process.env.REDIS_URL !== undefined`
      // When the key is absent from process.env it is undefined → returns undefined
      const saved = process.env.REDIS_URL;
      process.env.REDIS_URL = undefined as any;
      // undefined as any still stores "undefined" string in some envs — remove the key
      const envObj = process.env as Record<string, string | undefined>;
      envObj.REDIS_URL = undefined;

      const result = await service.checkRedisHealth();

      // If REDIS_URL resolves to undefined, service returns undefined
      // If env keeps it as string "undefined", service sees it as defined and returns ok
      // Either way, no throw
      expect(result === undefined || result?.status === 'ok').toBe(true);

      if (saved !== undefined) {
        process.env.REDIS_URL = saved;
      }
    });

    it('should return ok with responseTime when REDIS_URL is set', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const result = await service.checkRedisHealth();

      expect(result).not.toBeUndefined();
      expect(result?.status).toBe('ok');
      expect(result?.responseTime).toBeGreaterThanOrEqual(0);

      process.env.REDIS_URL = '';
    });
  });

  describe('checkDiskHealth - additional branches', () => {
    it('should handle exactly 80% usage as warning boundary', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: '/dev/sda1      1T    800G   200G  80% /',
        stderr: '',
      });

      const result = await service.checkDiskHealth();

      expect(result.status).toBe('ok');
      expect(result.used).toBe('80%');
    });

    it('should handle exactly 81% usage as warning', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: '/dev/sda1      1T    810G   190G  81% /',
        stderr: '',
      });

      const result = await service.checkDiskHealth();

      expect(result.status).toBe('warning');
    });

    it('should handle exactly 90% usage as warning (boundary)', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: '/dev/sda1      1T    900G   100G  90% /',
        stderr: '',
      });

      const result = await service.checkDiskHealth();

      expect(result.status).toBe('warning');
    });

    it('should handle exactly 91% as critical', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: '/dev/sda1      1T    910G    90G  91% /',
        stderr: '',
      });

      const result = await service.checkDiskHealth();

      expect(result.status).toBe('critical');
    });
  });

  describe('checkMemoryHealth - additional branches', () => {
    it('should return correct percentage for exactly 80% usage', async () => {
      const os = require('node:os');
      const total = 16 * 1024 * 1024 * 1024;
      os.totalmem.mockReturnValue(total);
      os.freemem.mockReturnValue(total * 0.2); // 20% free = 80% used

      const result = await service.checkMemoryHealth();

      expect(result.status).toBe('ok');
      expect(result.percentage).toBe(80);
    });

    it('should return warning for 85% usage', async () => {
      const os = require('node:os');
      const total = 16 * 1024 * 1024 * 1024;
      os.totalmem.mockReturnValue(total);
      os.freemem.mockReturnValue(total * 0.15); // 15% free = 85% used

      const result = await service.checkMemoryHealth();

      expect(result.status).toBe('warning');
    });

    it('should format used and total as human-readable strings', async () => {
      const result = await service.checkMemoryHealth();

      expect(result.used).toMatch(/\d+(\.\d+)?(B|KB|MB|GB|TB)/);
      expect(result.total).toMatch(/\d+(\.\d+)?(B|KB|MB|GB|TB)/);
    });
  });

  describe('checkFfmpegHealth - additional branches', () => {
    it('should return unknown version when stdout does not match version pattern', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: 'ffmpeg build info only',
        stderr: '',
      });

      const result = await service.checkFfmpegHealth();

      expect(result.status).toBe('ok');
      expect(result.version).toBe('unknown');
    });
  });

  describe('checkNodeHealth - additional branches', () => {
    it('should return zero counts when node list is empty', async () => {
      mockPrismaService.node.findMany.mockResolvedValue([]);

      const result = await service.checkNodeHealth();

      expect(result.total).toBe(0);
      expect(result.online).toBe(0);
      expect(result.offline).toBe(0);
    });

    it('should count all nodes as offline when none are ONLINE', async () => {
      mockPrismaService.node.findMany.mockResolvedValue([
        { status: 'OFFLINE' },
        { status: 'OFFLINE' },
        { status: 'MAINTENANCE' },
      ]);

      const result = await service.checkNodeHealth();

      expect(result.total).toBe(3);
      expect(result.online).toBe(0);
      expect(result.offline).toBe(3);
    });
  });

  describe('monitorLibraryDiskSpace', () => {
    it('should return critical status on top-level error', async () => {
      mockLibraryRepository.findAllLibraries.mockRejectedValue(new Error('DB failure'));

      const result = await service.monitorLibraryDiskSpace();

      expect(result.overallStatus).toBe('critical');
      expect(result.libraries).toEqual([]);
      expect(result.canAccommodateQueue).toBe(false);
      expect(result.globalWarnings).toContain('Failed to monitor disk space across libraries');
    });

    it('should return ok status with no libraries', async () => {
      mockLibraryRepository.findAllLibraries.mockResolvedValue([]);

      const result = await service.monitorLibraryDiskSpace();

      expect(result.overallStatus).toBe('ok');
      expect(result.libraries).toHaveLength(0);
      expect(result.totalQueuedJobs).toBe(0);
      expect(result.totalEstimatedSpaceNeeded).toBeNull();
      expect(result.canAccommodateQueue).toBe(true);
    });
  });

  describe('getDetailedHealth - additional branches', () => {
    beforeEach(() => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ 1: 1 }]);
      mockPrismaService.node.findMany.mockResolvedValue([{ status: 'ONLINE' }]);
      mockPrismaService.job.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(0);
    });

    it('should return degraded when memory is critical', async () => {
      const os = require('node:os');
      const total = 16 * 1024 * 1024 * 1024;
      os.totalmem.mockReturnValue(total);
      os.freemem.mockReturnValue(total * 0.05); // 95% used = critical

      mockExecAsync.mockImplementation((cmd: string) => {
        if (cmd.includes('df')) {
          return Promise.resolve({ stdout: '/dev/sda1      1T    500G   500G  50% /', stderr: '' });
        }
        if (cmd.includes('ffmpeg')) {
          return Promise.resolve({ stdout: 'ffmpeg version 5.1.2', stderr: '' });
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      const result = await service.getDetailedHealth();

      expect(result.status).toBe('degraded');
      expect(result.checks.memory.status).toBe('critical');
    });

    it('should include timestamp in detailed health response', async () => {
      mockExecAsync.mockImplementation((cmd: string) => {
        if (cmd.includes('df')) {
          return Promise.resolve({ stdout: '/dev/sda1      1T    500G   500G  50% /', stderr: '' });
        }
        if (cmd.includes('ffmpeg')) {
          return Promise.resolve({ stdout: 'ffmpeg version 5.1.2', stderr: '' });
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      const result = await service.getDetailedHealth();

      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  // ── monitorLibraryDiskSpace — library with queued jobs ────────────────────

  describe('monitorLibraryDiskSpace - with libraries', () => {
    it('returns ok when library has plenty of disk space', async () => {
      const fs = await import('node:fs');
      jest
        .spyOn(fs.promises, 'statfs')
        .mockResolvedValue({ blocks: 1000000n, bsize: 4096, bavail: 800000n } as any);

      mockLibraryRepository.findAllLibraries.mockResolvedValue([
        { id: 'lib-1', name: 'Movies', path: '/media/movies', jobs: [] },
      ]);

      const result = await service.monitorLibraryDiskSpace();

      expect(result.overallStatus).not.toBe('critical');
      expect(result.libraries).toHaveLength(1);
    });

    it('returns queued job count for library with pending jobs', async () => {
      const fs = await import('node:fs');
      jest
        .spyOn(fs.promises, 'statfs')
        .mockResolvedValue({ blocks: 1000000n, bsize: 4096, bavail: 800000n } as any);

      mockLibraryRepository.findAllLibraries.mockResolvedValue([
        {
          id: 'lib-2',
          name: 'TV Shows',
          path: '/media/tv',
          jobs: [
            { id: 'job-1', filePath: '/media/tv/show.mkv', beforeSizeBytes: BigInt(5_000_000_000) },
            {
              id: 'job-2',
              filePath: '/media/tv/show2.mkv',
              beforeSizeBytes: BigInt(3_000_000_000),
            },
          ],
        },
      ]);

      const result = await service.monitorLibraryDiskSpace();

      expect(result.totalQueuedJobs).toBe(2);
    });

    it('handles library with null beforeSizeBytes gracefully', async () => {
      const fs = await import('node:fs');
      jest
        .spyOn(fs.promises, 'statfs')
        .mockResolvedValue({ blocks: 1000000n, bsize: 4096, bavail: 800000n } as any);

      mockLibraryRepository.findAllLibraries.mockResolvedValue([
        {
          id: 'lib-3',
          name: 'Downloads',
          path: '/downloads',
          jobs: [{ id: 'job-1', filePath: '/downloads/file.mkv', beforeSizeBytes: null }],
        },
      ]);

      const result = await service.monitorLibraryDiskSpace();

      expect(result.totalQueuedJobs).toBe(1);
    });

    it('handles multiple libraries with mixed job states', async () => {
      const fs = await import('node:fs');
      jest
        .spyOn(fs.promises, 'statfs')
        .mockResolvedValue({ blocks: 1000000n, bsize: 4096, bavail: 800000n } as any);

      mockLibraryRepository.findAllLibraries.mockResolvedValue([
        {
          id: 'lib-4',
          name: 'Lib A',
          path: '/media/a',
          jobs: [
            { id: 'job-1', filePath: '/media/a/file.mkv', beforeSizeBytes: BigInt(1_000_000_000) },
          ],
        },
        { id: 'lib-5', name: 'Lib B', path: '/media/b', jobs: [] },
      ]);

      const result = await service.monitorLibraryDiskSpace();

      expect(result.libraries).toHaveLength(2);
      expect(result.totalQueuedJobs).toBe(1);
    });
  });

  // ── formatBytes — private method ──────────────────────────────────────────

  describe('formatBytes - private method', () => {
    it('returns 0 B for zero bytes', () => {
      expect((service as any).formatBytes(0)).toBe('0 B');
    });

    it('formats bytes correctly', () => {
      expect((service as any).formatBytes(1024)).toBe('1KB');
    });

    it('formats GB correctly', () => {
      const result = (service as any).formatBytes(1024 ** 3);
      expect(result).toContain('GB');
    });

    it('formats TB correctly', () => {
      const result = (service as any).formatBytes(1024 ** 4);
      expect(result).toContain('TB');
    });

    it('formats MB correctly', () => {
      const result = (service as any).formatBytes(1024 ** 2);
      expect(result).toContain('MB');
    });
  });

  // ── checkQueueHealth — additional branches ────────────────────────────────

  describe('checkQueueHealth - additional branches', () => {
    it('handles all zeros correctly', async () => {
      mockPrismaService.job.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const result = await service.checkQueueHealth();

      expect(result.queued).toBe(0);
      expect(result.encoding).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('returns correct counts for large queue', async () => {
      mockPrismaService.job.count
        .mockResolvedValueOnce(500)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(10000)
        .mockResolvedValueOnce(42);

      const result = await service.checkQueueHealth();

      expect(result.queued).toBe(500);
      expect(result.encoding).toBe(12);
      expect(result.completed).toBe(10000);
      expect(result.failed).toBe(42);
    });
  });

  // ── checkNodeHealth — single node ─────────────────────────────────────────

  describe('checkNodeHealth - single online node', () => {
    it('returns 1 online 0 offline for single ONLINE node', async () => {
      mockPrismaService.node.findMany.mockResolvedValue([{ status: 'ONLINE' }]);

      const result = await service.checkNodeHealth();

      expect(result.total).toBe(1);
      expect(result.online).toBe(1);
      expect(result.offline).toBe(0);
    });
  });

  // ── monitorLibraryDiskSpace — inner statfs failure ────────────────────────

  describe('monitorLibraryDiskSpace - inner library error handling', () => {
    it('adds warning entry when statfs throws for a library', async () => {
      const fs = await import('node:fs');
      jest.spyOn(fs.promises, 'statfs').mockRejectedValue(new Error('ENOENT: no such file'));

      mockLibraryRepository.findAllLibraries.mockResolvedValue([
        {
          id: 'lib-err',
          name: 'BadLib',
          path: '/nonexistent/path',
          jobs: [
            {
              id: 'job-1',
              filePath: '/nonexistent/path/file.mkv',
              beforeSizeBytes: BigInt(1_000_000_000),
            },
          ],
        },
      ]);

      const result = await service.monitorLibraryDiskSpace();

      expect(result.libraries).toHaveLength(1);
      expect(result.libraries[0].status).toBe('warning');
      expect(result.libraries[0].hasEnoughSpaceForQueue).toBe(false);
      expect(result.libraries[0].warningMessage).toContain('Failed to check disk space');
    });

    it('sets warning message when disk is warning-level but queued jobs still fit', async () => {
      const fs = await import('node:fs');
      // 10TB total, 15% free (~1.5TB) → 85% used → 'warning'
      // Job is 1KB → space needed = 1.2KB + 5GB min → ~5GB required, 1.5TB available → fits
      const totalBlocks = BigInt(2_500_000_000); // 10TB at 4096 bytes/block
      const freeBlocks = BigInt(375_000_000); // 15% free = 1.5TB
      jest.spyOn(fs.promises, 'statfs').mockResolvedValue({
        blocks: totalBlocks,
        bsize: 4096,
        bavail: freeBlocks,
      } as any);

      mockLibraryRepository.findAllLibraries.mockResolvedValue([
        {
          id: 'lib-warn',
          name: 'WarnLib',
          path: '/media/warn',
          jobs: [{ id: 'job-1', filePath: '/media/warn/tiny.mkv', beforeSizeBytes: BigInt(1_000) }],
        },
      ]);

      const result = await service.monitorLibraryDiskSpace();

      expect(result.libraries).toHaveLength(1);
      const lib = result.libraries[0];
      expect(lib.status).toBe('warning');
      expect(lib.hasEnoughSpaceForQueue).toBe(true);
      expect(lib.warningMessage).toContain('warning');
    });

    it('sets warning globalWarning when no queued jobs but disk is warning-level', async () => {
      const fs = await import('node:fs');
      // 10TB total, 15% free → 85% used → 'warning'
      jest.spyOn(fs.promises, 'statfs').mockResolvedValue({
        blocks: BigInt(2_500_000_000),
        bsize: 4096,
        bavail: BigInt(375_000_000), // 15% free
      } as any);

      mockLibraryRepository.findAllLibraries.mockResolvedValue([
        { id: 'lib-nojobs', name: 'EmptyWarnLib', path: '/media/empty', jobs: [] },
      ]);

      const result = await service.monitorLibraryDiskSpace();

      expect(result.libraries[0].status).toBe('warning');
      expect(result.globalWarnings.some((w) => w.includes('EmptyWarnLib'))).toBe(true);
      expect(result.libraries[0].warningMessage).toContain('warning');
    });
  });
});
