import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

// Mock child_process exec
jest.mock('node:child_process', () => ({
  exec: jest.fn(),
}));

// Mock os module
jest.mock('node:os', () => ({
  totalmem: jest.fn(() => 16 * 1024 * 1024 * 1024), // 16GB
  freemem: jest.fn(() => 8 * 1024 * 1024 * 1024), // 8GB
}));

describe('HealthService', () => {
  let service: HealthService;
  let prisma: PrismaService;

  const mockPrismaService = {
    $queryRaw: jest.fn(),
    node: {
      findMany: jest.fn(),
    },
    job: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    prisma = module.get<PrismaService>(PrismaService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getBasicHealth', () => {
    it('should return ok status when database is healthy', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ 1: 1 }]);

      const result = await service.getBasicHealth();

      expect(result.status).toBe('ok');
      expect(result.version).toBe('0.1.0');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should return error status when database fails', async () => {
      mockPrismaService.$queryRaw.mockRejectedValue(new Error('Connection failed'));

      const result = await service.getBasicHealth();

      expect(result.status).toBe('error');
      expect(result.version).toBe('0.1.0');
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
    it('should return undefined when Redis is not configured', async () => {
      const originalEnv = process.env['REDIS_URL'];
      delete process.env['REDIS_URL'];

      const result = await service.checkRedisHealth();

      expect(result).toBeUndefined();

      // Restore
      if (originalEnv) {
        process.env['REDIS_URL'] = originalEnv;
      }
    });

    it('should return ok status when Redis is configured', async () => {
      const originalEnv = process.env['REDIS_URL'];
      process.env['REDIS_URL'] = 'redis://localhost:6379';

      const result = await service.checkRedisHealth();

      expect(result).toBeDefined();
      expect(result?.status).toBe('ok');

      // Restore
      if (originalEnv) {
        process.env['REDIS_URL'] = originalEnv;
      } else {
        delete process.env['REDIS_URL'];
      }
    });
  });

  describe('checkDiskHealth', () => {
    it('should return ok status for normal disk usage', async () => {
      // Mock execAsync to return df output with 50% usage
      const { exec } = require('node:child_process');
      exec.mockImplementation((cmd: any, callback: any) => {
        callback(null, 'Filesystem     Size   Used  Avail Use% Mounted\n/dev/sda1      1T    500G   500G  50% /', '');
      });

      const result = await service.checkDiskHealth();

      expect(result.status).toBe('ok');
      expect(result.used).toBe('50%');
      expect(result.available).toBe('500G');
    });

    it('should return warning status for high disk usage', async () => {
      const { exec } = require('node:child_process');
      exec.mockImplementation((cmd: any, callback: any) => {
        callback(null, 'Filesystem     Size   Used  Avail Use% Mounted\n/dev/sda1      1T    850G   150G  85% /', '');
      });

      const result = await service.checkDiskHealth();

      expect(result.status).toBe('warning');
      expect(result.used).toBe('85%');
    });

    it('should return critical status for very high disk usage', async () => {
      const { exec } = require('node:child_process');
      exec.mockImplementation((cmd: any, callback: any) => {
        callback(null, 'Filesystem     Size   Used  Avail Use% Mounted\n/dev/sda1      1T    950G    50G  95% /', '');
      });

      const result = await service.checkDiskHealth();

      expect(result.status).toBe('critical');
      expect(result.used).toBe('95%');
    });

    it('should handle errors gracefully', async () => {
      const { exec } = require('node:child_process');
      exec.mockImplementation((cmd: any, callback: any) => {
        callback(new Error('Command failed'));
      });

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
      const { exec } = require('node:child_process');
      exec.mockImplementation((cmd: any, callback: any) => {
        callback(null, 'ffmpeg version 5.1.2 Copyright (c) 2000-2022', '');
      });

      const result = await service.checkFfmpegHealth();

      expect(result.status).toBe('ok');
      expect(result.version).toBe('5.1.2');
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should return error status when ffmpeg is not found', async () => {
      const { exec } = require('node:child_process');
      exec.mockImplementation((cmd: any, callback: any) => {
        callback(new Error('Command not found'));
      });

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

      const { exec } = require('node:child_process');
      exec.mockImplementation((cmd: any, callback: any) => {
        if (cmd.includes('df')) {
          callback(null, 'Filesystem     Size   Used  Avail Use% Mounted\n/dev/sda1      1T    500G   500G  50% /', '');
        } else if (cmd.includes('ffmpeg')) {
          callback(null, 'ffmpeg version 5.1.2 Copyright (c) 2000-2022', '');
        }
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
      const { exec } = require('node:child_process');
      exec.mockImplementation((cmd: any, callback: any) => {
        if (cmd.includes('df')) {
          callback(null, 'Filesystem     Size   Used  Avail Use% Mounted\n/dev/sda1      1T    950G    50G  95% /', '');
        } else if (cmd.includes('ffmpeg')) {
          callback(new Error('Command not found'));
        }
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
});
