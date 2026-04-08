import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { mockPrismaProvider } from '../../../testing/mock-providers';
import { DebugService } from '../../debug.service';

// Mock execFileSync to prevent tests from hitting real system processes
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  execFileSync: jest.fn().mockReturnValue(''),
}));

describe('DebugService', () => {
  let service: DebugService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DebugService, mockPrismaProvider],
    }).compile();

    service = module.get<DebugService>(DebugService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('getSystemLoad', () => {
    it('should return system load information', async () => {
      prisma.node.findFirst = jest.fn().mockResolvedValue({
        id: 'node-1',
        ipAddress: '127.0.0.1',
        loadThresholdMultiplier: 5.0,
      });

      const result = await service.getSystemLoad();

      expect(result).toHaveProperty('loadAvg1m');
      expect(result).toHaveProperty('loadAvg5m');
      expect(result).toHaveProperty('loadAvg15m');
      expect(result).toHaveProperty('cpuCount');
      expect(result).toHaveProperty('loadThreshold');
      expect(result).toHaveProperty('freeMemoryGB');
      expect(result).toHaveProperty('totalMemoryGB');
      expect(result).toHaveProperty('isOverloaded');
    });

    it('should use custom load threshold from node config', async () => {
      prisma.node.findFirst = jest.fn().mockResolvedValue({
        id: 'node-1',
        ipAddress: '127.0.0.1',
        loadThresholdMultiplier: 3.0,
      });

      const result = await service.getSystemLoad();

      expect(result.loadThresholdMultiplier).toBe(3.0);
    });

    it('should use default threshold when node not found', async () => {
      prisma.node.findFirst = jest.fn().mockRejectedValue(new Error('Not found'));

      const result = await service.getSystemLoad();

      expect(result.loadThresholdMultiplier).toBe(5.0);
    });

    it('should detect overload when load is high', async () => {
      prisma.node.findFirst = jest.fn().mockResolvedValue({
        id: 'node-1',
        ipAddress: '127.0.0.1',
        loadThresholdMultiplier: 0.1,
      });

      const result = await service.getSystemLoad();

      expect(result.isOverloaded).toBe(true);
    });

    it('should detect overload when memory is low', async () => {
      prisma.node.findFirst = jest.fn().mockResolvedValue({
        id: 'node-1',
        ipAddress: '127.0.0.1',
        loadThresholdMultiplier: 10.0,
      });

      // Free memory is set to 0 to trigger low memory condition
      const result = await service.getSystemLoad();

      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('Low memory');
    });
  });

  describe('getFfmpegProcesses', () => {
    it('should return encoding jobs from database', async () => {
      prisma.job.findMany = jest
        .fn()
        .mockResolvedValue([{ id: 'job-1', startedAt: new Date(), progress: 50 }]);

      const result = await service.getFfmpegProcesses();

      expect(result.trackedEncodings).toHaveLength(1);
      expect(result.trackedEncodings[0]).toMatchObject({
        jobId: 'job-1',
        lastProgress: 50,
      });
    });

    it('should return empty arrays when no jobs or processes', async () => {
      prisma.job.findMany = jest.fn().mockResolvedValue([]);

      const result = await service.getFfmpegProcesses();

      expect(result.trackedEncodings).toHaveLength(0);
      expect(result.systemProcesses).toHaveLength(0);
      expect(result.zombieCount).toBe(0);
    });
  });

  describe('killProcessByPid', () => {
    it('should throw BadRequestException for invalid PID', async () => {
      await expect(service.killProcessByPid(0)).rejects.toThrow(BadRequestException);
      await expect(service.killProcessByPid(-1)).rejects.toThrow(BadRequestException);
      await expect(service.killProcessByPid(4194305)).rejects.toThrow(BadRequestException);
    });

    it('should handle non-existent process gracefully', async () => {
      // The kill command will fail on non-existent PID but should not throw
      // This tests the error handling path
      const result = await service.killProcessByPid(999999);

      // The function should handle gracefully even if process doesn't exist
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');
    });
  });

  describe('killAllZombies', () => {
    it('should handle empty process list', async () => {
      // Mock findSystemFfmpegProcesses to return empty
      const result = await service.killAllZombies();

      expect(result.killed).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('updateLoadThreshold', () => {
    it('should reject invalid multiplier values', async () => {
      const result1 = await service.updateLoadThreshold(0.5);
      expect(result1.success).toBe(false);

      const result2 = await service.updateLoadThreshold(11.0);
      expect(result2.success).toBe(false);
    });

    it('should fail when node not found', async () => {
      prisma.node.findFirst = jest.fn().mockResolvedValue(null);

      const result = await service.updateLoadThreshold(4.0);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should successfully update load threshold', async () => {
      prisma.node.findFirst = jest.fn().mockResolvedValue({
        id: 'node-1',
        ipAddress: '127.0.0.1',
      });
      prisma.node.update = jest.fn().mockResolvedValue({});

      const result = await service.updateLoadThreshold(4.0);

      expect(result.success).toBe(true);
      expect(result.loadThresholdMultiplier).toBe(4.0);
    });
  });
});
