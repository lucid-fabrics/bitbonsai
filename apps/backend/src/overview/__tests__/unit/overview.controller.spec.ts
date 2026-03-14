import { Test, type TestingModule } from '@nestjs/testing';
import { OverviewController } from '../../overview.controller';
import { OverviewService } from '../../overview.service';

describe('OverviewController', () => {
  let controller: OverviewController;

  const mockOverviewService = {
    getOverview: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OverviewController],
      providers: [{ provide: OverviewService, useValue: mockOverviewService }],
    }).compile();

    controller = module.get<OverviewController>(OverviewController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getOverview', () => {
    it('should return overview stats from service', async () => {
      const result = {
        activeNodes: 2,
        queueStatus: 'ok',
        storageSaved: '100GB',
        successRate: 98.2,
        queueSummary: { queued: 5, encoding: 2, completed: 150, failed: 3 },
        recentActivity: [],
        topLibraries: [],
      };
      mockOverviewService.getOverview.mockResolvedValue(result);

      const response = await controller.getOverview();

      expect(mockOverviewService.getOverview).toHaveBeenCalledTimes(1);
      expect(response).toEqual(result);
    });

    it('should propagate service errors', async () => {
      mockOverviewService.getOverview.mockRejectedValue(new Error('db unavailable'));
      await expect(controller.getOverview()).rejects.toThrow('db unavailable');
    });
  });
});
