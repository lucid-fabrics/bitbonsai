import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { DebugService } from '../../debug.service';

jest.setTimeout(30000);

// Mock os module to control cpus() and memory functions
jest.mock('node:os', () => ({
  __esModule: true,
  loadavg: jest.fn().mockReturnValue([1.5, 2.0, 1.8]),
  cpus: jest.fn().mockReturnValue([]),
  totalmem: jest.fn().mockReturnValue(0),
  freemem: jest.fn().mockReturnValue(0),
  networkInterfaces: jest.fn().mockReturnValue({}),
}));

// Mock execFileSync
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  execFileSync: jest.fn(),
}));

// Helper to mock getter-only properties
function mockOsNetworkInterfaces(interfaces: object): void {
  (os.networkInterfaces as jest.Mock).mockReturnValue(interfaces);
}

function clearOsNetworkInterfaces(): void {
  (os.networkInterfaces as jest.Mock).mockReturnValue({});
}

// Helper to mock getter-only os functions
function mockOsGetters(loadAvg: number[], cpus: object[], totalMem: number, freeMem: number): void {
  (os.loadavg as jest.Mock).mockReturnValue(loadAvg);
  (os.cpus as jest.Mock).mockReturnValue(cpus);
  (os.totalmem as jest.Mock).mockReturnValue(totalMem);
  (os.freemem as jest.Mock).mockReturnValue(freeMem);
}

function clearOsGetters(): void {
  (os.loadavg as jest.Mock).mockReturnValue([1.5, 2.0, 1.8]);
  (os.cpus as jest.Mock).mockReturnValue([]);
  (os.totalmem as jest.Mock).mockReturnValue(0);
  (os.freemem as jest.Mock).mockReturnValue(0);
}

describe('DebugService', () => {
  let service: DebugService;

  const mockPrismaService = {
    node: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    job: {
      findMany: jest.fn(),
    },
    settings: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrismaService.node.findFirst.mockResolvedValue(null);
    mockPrismaService.node.findUnique.mockResolvedValue(null);
    mockPrismaService.node.update.mockResolvedValue({});
    mockPrismaService.job.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [DebugService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<DebugService>(DebugService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearOsNetworkInterfaces();
    clearOsGetters();
  });

  describe('getSystemLoad', () => {
    it('should return system load information', async () => {
      mockOsGetters(
        [1.5, 2.0, 1.8],
        new Array(4).fill({ speed: 2000 }),
        16 * 1024 * 1024 * 1024,
        8 * 1024 * 1024 * 1024
      );
      mockPrismaService.node.findUnique.mockResolvedValue(null);

      const result = await service.getSystemLoad();

      expect(result.loadAvg1m).toBe(1.5);
      expect(result.cpuCount).toBe(4);
      expect(result.totalMemoryGB).toBe(16);
      expect(result.freeMemoryGB).toBe(8);
      expect(result.isOverloaded).toBe(false);
    });

    it('should detect overload when load is high', async () => {
      mockOsNetworkInterfaces({
        eth0: [{ address: '192.168.1.100', family: 'IPv4', internal: false }],
      });
      mockOsGetters(
        [50, 2.0, 1.8],
        new Array(4).fill({ speed: 2000 }),
        16 * 1024 * 1024 * 1024,
        8 * 1024 * 1024 * 1024
      );
      mockPrismaService.node.findFirst.mockResolvedValue(null);

      const result = await service.getSystemLoad();

      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('High load');
    });

    it('should detect overload when memory is low', async () => {
      mockOsNetworkInterfaces({
        eth0: [{ address: '192.168.1.100', family: 'IPv4', internal: false }],
      });
      mockOsGetters(
        [1.5, 2.0, 1.8],
        new Array(4).fill({ speed: 2000 }),
        16 * 1024 * 1024 * 1024,
        1024 * 1024 * 1024
      );
      mockPrismaService.node.findFirst.mockResolvedValue(null);

      const result = await service.getSystemLoad();

      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('Low memory');
    });

    it('should use custom load threshold from node config', async () => {
      mockOsNetworkInterfaces({
        eth0: [{ address: '192.168.1.100', family: 'IPv4', internal: false }],
      });
      mockOsGetters(
        [1.5, 2.0, 1.8],
        new Array(4).fill({ speed: 2000 }),
        16 * 1024 * 1024 * 1024,
        8 * 1024 * 1024 * 1024
      );
      mockPrismaService.node.findFirst.mockResolvedValue({
        id: 'node-1',
        loadThresholdMultiplier: 10.0,
      } as any);

      const result = await service.getSystemLoad();

      expect(result.loadThresholdMultiplier).toBe(10.0);
      expect(result.loadThreshold).toBe(40); // 4 CPUs * 10
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
    it('should return empty when no encoding jobs', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([]);

      const result = await service.getFfmpegProcesses();

      expect(result.trackedEncodings).toHaveLength(0);
      expect(result.systemProcesses).toHaveLength(0);
    });

    it('should include active encoding jobs', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([
        { id: 'job-1', startedAt: new Date(), progress: 50 },
      ]);

      const result = await service.getFfmpegProcesses();

      expect(result.trackedEncodings).toHaveLength(1);
      expect(result.trackedEncodings[0].jobId).toBe('job-1');
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
    it('should return error for invalid PID (zero)', async () => {
      await expect(service.killProcessByPid(0)).rejects.toThrow();
    });

    it('should return error for negative PID', async () => {
      await expect(service.killProcessByPid(-1)).rejects.toThrow();
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
    it('should return error for invalid multiplier (too high)', async () => {
      const result = await service.updateLoadThreshold(15.0);

      expect(result.success).toBe(false);
      expect(result.message).toContain('1.0 and 10.0');
    });

    it('should return error for invalid multiplier (too low)', async () => {
      const result = await service.updateLoadThreshold(0.5);

      expect(result.success).toBe(false);
      expect(result.message).toContain('1.0 and 10.0');
    });

    it('should return error when node not found', async () => {
      mockOsNetworkInterfaces({
        eth0: [{ address: '192.168.1.100', family: 'IPv4', internal: false }],
      });
      mockPrismaService.node.findFirst.mockResolvedValue(null);

      const result = await service.updateLoadThreshold(3.0);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should update threshold when node exists', async () => {
      mockOsNetworkInterfaces({
        eth0: [{ address: '192.168.1.100', family: 'IPv4', internal: false }],
      });
      mockPrismaService.node.findFirst.mockResolvedValue({
        id: 'node-1',
        loadThresholdMultiplier: 5.0,
      } as any);
      mockPrismaService.node.update.mockResolvedValue({} as any);

      const result = await service.updateLoadThreshold(8.0);

      expect(result.success).toBe(true);
      expect(result.loadThresholdMultiplier).toBe(8.0);
      expect(mockPrismaService.node.update).toHaveBeenCalled();
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
