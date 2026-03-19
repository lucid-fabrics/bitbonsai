import * as os from 'node:os';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { DebugService } from './debug.service';

// Mock child_process so we don't actually run system commands
jest.mock('node:child_process', () => ({
  execFileSync: jest.fn(),
}));

describe('DebugService', () => {
  let service: DebugService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      job: { findMany: jest.fn() },
      node: { findFirst: jest.fn(), update: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DebugService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<DebugService>(DebugService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSystemLoad', () => {
    it('should return system load info with default threshold when no node found', async () => {
      mockPrisma.node.findFirst.mockResolvedValue(null);
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
      mockPrisma.node.findFirst.mockResolvedValue({ id: 'node-1', loadThresholdMultiplier: 3.0 });
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
      mockPrisma.node.findFirst.mockResolvedValue(null);
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
      mockPrisma.job.findMany.mockResolvedValue(encodingJobs);

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
      mockPrisma.node.findFirst.mockResolvedValue({ id: 'node-1' });
      mockPrisma.node.update.mockResolvedValue({ id: 'node-1', loadThresholdMultiplier: 3.0 });
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
      mockPrisma.node.findFirst.mockResolvedValue(null);

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
  });
});
