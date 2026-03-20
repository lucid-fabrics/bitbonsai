import * as os from 'node:os';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobRepository } from '../common/repositories/job.repository';
import { NodeRepository } from '../common/repositories/node.repository';
import { DebugService } from './debug.service';

jest.mock('@prisma/client', () => ({
  PrismaClient: class PrismaClient {},
  JobStage: {
    QUEUED: 'QUEUED',
    ENCODING: 'ENCODING',
    DONE: 'DONE',
    FAILED: 'FAILED',
    CORRUPTED: 'CORRUPTED',
    SKIPPED: 'SKIPPED',
  },
}));
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

// Mock node:os to allow re-mocking in tests
jest.mock('node:os', () => ({
  loadavg: jest.fn().mockReturnValue([0.5, 0.5, 0.5]),
  cpus: jest
    .fn()
    .mockReturnValue(
      Array(4).fill({ model: 'x', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } })
    ),
  freemem: jest.fn().mockReturnValue(8 * 1024 ** 3),
  totalmem: jest.fn().mockReturnValue(16 * 1024 ** 3),
  networkInterfaces: jest.fn().mockReturnValue({}),
}));

// Mock child_process so we don't actually run system commands
jest.mock('node:child_process', () => ({
  execFileSync: jest.fn(),
}));

describe('DebugService', () => {
  let service: DebugService;
  let mockJobRepository: { findManySelect: jest.Mock };
  let mockNodeRepository: { findFirstByIpAddresses: jest.Mock; updateById: jest.Mock };

  beforeEach(async () => {
    mockJobRepository = { findManySelect: jest.fn() };
    mockNodeRepository = { findFirstByIpAddresses: jest.fn(), updateById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebugService,
        { provide: JobRepository, useValue: mockJobRepository },
        { provide: NodeRepository, useValue: mockNodeRepository },
      ],
    }).compile();

    service = module.get<DebugService>(DebugService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSystemLoad', () => {
    it('should return system load info with default threshold when no node found', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue(null);
      jest.spyOn(os, 'loadavg').mockReturnValue([1.5, 2.0, 1.8]);
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(8).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      jest.spyOn(os, 'freemem').mockReturnValue(8 * 1024 ** 3);
      jest.spyOn(os, 'totalmem').mockReturnValue(16 * 1024 ** 3);

      const result = await service.getSystemLoad();

      expect(result.loadAvg1m).toBeCloseTo(1.5);
      expect(result.cpuCount).toBe(8);
      expect(result.freeMemoryGB).toBeCloseTo(8, 0);
      expect(result.totalMemoryGB).toBeCloseTo(16, 0);
      expect(typeof result.isOverloaded).toBe('boolean');
    });

    it('should use node loadThresholdMultiplier when available', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue({
        id: 'node-1',
        loadThresholdMultiplier: 3.0,
      });
      jest.spyOn(os, 'loadavg').mockReturnValue([0.5, 0.5, 0.5]);
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(4).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      jest.spyOn(os, 'freemem').mockReturnValue(8 * 1024 ** 3);
      jest.spyOn(os, 'totalmem').mockReturnValue(16 * 1024 ** 3);

      const result = await service.getSystemLoad();

      expect(result.loadThresholdMultiplier).toBe(3.0);
      expect(result.loadThreshold).toBe(12); // 4 cores * 3.0
    });

    it('should mark as overloaded when memory is critically low', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue(null);
      jest.spyOn(os, 'loadavg').mockReturnValue([0.1, 0.1, 0.1]);
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(8).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      jest.spyOn(os, 'freemem').mockReturnValue(2 * 1024 ** 3); // 2GB < 4GB threshold
      jest.spyOn(os, 'totalmem').mockReturnValue(8 * 1024 ** 3);

      const result = await service.getSystemLoad();

      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('Low memory');
    });
  });

  describe('getFfmpegProcesses', () => {
    it('should return encoding jobs and system processes', async () => {
      const encodingJobs = [{ id: 'job-1', startedAt: new Date(Date.now() - 60000), progress: 50 }];
      mockJobRepository.findManySelect.mockResolvedValue(encodingJobs);

      const { execFileSync } = require('node:child_process');
      execFileSync.mockReturnValue('');

      const result = await service.getFfmpegProcesses();

      expect(result.trackedEncodings).toHaveLength(1);
      expect(result.trackedEncodings[0].jobId).toBe('job-1');
      expect(result.trackedEncodings[0].lastProgress).toBe(50);
      expect(result.trackedEncodings[0].runtimeSeconds).toBeGreaterThan(0);
      expect(Array.isArray(result.systemProcesses)).toBe(true);
    });
  });

  describe('killProcessByPid', () => {
    it('should validate PID and reject invalid values', async () => {
      await expect(service.killProcessByPid(0)).rejects.toThrow(BadRequestException);
      await expect(service.killProcessByPid(-1)).rejects.toThrow(BadRequestException);
      await expect(service.killProcessByPid(99999999)).rejects.toThrow(BadRequestException);
    });

    it('should attempt to kill valid PID', async () => {
      const { execFileSync } = require('node:child_process');
      execFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (args[0] === '-0') throw new Error('No such process'); // Process dead
      });

      const result = await service.killProcessByPid(12345);
      expect(result.success).toBe(true);
    });
  });

  describe('updateLoadThreshold', () => {
    it('should reject out-of-range multiplier', async () => {
      const result = await service.updateLoadThreshold(0.5);
      expect(result.success).toBe(false);
      expect(result.message).toContain('between 1.0 and 10.0');
    });

    it('should reject multiplier above max', async () => {
      const result = await service.updateLoadThreshold(11.0);
      expect(result.success).toBe(false);
    });

    it('should update load threshold when node found', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue({ id: 'node-1' });
      mockNodeRepository.updateById.mockResolvedValue({
        id: 'node-1',
        loadThresholdMultiplier: 3.0,
      });
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(8).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );

      const result = await service.updateLoadThreshold(3.0);

      expect(result.success).toBe(true);
      expect(result.loadThresholdMultiplier).toBe(3.0);
      expect(result.maxLoad).toBe(24); // 8 cores * 3.0
    });

    it('should return failure when no node found', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue(null);

      const result = await service.updateLoadThreshold(2.0);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('killAllZombies', () => {
    it('should return zero counts when no ffmpeg processes found', async () => {
      const { execFileSync } = require('node:child_process');
      execFileSync.mockReturnValue('PID %CPU %MEM ELAPSED COMMAND\n'); // No ffmpeg lines

      const result = await service.killAllZombies();

      expect(result.killed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.details).toEqual([]);
    });

    it('should count killed and failed processes when ffmpeg lines exist', async () => {
      const { execFileSync } = require('node:child_process');
      // ps returns two ffmpeg processes
      execFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'ps') {
          return [
            'PID %CPU %MEM ELAPSED COMMAND',
            '  1001  5.0  2.0  00:01:00  ffmpeg -i input.mkv out.mkv',
            '  1002  3.0  1.5  00:02:00  ffmpeg -i other.mkv out2.mkv',
          ].join('\n');
        }
        if (args?.[0] === '-0') throw new Error('no such process');
        return '';
      });

      const result = await service.killAllZombies();

      expect(result.killed + result.failed).toBe(2);
      expect(result.details).toHaveLength(2);
    });
  });

  describe('getSystemLoad – additional branches', () => {
    it('should use env LOAD_THRESHOLD_MULTIPLIER when node repo throws', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockRejectedValue(new Error('DB error'));
      process.env.LOAD_THRESHOLD_MULTIPLIER = '2.5';

      jest.spyOn(os, 'loadavg').mockReturnValue([0.1, 0.1, 0.1]);
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(4).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      jest.spyOn(os, 'freemem').mockReturnValue(8 * 1024 ** 3);
      jest.spyOn(os, 'totalmem').mockReturnValue(16 * 1024 ** 3);

      const result = await service.getSystemLoad();

      expect(result.loadThresholdMultiplier).toBe(2.5);
      process.env.LOAD_THRESHOLD_MULTIPLIER = '';
    });

    it('should mark as overloaded and give high-load reason when load exceeds threshold', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue(null);
      jest.spyOn(os, 'loadavg').mockReturnValue([100, 50, 30]);
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(4).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      jest.spyOn(os, 'freemem').mockReturnValue(8 * 1024 ** 3);
      jest.spyOn(os, 'totalmem').mockReturnValue(16 * 1024 ** 3);

      const result = await service.getSystemLoad();

      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('High load');
    });

    it('should return empty reason string when not overloaded', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue(null);
      jest.spyOn(os, 'loadavg').mockReturnValue([0.1, 0.1, 0.1]);
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(4).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      jest.spyOn(os, 'freemem').mockReturnValue(8 * 1024 ** 3);
      jest.spyOn(os, 'totalmem').mockReturnValue(16 * 1024 ** 3);

      const result = await service.getSystemLoad();

      expect(result.isOverloaded).toBe(false);
      expect(result.reason).toBe('');
    });
  });

  describe('getFfmpegProcesses – additional branches', () => {
    it('should handle job with null startedAt (runtimeSeconds = 0)', async () => {
      mockJobRepository.findManySelect.mockResolvedValue([
        { id: 'job-null-start', startedAt: null, progress: null },
      ]);
      const { execFileSync } = require('node:child_process');
      execFileSync.mockReturnValue('');

      const result = await service.getFfmpegProcesses();

      expect(result.trackedEncodings[0].runtimeSeconds).toBe(0);
      expect(result.trackedEncodings[0].lastProgress).toBe(0);
    });

    it('should return empty systemProcesses and zombieCount=0 when ps throws', async () => {
      mockJobRepository.findManySelect.mockResolvedValue([]);
      const { execFileSync } = require('node:child_process');
      execFileSync.mockImplementation(() => {
        throw new Error('ps failed');
      });

      const result = await service.getFfmpegProcesses();

      expect(result.systemProcesses).toEqual([]);
      expect(result.zombieCount).toBe(0);
    });

    it('should parse ffmpeg process from ps output with elapsed time including days', async () => {
      mockJobRepository.findManySelect.mockResolvedValue([]);
      const { execFileSync } = require('node:child_process');
      execFileSync.mockReturnValue(
        'PID %CPU %MEM ELAPSED COMMAND\n  9999  10.0  3.0  1-02:30:45  ffmpeg -i input.mkv output.mkv\n'
      );

      const result = await service.getFfmpegProcesses();

      expect(result.systemProcesses).toHaveLength(1);
      expect(result.systemProcesses[0].pid).toBe(9999);
      // 1 day + 2 hrs + 30 min + 45 sec
      expect(result.systemProcesses[0].runtimeSeconds).toBe(86400 + 7200 + 1800 + 45);
    });

    it('should truncate very long ffmpeg commands to 200 chars + ellipsis', async () => {
      mockJobRepository.findManySelect.mockResolvedValue([]);
      const { execFileSync } = require('node:child_process');
      const longArgs = 'x'.repeat(250);
      execFileSync.mockReturnValue(
        `PID %CPU %MEM ELAPSED COMMAND\n  8888  1.0  0.5  00:00:10  ffmpeg ${longArgs}\n`
      );

      const result = await service.getFfmpegProcesses();

      expect(result.systemProcesses[0].command).toContain('...');
    });
  });

  describe('killProcessByPid – additional branches', () => {
    it('should reject non-integer PID (float)', async () => {
      await expect(service.killProcessByPid(1.5)).rejects.toThrow(BadRequestException);
    });

    it('should reject PID at boundary 4194305', async () => {
      await expect(service.killProcessByPid(4194305)).rejects.toThrow(BadRequestException);
    });

    it('should force-kill process that survives SIGTERM', async () => {
      const { execFileSync } = require('node:child_process');
      let _killCallCount = 0;
      execFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (args[0] === '-0') {
          // process still alive, don't throw
          _killCallCount++;
          return '';
        }
        return '';
      });

      const result = await service.killProcessByPid(1234);
      expect(result.success).toBe(true);
    });
  });

  describe('updateLoadThreshold – additional branches', () => {
    it('should handle repository error and return failure', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue({ id: 'node-1' });
      mockNodeRepository.updateById.mockRejectedValue(new Error('DB write failed'));

      const result = await service.updateLoadThreshold(3.0);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed');
    });

    it('should accept boundary value 1.0', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue({ id: 'node-1' });
      mockNodeRepository.updateById.mockResolvedValue({
        id: 'node-1',
        loadThresholdMultiplier: 1.0,
      });
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(4).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );

      const result = await service.updateLoadThreshold(1.0);
      expect(result.success).toBe(true);
    });

    it('should accept boundary value 10.0', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue({ id: 'node-1' });
      mockNodeRepository.updateById.mockResolvedValue({
        id: 'node-1',
        loadThresholdMultiplier: 10.0,
      });
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(4).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );

      const result = await service.updateLoadThreshold(10.0);
      expect(result.success).toBe(true);
    });
  });
});
