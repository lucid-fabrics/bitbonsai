import { Test, type TestingModule } from '@nestjs/testing';
import * as os from 'os';
import { LibrariesService } from '../../../libraries/libraries.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../testing/mock-providers';
import { AccelerationType } from '../../dto/hardware-capabilities.dto';
import { HardwareDetectionService } from '../../hardware-detection.service';
import { HealthDashboardService, HealthStatus } from '../../health-dashboard.service';

jest.mock('os');
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  existsSync: jest.fn().mockReturnValue(false),
  promises: {
    statfs: jest.fn(),
  },
}));

describe('HealthDashboardService', () => {
  let service: HealthDashboardService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let hardwareDetection: { detectHardware: jest.Mock; clearCache: jest.Mock };
  let librariesService: { getAllLibraryPaths: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    hardwareDetection = {
      detectHardware: jest.fn().mockResolvedValue({
        accelerationType: AccelerationType.CPU,
        cpu: { model: 'Test CPU', cores: 8, speed: 3200 },
        memory: { total: 32768, free: 16384, used: 16384 },
        gpus: [],
        platform: 'linux',
      }),
      clearCache: jest.fn(),
    };
    librariesService = {
      getAllLibraryPaths: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthDashboardService,
        { provide: PrismaService, useValue: prisma },
        { provide: HardwareDetectionService, useValue: hardwareDetection },
        { provide: LibrariesService, useValue: librariesService },
      ],
    }).compile();

    service = module.get<HealthDashboardService>(HealthDashboardService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();

    // Default os mocks
    (os.cpus as jest.Mock).mockReturnValue(
      Array(8).fill({
        model: 'Test CPU',
        speed: 3200,
        times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
      })
    );
    (os.loadavg as jest.Mock).mockReturnValue([1.0, 1.5, 2.0]);
    (os.totalmem as jest.Mock).mockReturnValue(32 * 1024 * 1024 * 1024);
    (os.freemem as jest.Mock).mockReturnValue(16 * 1024 * 1024 * 1024);
    (os.hostname as jest.Mock).mockReturnValue('test-host');
    (os.uptime as jest.Mock).mockReturnValue(86400);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('runHealthChecks', () => {
    it('should return healthy CPU load status', async () => {
      (os.loadavg as jest.Mock).mockReturnValue([2.0, 1.5, 1.0]);
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const checks = await service.runHealthChecks();
      const cpuCheck = checks.find((c) => c.name === 'CPU Load');

      expect(cpuCheck).not.toBeUndefined();
      expect(cpuCheck!.status).toBe(HealthStatus.HEALTHY);
    });

    it('should detect warning CPU load', async () => {
      // 8 cores, load avg 13 = ratio 1.625 > WARNING threshold (1.5)
      (os.loadavg as jest.Mock).mockReturnValue([13.0, 10.0, 8.0]);
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const checks = await service.runHealthChecks();
      const cpuCheck = checks.find((c) => c.name === 'CPU Load');

      expect(cpuCheck!.status).toBe(HealthStatus.WARNING);
    });

    it('should detect critical CPU load', async () => {
      // 8 cores, load avg 20 = ratio 2.5 > CRITICAL threshold (2.0)
      (os.loadavg as jest.Mock).mockReturnValue([20.0, 18.0, 16.0]);
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const checks = await service.runHealthChecks();
      const cpuCheck = checks.find((c) => c.name === 'CPU Load');

      expect(cpuCheck!.status).toBe(HealthStatus.CRITICAL);
    });

    it('should check memory usage', async () => {
      (os.totalmem as jest.Mock).mockReturnValue(100);
      (os.freemem as jest.Mock).mockReturnValue(50);
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const checks = await service.runHealthChecks();
      const memCheck = checks.find((c) => c.name === 'Memory Usage');

      expect(memCheck).not.toBeUndefined();
      expect(memCheck!.status).toBe(HealthStatus.HEALTHY);
    });

    it('should detect critical memory usage', async () => {
      (os.totalmem as jest.Mock).mockReturnValue(1000);
      (os.freemem as jest.Mock).mockReturnValue(30); // 97% used > 95% threshold
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const checks = await service.runHealthChecks();
      const memCheck = checks.find((c) => c.name === 'Memory Usage');

      expect(memCheck!.status).toBe(HealthStatus.CRITICAL);
    });

    it('should check database connectivity', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const checks = await service.runHealthChecks();
      const dbCheck = checks.find((c) => c.name === 'Database');

      expect(dbCheck).not.toBeUndefined();
      expect(dbCheck!.status).toBe(HealthStatus.HEALTHY);
    });

    it('should detect database failure', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));

      const checks = await service.runHealthChecks();
      const dbCheck = checks.find((c) => c.name === 'Database');

      expect(dbCheck!.status).toBe(HealthStatus.CRITICAL);
    });

    it('should check for stuck jobs', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      // First call is for stuck jobs count
      prisma.job.count
        .mockResolvedValueOnce(0) // stuck jobs
        .mockResolvedValue(0);
      prisma.node.count.mockResolvedValue(0);

      const checks = await service.runHealthChecks();
      const queueCheck = checks.find((c) => c.name === 'Queue Health');

      expect(queueCheck).not.toBeUndefined();
      expect(queueCheck!.status).toBe(HealthStatus.HEALTHY);
    });

    it('should detect stuck jobs', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      prisma.job.count.mockResolvedValueOnce(3); // stuck jobs
      prisma.node.count.mockResolvedValue(0);

      const checks = await service.runHealthChecks();
      const queueCheck = checks.find((c) => c.name === 'Queue Health');

      expect(queueCheck!.status).toBe(HealthStatus.WARNING);
    });

    it('should check node status', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      prisma.job.count.mockResolvedValue(0);
      prisma.node.count.mockResolvedValue(0);

      const checks = await service.runHealthChecks();
      const nodeCheck = checks.find((c) => c.name === 'Node Status');

      expect(nodeCheck).not.toBeUndefined();
      expect(nodeCheck!.status).toBe(HealthStatus.HEALTHY);
    });
  });

  describe('calculateOverallStatus', () => {
    it('should return CRITICAL if any check is critical', () => {
      const checks = [
        { name: 'A', status: HealthStatus.HEALTHY, message: '' },
        { name: 'B', status: HealthStatus.CRITICAL, message: '' },
      ];

      const result = (service as any).calculateOverallStatus(checks);

      expect(result).toBe(HealthStatus.CRITICAL);
    });

    it('should return WARNING if any check is warning', () => {
      const checks = [
        { name: 'A', status: HealthStatus.HEALTHY, message: '' },
        { name: 'B', status: HealthStatus.WARNING, message: '' },
      ];

      const result = (service as any).calculateOverallStatus(checks);

      expect(result).toBe(HealthStatus.WARNING);
    });

    it('should return UNKNOWN if any check is unknown', () => {
      const checks = [
        { name: 'A', status: HealthStatus.HEALTHY, message: '' },
        { name: 'B', status: HealthStatus.UNKNOWN, message: '' },
      ];

      const result = (service as any).calculateOverallStatus(checks);

      expect(result).toBe(HealthStatus.UNKNOWN);
    });

    it('should return HEALTHY when all checks pass', () => {
      const checks = [
        { name: 'A', status: HealthStatus.HEALTHY, message: '' },
        { name: 'B', status: HealthStatus.HEALTHY, message: '' },
      ];

      const result = (service as any).calculateOverallStatus(checks);

      expect(result).toBe(HealthStatus.HEALTHY);
    });
  });

  describe('getDashboard', () => {
    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      prisma.job.count.mockResolvedValue(0);
      prisma.node.count.mockResolvedValue(0);
      prisma.node.findMany.mockResolvedValue([]);
      prisma.job.findMany.mockResolvedValue([]);
      prisma.job.aggregate.mockResolvedValue({
        _sum: { savedBytes: BigInt(0) },
        _avg: { savedPercent: 0 },
      });
    });

    it('should return complete dashboard', async () => {
      const dashboard = await service.getDashboard();

      expect(dashboard.timestamp).toBeInstanceOf(Date);
      expect(typeof dashboard.overallStatus).toBe('string');
      expect(dashboard.checks).toBeInstanceOf(Array);
      expect(dashboard.system).not.toBeNull();
      expect(dashboard.queue).not.toBeNull();
      expect(dashboard.storage).toBeInstanceOf(Array);
      expect(dashboard.nodes).not.toBeNull();
      expect(dashboard.encoding).not.toBeNull();
      expect(dashboard.hardware).not.toBeNull();
    });

    it('should include system metrics', async () => {
      const dashboard = await service.getDashboard();

      expect(dashboard.system.hostname).toBe('test-host');
      expect(dashboard.system.platform).toBe(process.platform);
      expect(dashboard.system.uptime).toBe(86400);
    });

    it('should include hardware info', async () => {
      const dashboard = await service.getDashboard();

      expect(dashboard.hardware.accelerationType).toBe('CPU');
      expect(dashboard.hardware.cpuCores).toBe(8);
      expect(dashboard.hardware.gpuDetected).toBe(false);
    });

    it('should handle hardware detection failure gracefully', async () => {
      hardwareDetection.detectHardware.mockRejectedValue(new Error('Detection failed'));

      const dashboard = await service.getDashboard();

      expect(dashboard.hardware.accelerationType).toBe('CPU');
      expect(dashboard.hardware.gpuDetected).toBe(false);
    });

    it('should calculate encoding stats', async () => {
      prisma.job.count
        .mockResolvedValueOnce(0) // stuck jobs
        .mockResolvedValueOnce(0) // offline nodes
        .mockResolvedValueOnce(100) // total completed (encoding stats)
        .mockResolvedValueOnce(10) // last 24h completed
        .mockResolvedValueOnce(2); // last 24h failed

      // Rest of job.count calls for stages
      prisma.job.count.mockResolvedValue(0);

      prisma.job.aggregate.mockResolvedValue({
        _sum: { savedBytes: BigInt(1000000000) },
        _avg: { savedPercent: 45.5 },
      });

      const dashboard = await service.getDashboard();

      expect(typeof dashboard.encoding.totalProcessed).toBe('number');
      expect(dashboard.encoding.totalSavedBytes).not.toBeNull();
    });
  });
});
