import * as os from 'node:os';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { DebugService } from '../../debug.service';

// Mock os module to control cpus() and memory functions
jest.mock('node:os', () => ({
  __esModule: true,
  loadavg: jest.fn().mockReturnValue([1.5, 2.0, 1.8]),
  cpus: jest.fn().mockReturnValue([]),
  totalmem: jest.fn().mockReturnValue(0),
  freemem: jest.fn().mockReturnValue(0),
  networkInterfaces: jest.fn().mockReturnValue({}),
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
  // Use the jest mocked functions (they're already set up by jest.mock)
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
    // Reset mocks to return null by default to prevent test pollution
    mockPrismaService.node.findFirst.mockResolvedValue(null);
    mockPrismaService.node.findUnique.mockResolvedValue(null);

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
      ); // 1GB
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
      // Machine has 14 CPUs but test mocks to 4
      expect(result.loadThreshold).toBe(40); // 4 CPUs * 10
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
  });

  describe('killProcessByPid', () => {
    it('should return error for invalid PID (zero)', async () => {
      await expect(service.killProcessByPid(0)).rejects.toThrow();
    });

    it('should return error for negative PID', async () => {
      await expect(service.killProcessByPid(-1)).rejects.toThrow();
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
  });
});
