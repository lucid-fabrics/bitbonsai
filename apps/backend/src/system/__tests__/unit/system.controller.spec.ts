import { Test, type TestingModule } from '@nestjs/testing';
import { SystemController } from '../../system.controller';
import { SystemService } from '../../system.service';

describe('SystemController', () => {
  let controller: SystemController;

  const mockSystemService = {
    getSystemResources: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemController],
      providers: [{ provide: SystemService, useValue: mockSystemService }],
    }).compile();

    controller = module.get<SystemController>(SystemController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSystemResources', () => {
    it('should return system resources from service', () => {
      const result = {
        cpu: {
          model: 'Intel Core i9',
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
            risk: 'low',
            description: 'Good balance',
          },
        ],
        recommendation: { current: 'balanced', reason: 'Optimal for workload' },
      };
      mockSystemService.getSystemResources.mockReturnValue(result);

      const response = controller.getSystemResources();

      expect(mockSystemService.getSystemResources).toHaveBeenCalledTimes(1);
      expect(response).toEqual(result);
    });

    it('should propagate service errors', () => {
      mockSystemService.getSystemResources.mockImplementation(() => {
        throw new Error('failed to read resources');
      });

      expect(() => controller.getSystemResources()).toThrow('failed to read resources');
    });
  });
});
