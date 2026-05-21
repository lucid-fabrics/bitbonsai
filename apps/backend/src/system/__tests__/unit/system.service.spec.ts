import { Test, type TestingModule } from '@nestjs/testing';
import * as os from 'os';
import { SystemService } from '../../system.service';

jest.mock('os');

describe('SystemService', () => {
  let service: SystemService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SystemService],
    }).compile();

    service = module.get<SystemService>(SystemService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('getSystemResources', () => {
    it('should return CPU information', () => {
      const mockCpus = Array(16).fill({
        model: 'Intel Core i9-12900K',
        speed: 3200,
        times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
      });
      (os.cpus as jest.Mock).mockReturnValue(mockCpus);
      (os.totalmem as jest.Mock).mockReturnValue(32 * 1024 * 1024 * 1024);
      (os.freemem as jest.Mock).mockReturnValue(16 * 1024 * 1024 * 1024);

      const result = service.getSystemResources();

      expect(result.cpu.model).toBe('Intel Core i9-12900K');
      expect(result.cpu.cores).toBe(16);
      expect(result.cpu.coresPerJob).toBe(4);
      expect(result.cpu.theoreticalMaxWorkers).toBe(4); // 16 / 4
    });

    it('should calculate configured workers with safety margin', () => {
      const mockCpus = Array(16).fill({
        model: 'Intel',
        speed: 3200,
        times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
      });
      (os.cpus as jest.Mock).mockReturnValue(mockCpus);
      (os.totalmem as jest.Mock).mockReturnValue(32 * 1024 * 1024 * 1024);
      (os.freemem as jest.Mock).mockReturnValue(16 * 1024 * 1024 * 1024);

      const result = service.getSystemResources();

      // 16 cores / 4 per job = 4 theoretical * 0.5 safety = 2
      expect(result.cpu.configuredWorkers).toBe(2);
    });

    it('should enforce minimum workers', () => {
      const mockCpus = Array(4).fill({
        model: 'Intel',
        speed: 2000,
        times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
      });
      (os.cpus as jest.Mock).mockReturnValue(mockCpus);
      (os.totalmem as jest.Mock).mockReturnValue(8 * 1024 * 1024 * 1024);
      (os.freemem as jest.Mock).mockReturnValue(4 * 1024 * 1024 * 1024);

      const result = service.getSystemResources();

      // 4 cores / 4 = 1 theoretical * 0.5 = 0, but min is 2
      expect(result.cpu.configuredWorkers).toBeGreaterThanOrEqual(2);
    });

    it('should enforce maximum workers', () => {
      const mockCpus = Array(128).fill({
        model: 'AMD EPYC',
        speed: 3500,
        times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
      });
      (os.cpus as jest.Mock).mockReturnValue(mockCpus);
      (os.totalmem as jest.Mock).mockReturnValue(256 * 1024 * 1024 * 1024);
      (os.freemem as jest.Mock).mockReturnValue(200 * 1024 * 1024 * 1024);

      const result = service.getSystemResources();

      expect(result.cpu.configuredWorkers).toBeLessThanOrEqual(12);
    });

    it('should return memory information', () => {
      const mockCpus = Array(8).fill({
        model: 'Intel',
        speed: 3200,
        times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
      });
      (os.cpus as jest.Mock).mockReturnValue(mockCpus);
      (os.totalmem as jest.Mock).mockReturnValue(32 * 1024 * 1024 * 1024);
      (os.freemem as jest.Mock).mockReturnValue(16 * 1024 * 1024 * 1024);

      const result = service.getSystemResources();

      expect(result.memory.total).toBe(32 * 1024 * 1024 * 1024);
      expect(result.memory.free).toBe(16 * 1024 * 1024 * 1024);
      expect(result.memory.used).toBe(16 * 1024 * 1024 * 1024);
      expect(result.memory.usedPercent).toBe(50);
    });

    it('should provide multiple worker scenarios', () => {
      const mockCpus = Array(16).fill({
        model: 'Intel',
        speed: 3200,
        times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
      });
      (os.cpus as jest.Mock).mockReturnValue(mockCpus);
      (os.totalmem as jest.Mock).mockReturnValue(32 * 1024 * 1024 * 1024);
      (os.freemem as jest.Mock).mockReturnValue(16 * 1024 * 1024 * 1024);

      const result = service.getSystemResources();

      expect(result.scenarios).toHaveLength(3);
      expect(result.scenarios[0].label).toContain('Conservative');
      expect(result.scenarios[1].label).toContain('Balanced');
      expect(result.scenarios[2].label).toContain('Aggressive');
    });

    it('should provide recommendation', () => {
      const mockCpus = Array(8).fill({
        model: 'Intel',
        speed: 3200,
        times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
      });
      (os.cpus as jest.Mock).mockReturnValue(mockCpus);
      (os.totalmem as jest.Mock).mockReturnValue(16 * 1024 * 1024 * 1024);
      (os.freemem as jest.Mock).mockReturnValue(8 * 1024 * 1024 * 1024);

      const result = service.getSystemResources();

      expect(result.recommendation.current).toBe('balanced');
      expect(result.recommendation.reason).not.toBeNull();
    });

    it('should handle missing CPU model', () => {
      (os.cpus as jest.Mock).mockReturnValue([
        {
          model: '',
          speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        },
      ]);
      (os.totalmem as jest.Mock).mockReturnValue(1024 * 1024 * 1024);
      (os.freemem as jest.Mock).mockReturnValue(512 * 1024 * 1024);

      const result = service.getSystemResources();

      // Should not throw
      expect(result.cpu.cores).toBe(1);
    });
  });
});
