import { Test, type TestingModule } from '@nestjs/testing';
import { SystemController } from '../../system.controller';
import { SystemService } from '../../system.service';

describe('SystemController', () => {
  let controller: SystemController;
  let service: jest.Mocked<SystemService>;

  const mockSystemResources = {
    cpu: {
      model: 'Intel Core i9-12900K',
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
        margin: 0.3,
        label: 'Conservative (30%)',
        workers: 1,
        risk: 'low' as const,
        description: 'Lower CPU usage, slower queue processing',
      },
      {
        margin: 0.5,
        label: 'Balanced (50%)',
        workers: 2,
        risk: 'medium' as const,
        description: 'Optimal balance between speed and stability',
      },
      {
        margin: 0.7,
        label: 'Aggressive (70%)',
        workers: 2,
        risk: 'high' as const,
        description: 'Faster processing, higher crash risk',
      },
    ],
    recommendation: {
      current: 'balanced',
      reason: 'Provides optimal balance between encoding speed and system stability.',
    },
  };

  beforeEach(async () => {
    const mockSystemService = {
      getSystemResources: jest.fn().mockReturnValue(mockSystemResources),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemController],
      providers: [{ provide: SystemService, useValue: mockSystemService }],
    }).compile();

    controller = module.get<SystemController>(SystemController);
    service = module.get(SystemService) as jest.Mocked<SystemService>;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSystemResources', () => {
    it('should return system resources from service', () => {
      const result = controller.getSystemResources();

      expect(result).toEqual(mockSystemResources);
      expect(service.getSystemResources).toHaveBeenCalledTimes(1);
    });

    it('should include CPU information in response', () => {
      const result = controller.getSystemResources();

      expect(result.cpu).toBeDefined();
      expect(result.cpu.model).toBe('Intel Core i9-12900K');
      expect(result.cpu.cores).toBe(16);
      expect(result.cpu.configuredWorkers).toBe(2);
    });

    it('should include memory information in response', () => {
      const result = controller.getSystemResources();

      expect(result.memory).toBeDefined();
      expect(result.memory.total).toBe(34359738368);
      expect(result.memory.free).toBe(8589934592);
      expect(result.memory.usedPercent).toBe(75.0);
    });

    it('should include worker scenarios', () => {
      const result = controller.getSystemResources();

      expect(result.scenarios).toHaveLength(3);
      expect(result.scenarios[0]).toHaveProperty('margin');
      expect(result.scenarios[0]).toHaveProperty('label');
      expect(result.scenarios[0]).toHaveProperty('risk');
      expect(result.scenarios[0]).toHaveProperty('workers');
    });

    it('should include recommendation', () => {
      const result = controller.getSystemResources();

      expect(result.recommendation).toBeDefined();
      expect(result.recommendation.current).toBe('balanced');
      expect(result.recommendation.reason).toBeDefined();
    });
  });
});
