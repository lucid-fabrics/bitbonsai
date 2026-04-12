import { Test, TestingModule } from '@nestjs/testing';
import { SystemController } from '../system.controller';
import { SystemService } from '../system.service';

describe('SystemController', () => {
  let controller: SystemController;
  let service: SystemService;

  const mockSystemService = {
    getSystemResources: jest.fn().mockReturnValue({
      cpu: {
        model: 'Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz',
        cores: 16,
        coresPerJob: 4,
        theoreticalMaxWorkers: 4,
        safetyMargin: 0.5,
        configuredWorkers: 2,
        minWorkers: 2,
        maxWorkers: 12,
      },
      memory: {
        total: 34359738368,
        free: 8589934592,
        used: 25769803776,
        usedPercent: 75.0,
      },
      scenarios: [
        {
          margin: 0.5,
          label: 'Balanced (50%)',
          workers: 2,
          risk: 'medium' as const,
          description: 'Balanced performance and system stability',
        },
      ],
      recommendation: {
        current: 'balanced',
        reason: 'Optimal for most workloads',
      },
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemController],
      providers: [
        {
          provide: SystemService,
          useValue: mockSystemService,
        },
      ],
    }).compile();

    controller = module.get<SystemController>(SystemController);
    service = module.get<SystemService>(SystemService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSystemResources', () => {
    it('should return system resources with worker capacity', () => {
      const result = controller.getSystemResources();

      expect(result).toBeDefined();
      expect(result.cpu).toBeDefined();
      expect(result.cpu.cores).toBe(16);
      expect(result.memory).toBeDefined();
      expect(result.memory.usedPercent).toBe(75.0);
      expect(result.scenarios).toBeInstanceOf(Array);
      expect(result.scenarios.length).toBeGreaterThan(0);
      expect(result.recommendation).toBeDefined();
      expect(service.getSystemResources).toHaveBeenCalled();
    });
  });
});
