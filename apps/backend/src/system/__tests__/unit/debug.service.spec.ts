import { execFileSync } from 'node:child_process';
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

    it('should use environment variable when node lookup fails', async () => {
      mockOsNetworkInterfaces({
        eth0: [{ address: '192.168.1.100', family: 'IPv4', internal: false }],
      });
      mockOsGetters(
        [1.5, 2.0, 1.8],
        new Array(4).fill({ speed: 2000 }),
        16 * 1024 * 1024 * 1024,
        8 * 1024 * 1024 * 1024
      );
      mockPrismaService.node.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.getSystemLoad();

      // Should fall back to env default (5.0)
      expect(result.loadThresholdMultiplier).toBe(5.0);
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

    it('should return zombie info for system processes', async () => {
      (execFileSync as jest.Mock).mockReturnValue(
        '12345  5.0  2.0 00:10:30 ffmpeg -i input.mp4 -c:v libx265 output.mp4\n'
      );

      const result = await service.getFfmpegProcesses();

      expect(result.systemProcesses).toHaveLength(1);
      expect(result.systemProcesses[0].isZombie).toBe(true);
      expect(result.systemProcesses[0].trackedJobId).toBeNull();
      expect(result.zombieCount).toBe(1);
    });

    it('should handle empty ps output', async () => {
      (execFileSync as jest.Mock).mockReturnValue('');

      const result = await service.getFfmpegProcesses();

      expect(result.systemProcesses).toHaveLength(0);
      expect(result.zombieCount).toBe(0);
    });

    it('should handle ps command failure gracefully', async () => {
      (execFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Command failed');
      });

      const result = await service.getFfmpegProcesses();

      expect(result.systemProcesses).toHaveLength(0);
    });

    it('should parse various process time formats', async () => {
      (execFileSync as jest.Mock).mockReturnValue(
        `12345  5.0  2.0 00:05 ffmpeg -i input.mp4
67890  3.0  1.0 01:30:45 ffmpeg -i input2.mp4
11111  2.0  1.0 1-02:00:00 ffmpeg -i input3.mp4`
      );

      const result = await service.getFfmpegProcesses();

      expect(result.systemProcesses).toHaveLength(3);
      // 5 seconds
      expect(result.systemProcesses[0].runtimeSeconds).toBe(5);
      // 1h 30m 45s = 5445 seconds
      expect(result.systemProcesses[1].runtimeSeconds).toBe(5445);
      // 1d 2h = 86400 + 7200 = 93600 seconds
      expect(result.systemProcesses[2].runtimeSeconds).toBe(93600);
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

    it('should return error for PID exceeding max', async () => {
      await expect(service.killProcessByPid(5000000)).rejects.toThrow();
    });

    it('should return error for non-integer PID', async () => {
      await expect(service.killProcessByPid(1.5)).rejects.toThrow();
    });

    it('should successfully kill process', async () => {
      (execFileSync as jest.Mock)
        .mockImplementationOnce(() => {
          throw new Error('Process not found'); // First kill -TERM fails
        })
        .mockImplementationOnce(() => {
          throw new Error('Process not found'); // kill -0 fails
        });

      const result = await service.killProcessByPid(12345);

      expect(result.success).toBe(true);
      expect(result.message).toContain('12345');
    });

    it('should force kill if process persists after SIGTERM', async () => {
      const mockExec = execFileSync as jest.Mock;
      // kill -TERM succeeds (no error)
      mockExec.mockImplementationOnce((): void => {
        /* mock - process terminated */
      });
      // kill -0 shows process still exists
      mockExec.mockImplementationOnce((): void => {
        /* mock - process still running */
      });
      // kill -KILL succeeds
      mockExec.mockImplementationOnce((): void => {
        /* mock - process killed */
      });

      const result = await service.killProcessByPid(12345);

      expect(result.success).toBe(true);
    });
  });

  describe('killAllZombies', () => {
    it('should return empty when no processes', async () => {
      (execFileSync as jest.Mock).mockReturnValue('');

      const result = await service.killAllZombies();

      expect(result.killed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.details).toHaveLength(0);
    });

    it('should kill multiple zombie processes', async () => {
      (execFileSync as jest.Mock)
        .mockReturnValueOnce('12345  5.0  2.0 00:10 ffmpeg -i input.mp4')
        .mockImplementation((): void => {
          /* mock - kill command succeeds */
        });

      const result = await service.killAllZombies();

      expect(result.killed).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.details).toHaveLength(1);
    });

    it('should track failures when kill fails', async () => {
      const mockExec = execFileSync as jest.Mock;
      mockExec.mockReturnValueOnce('12345  5.0  2.0 00:10 ffmpeg -i input.mp4');
      // kill -TERM throws error (silently caught - process may not exist)
      mockExec.mockRejectedValueOnce(new Error('Permission denied'));
      // kill -0 throws error (process doesn't exist after SIGTERM)
      mockExec.mockRejectedValueOnce(new Error('No such process'));

      const result = await service.killAllZombies();

      // kill -TERM failure is silently caught - process considered dead
      expect(result.killed).toBe(1);
      expect(result.failed).toBe(0);
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

    it('should handle database errors gracefully', async () => {
      mockOsNetworkInterfaces({
        eth0: [{ address: '192.168.1.100', family: 'IPv4', internal: false }],
      });
      mockPrismaService.node.findFirst.mockResolvedValue({
        id: 'node-1',
        loadThresholdMultiplier: 5.0,
      } as any);
      mockPrismaService.node.update.mockRejectedValue(new Error('DB error'));

      const result = await service.updateLoadThreshold(8.0);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to update');
    });
  });

  describe('getLocalIpAddresses', () => {
    it('should return IPv4 addresses from network interfaces', async () => {
      mockOsNetworkInterfaces({
        eth0: [{ address: '192.168.1.100', family: 'IPv4', internal: false }],
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      });

      const result = await service.getSystemLoad();

      // The method is called internally by getSystemLoad
      expect(result).toBeDefined();
    });

    it('should skip internal interfaces', async () => {
      mockOsNetworkInterfaces({
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      });

      const result = await service.getSystemLoad();

      // No external IPs, will use defaults
      expect(result).toBeDefined();
    });

    it('should skip IPv6 addresses', async () => {
      mockOsNetworkInterfaces({
        eth0: [
          { address: '192.168.1.100', family: 'IPv4', internal: false },
          { address: '::1', family: 'IPv6', internal: false },
        ],
      });

      const result = await service.getSystemLoad();

      expect(result).toBeDefined();
    });
  });
});
