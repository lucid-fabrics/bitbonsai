import * as os from 'node:os';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobRepository } from '../../../common/repositories/job.repository';
import { NodeRepository } from '../../../common/repositories/node.repository';
import { DebugService } from '../../debug.service';

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
jest.mock('../../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

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

jest.mock('node:child_process', () => ({
  execFileSync: jest.fn(),
}));

describe('DebugService (__tests__/unit)', () => {
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
    it('returns system load info with node multiplier', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue({
        id: 'node-1',
        loadThresholdMultiplier: 3.0,
      });
      jest.spyOn(os, 'loadavg').mockReturnValue([2.5, 2.0, 1.8]);
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(8).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      jest.spyOn(os, 'freemem').mockReturnValue(16 * 1024 ** 3);
      jest.spyOn(os, 'totalmem').mockReturnValue(32 * 1024 ** 3);

      const result = await service.getSystemLoad();
      expect(result.loadAvg1m).toBeCloseTo(2.5);
      expect(result.cpuCount).toBe(8);
      expect(result.loadThresholdMultiplier).toBe(3.0);
      expect(result.loadThreshold).toBe(24);
    });

    it('falls back to env multiplier when node not found', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue(null);
      process.env.LOAD_THRESHOLD_MULTIPLIER = '4.0';
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
      expect(result.loadThresholdMultiplier).toBe(4.0);
      process.env.LOAD_THRESHOLD_MULTIPLIER = undefined;
    });

    it('handles node fetch error gracefully', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockRejectedValue(new Error('db error'));
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
      expect(result.loadThresholdMultiplier).toBe(5.0);
    });

    it('marks as overloaded when free memory < 4GB', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue(null);
      jest.spyOn(os, 'loadavg').mockReturnValue([0.1, 0.1, 0.1]);
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(4).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      jest.spyOn(os, 'freemem').mockReturnValue(2 * 1024 ** 3);
      jest.spyOn(os, 'totalmem').mockReturnValue(8 * 1024 ** 3);

      const result = await service.getSystemLoad();
      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('Low memory');
    });

    it('marks as overloaded when load exceeds threshold', async () => {
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

    it('returns empty reason when not overloaded', async () => {
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
      expect(result.reason).toBe('');
    });
  });

  describe('getFfmpegProcesses', () => {
    it('returns encoding jobs and system processes', async () => {
      mockJobRepository.findManySelect.mockResolvedValue([
        { id: 'job-1', startedAt: new Date(Date.now() - 60000), progress: 50 },
      ]);
      const { execFileSync } = require('node:child_process');
      execFileSync.mockReturnValue('');

      const result = await service.getFfmpegProcesses();
      expect(result.trackedEncodings).toHaveLength(1);
      expect(result.trackedEncodings[0].runtimeSeconds).toBeGreaterThan(0);
    });

    it('handles ps failure gracefully', async () => {
      mockJobRepository.findManySelect.mockResolvedValue([]);
      const { execFileSync } = require('node:child_process');
      execFileSync.mockImplementation(() => {
        throw new Error('ps not found');
      });

      const result = await service.getFfmpegProcesses();
      expect(result.systemProcesses).toHaveLength(0);
    });

    it('handles job with null startedAt', async () => {
      mockJobRepository.findManySelect.mockResolvedValue([
        { id: 'job-null', startedAt: null, progress: null },
      ]);
      const { execFileSync } = require('node:child_process');
      execFileSync.mockReturnValue('');

      const result = await service.getFfmpegProcesses();
      expect(result.trackedEncodings[0].runtimeSeconds).toBe(0);
      expect(result.trackedEncodings[0].lastProgress).toBe(0);
    });

    it('parses ffmpeg process with day-based elapsed time', async () => {
      mockJobRepository.findManySelect.mockResolvedValue([]);
      const { execFileSync } = require('node:child_process');
      execFileSync.mockReturnValue(
        'PID %CPU %MEM ELAPSED COMMAND\n  9999  10.0  3.0  1-02:30:45  ffmpeg -i input.mkv output.mkv\n'
      );

      const result = await service.getFfmpegProcesses();
      expect(result.systemProcesses).toHaveLength(1);
      expect(result.systemProcesses[0].runtimeSeconds).toBe(86400 + 7200 + 1800 + 45);
    });

    it('truncates very long commands', async () => {
      mockJobRepository.findManySelect.mockResolvedValue([]);
      const { execFileSync } = require('node:child_process');
      execFileSync.mockReturnValue(
        `PID %CPU %MEM ELAPSED COMMAND\n  8888  1.0  0.5  00:00:10  ffmpeg ${'x'.repeat(250)}\n`
      );

      const result = await service.getFfmpegProcesses();
      expect(result.systemProcesses[0].command).toContain('...');
    });
  });

  describe('killProcessByPid', () => {
    it('kills process successfully', async () => {
      const { execFileSync } = require('node:child_process');
      execFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '-0') throw new Error('no such process');
        return '';
      });

      const result = await service.killProcessByPid(1234);
      expect(result.success).toBe(true);
    });

    it('throws BadRequestException for PID = 0', async () => {
      await expect(service.killProcessByPid(0)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for negative PID', async () => {
      await expect(service.killProcessByPid(-5)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for PID > 4194304', async () => {
      await expect(service.killProcessByPid(4194305)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for float PID', async () => {
      await expect(service.killProcessByPid(1.5)).rejects.toThrow(BadRequestException);
    });

    it('force-kills process that survives SIGTERM', async () => {
      const { execFileSync } = require('node:child_process');
      execFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '-0') return ''; // process still alive
        return '';
      });

      const result = await service.killProcessByPid(1234);
      expect(result.success).toBe(true);
    });
  });

  describe('killAllZombies', () => {
    it('returns zeros when no ffmpeg processes', async () => {
      const { execFileSync } = require('node:child_process');
      execFileSync.mockReturnValue('PID %CPU %MEM ELAPSED COMMAND\n');

      const result = await service.killAllZombies();
      expect(result.killed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.details).toHaveLength(0);
    });

    it('counts killed and failed', async () => {
      const { execFileSync } = require('node:child_process');
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

  describe('updateLoadThreshold', () => {
    it('updates threshold for valid multiplier', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue({ id: 'node-1' });
      mockNodeRepository.updateById.mockResolvedValue(undefined);
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(8).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );

      const result = await service.updateLoadThreshold(3.5);
      expect(result.success).toBe(true);
      expect(result.loadThresholdMultiplier).toBe(3.5);
    });

    it('rejects multiplier < 1.0', async () => {
      const result = await service.updateLoadThreshold(0.5);
      expect(result.success).toBe(false);
      expect(result.message).toContain('between 1.0 and 10.0');
    });

    it('rejects multiplier > 10.0', async () => {
      const result = await service.updateLoadThreshold(11.0);
      expect(result.success).toBe(false);
    });

    it('returns failure when node not found', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue(null);

      const result = await service.updateLoadThreshold(2.0);
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('handles repository error', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue({ id: 'node-1' });
      mockNodeRepository.updateById.mockRejectedValue(new Error('db error'));

      const result = await service.updateLoadThreshold(2.0);
      expect(result.success).toBe(false);
    });

    it('accepts boundary value 1.0', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue({ id: 'node-1' });
      mockNodeRepository.updateById.mockResolvedValue(undefined);
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

    it('accepts boundary value 10.0', async () => {
      mockNodeRepository.findFirstByIpAddresses.mockResolvedValue({ id: 'node-1' });
      mockNodeRepository.updateById.mockResolvedValue(undefined);
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
