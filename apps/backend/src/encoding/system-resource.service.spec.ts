import * as os from 'node:os';
import { Test, TestingModule } from '@nestjs/testing';
import { NodesService } from '../nodes/nodes.service';
import { SystemResourceService } from './system-resource.service';

// os module properties are non-configurable in Node.js 20+ — mock at module level
jest.mock('node:os', () => ({
  cpus: jest.fn().mockReturnValue([]),
  loadavg: jest.fn().mockReturnValue([0, 0, 0]),
  freemem: jest.fn().mockReturnValue(8 * 1024 ** 3),
  totalmem: jest.fn().mockReturnValue(16 * 1024 ** 3),
}));

describe('SystemResourceService', () => {
  let service: SystemResourceService;
  let mockNodesService: jest.Mocked<NodesService>;

  beforeEach(async () => {
    mockNodesService = {
      getCurrentNode: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [SystemResourceService, { provide: NodesService, useValue: mockNodesService }],
    }).compile();

    service = module.get<SystemResourceService>(SystemResourceService);
  });

  describe('calculateOptimalWorkers', () => {
    it('should clamp workers to min 2', () => {
      (os.cpus as jest.Mock).mockReturnValue([
        { model: 'x', speed: 1000, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ]);

      const workers = service.calculateOptimalWorkers();
      expect(workers).toBeGreaterThanOrEqual(2);
    });

    it('should clamp workers to max 12', () => {
      const mockCpus = Array(48).fill({
        model: 'Intel Core',
        speed: 3000,
        times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
      });
      (os.cpus as jest.Mock).mockReturnValue(mockCpus);

      const workers = service.calculateOptimalWorkers();
      expect(workers).toBeLessThanOrEqual(12);
    });
  });

  describe('checkSystemLoad', () => {
    it('should return not overloaded under normal load', () => {
      (os.cpus as jest.Mock).mockReturnValue(
        Array(8).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      (os.loadavg as jest.Mock).mockReturnValue([1, 1, 1]);
      (os.freemem as jest.Mock).mockReturnValue(8 * 1024 ** 3);

      const result = service.checkSystemLoad();

      expect(result.isOverloaded).toBe(false);
    });

    it('should return overloaded when load exceeds threshold', () => {
      (os.cpus as jest.Mock).mockReturnValue(
        Array(4).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      (os.loadavg as jest.Mock).mockReturnValue([100, 100, 100]);
      (os.freemem as jest.Mock).mockReturnValue(8 * 1024 ** 3);

      const result = service.checkSystemLoad();

      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('High system load');
    });

    it('should return overloaded when memory is critically low', () => {
      (os.cpus as jest.Mock).mockReturnValue(
        Array(8).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      (os.loadavg as jest.Mock).mockReturnValue([0.1, 0.1, 0.1]);
      (os.freemem as jest.Mock).mockReturnValue(1 * 1024 ** 3); // 1GB < 4GB threshold

      const result = service.checkSystemLoad();

      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('Low memory');
    });
  });

  describe('getSystemLoadInfo', () => {
    it('should return complete system load info object', () => {
      (os.cpus as jest.Mock).mockReturnValue(
        Array(4).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      (os.loadavg as jest.Mock).mockReturnValue([1, 2, 3]);
      (os.freemem as jest.Mock).mockReturnValue(8 * 1024 ** 3);
      (os.totalmem as jest.Mock).mockReturnValue(16 * 1024 ** 3);

      const info = service.getSystemLoadInfo();

      expect(info.loadAvg1m).toBe(1);
      expect(info.loadAvg5m).toBe(2);
      expect(info.loadAvg15m).toBe(3);
      expect(info.cpuCount).toBe(4);
      expect(info.freeMemoryGB).toBeCloseTo(8, 0);
      expect(info.totalMemoryGB).toBeCloseTo(16, 0);
    });
  });

  describe('reloadLoadThreshold', () => {
    it('should load threshold from database when node has setting', async () => {
      mockNodesService.getCurrentNode.mockResolvedValue({
        loadThresholdMultiplier: 3.0,
        encodingTempPath: '/tmp/encoding',
      } as any);

      await service.reloadLoadThreshold();

      expect(service.getLoadThresholdMultiplier()).toBe(3.0);
      expect(service.getEncodingTempPath()).toBe('/tmp/encoding');
    });

    it('should use default when node has no threshold setting', async () => {
      mockNodesService.getCurrentNode.mockResolvedValue({} as any);

      await service.reloadLoadThreshold();

      expect(service.getLoadThresholdMultiplier()).toBe(2.0);
    });

    it('should use default when database call fails', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('DB error'));

      await service.reloadLoadThreshold();

      expect(service.getLoadThresholdMultiplier()).toBe(2.0);
    });
  });

  describe('getEncodingTempPath', () => {
    it('should return null when no temp path configured', () => {
      expect(service.getEncodingTempPath()).toBeNull();
    });
  });
});
