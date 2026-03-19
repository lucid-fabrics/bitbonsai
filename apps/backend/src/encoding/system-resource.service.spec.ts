import * as os from 'node:os';
import { Test, TestingModule } from '@nestjs/testing';
import { NodesService } from '../nodes/nodes.service';
import { SystemResourceService } from './system-resource.service';

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
      jest
        .spyOn(os, 'cpus')
        .mockReturnValue([
          { model: 'x', speed: 1000, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
        ]);

      const workers = service.calculateOptimalWorkers();
      expect(workers).toBeGreaterThanOrEqual(2);
    });

    it('should clamp workers to max 12', () => {
      // 48 cores / 4 per job * 0.5 = 6, within bounds
      const mockCpus = Array(48).fill({
        model: 'Intel Core',
        speed: 3000,
        times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
      });
      jest.spyOn(os, 'cpus').mockReturnValue(mockCpus);

      const workers = service.calculateOptimalWorkers();
      expect(workers).toBeLessThanOrEqual(12);
    });
  });

  describe('checkSystemLoad', () => {
    it('should return not overloaded under normal load', () => {
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(8).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      jest.spyOn(os, 'loadavg').mockReturnValue([1, 1, 1]);
      jest.spyOn(os, 'freemem').mockReturnValue(8 * 1024 ** 3); // 8GB free

      const result = service.checkSystemLoad();

      expect(result.isOverloaded).toBe(false);
    });

    it('should return overloaded when load exceeds threshold', () => {
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(4).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      jest.spyOn(os, 'loadavg').mockReturnValue([100, 100, 100]); // Very high load
      jest.spyOn(os, 'freemem').mockReturnValue(8 * 1024 ** 3);

      const result = service.checkSystemLoad();

      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('High system load');
    });

    it('should return overloaded when memory is critically low', () => {
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(8).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      jest.spyOn(os, 'loadavg').mockReturnValue([0.1, 0.1, 0.1]);
      jest.spyOn(os, 'freemem').mockReturnValue(1 * 1024 ** 3); // Only 1GB free (< 4GB threshold)

      const result = service.checkSystemLoad();

      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('Low memory');
    });
  });

  describe('getSystemLoadInfo', () => {
    it('should return complete system load info object', () => {
      jest.spyOn(os, 'cpus').mockReturnValue(
        Array(4).fill({
          model: 'x',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })
      );
      jest.spyOn(os, 'loadavg').mockReturnValue([1, 2, 3]);
      jest.spyOn(os, 'freemem').mockReturnValue(8 * 1024 ** 3);
      jest.spyOn(os, 'totalmem').mockReturnValue(16 * 1024 ** 3);

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
