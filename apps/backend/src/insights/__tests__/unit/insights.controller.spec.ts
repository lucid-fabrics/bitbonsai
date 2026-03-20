import { Test, type TestingModule } from '@nestjs/testing';
import { InsightsController } from '../../insights.controller';
import { InsightsService } from '../../insights.service';

describe('InsightsController', () => {
  let controller: InsightsController;

  const mockInsightsService = {
    getTimeSeriesMetrics: jest.fn(),
    getAggregatedStats: jest.fn(),
    getCodecDistribution: jest.fn(),
    getSavingsTrend: jest.fn(),
    getNodeComparison: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InsightsController],
      providers: [{ provide: InsightsService, useValue: mockInsightsService }],
    }).compile();

    controller = module.get<InsightsController>(InsightsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getMetrics', () => {
    it('should call service with parsed dates and optional filters', async () => {
      const metrics = [{ id: 'metric-1', jobsCompleted: 42 }];
      mockInsightsService.getTimeSeriesMetrics.mockResolvedValue(metrics);

      const query = {
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-12-31T23:59:59Z',
        nodeId: 'node-1',
        licenseId: 'lic-1',
      };

      const response = await controller.getMetrics(query as never);

      expect(mockInsightsService.getTimeSeriesMetrics).toHaveBeenCalledWith({
        startDate: new Date('2024-01-01T00:00:00Z'),
        endDate: new Date('2024-12-31T23:59:59Z'),
        nodeId: 'node-1',
        licenseId: 'lic-1',
      });
      expect(response).toEqual(metrics);
    });

    it('should pass undefined optional filters when not provided', async () => {
      mockInsightsService.getTimeSeriesMetrics.mockResolvedValue([]);

      await controller.getMetrics({
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-12-31T23:59:59Z',
      } as never);

      expect(mockInsightsService.getTimeSeriesMetrics).toHaveBeenCalledWith({
        startDate: new Date('2024-01-01T00:00:00Z'),
        endDate: new Date('2024-12-31T23:59:59Z'),
        nodeId: undefined,
        licenseId: undefined,
      });
    });

    it('should propagate service errors', async () => {
      mockInsightsService.getTimeSeriesMetrics.mockRejectedValue(new Error('query failed'));
      await expect(
        controller.getMetrics({
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2024-12-31T23:59:59Z',
        } as never)
      ).rejects.toThrow('query failed');
    });
  });

  describe('getStats', () => {
    it('should return aggregated stats with licenseId filter', async () => {
      const stats = {
        totalJobsCompleted: 1247,
        totalJobsFailed: 23,
        totalSavedGB: 488.28,
        successRate: 98.2,
      };
      mockInsightsService.getAggregatedStats.mockResolvedValue(stats);

      const response = await controller.getStats('lic-1');

      expect(mockInsightsService.getAggregatedStats).toHaveBeenCalledWith('lic-1');
      expect(response).toEqual(stats);
    });

    it('should return stats without licenseId filter', async () => {
      const stats = {
        totalJobsCompleted: 1247,
        totalJobsFailed: 23,
        totalSavedGB: 488.28,
        successRate: 98.2,
      };
      mockInsightsService.getAggregatedStats.mockResolvedValue(stats);

      const response = await controller.getStats();

      expect(mockInsightsService.getAggregatedStats).toHaveBeenCalledWith(undefined);
      expect(response).toEqual(stats);
    });

    it('should propagate service errors', async () => {
      mockInsightsService.getAggregatedStats.mockRejectedValue(new Error('stats error'));
      await expect(controller.getStats()).rejects.toThrow('stats error');
    });
  });

  describe('getCodecDistribution', () => {
    it('should return codec distribution with licenseId filter', async () => {
      const dist = { codecs: [{ codec: 'H.264', count: 500, percentage: 59.4 }], totalFiles: 842 };
      mockInsightsService.getCodecDistribution.mockResolvedValue(dist);

      const response = await controller.getCodecDistribution('lic-1');

      expect(mockInsightsService.getCodecDistribution).toHaveBeenCalledWith('lic-1');
      expect(response).toEqual(dist);
    });

    it('should return codec distribution without licenseId', async () => {
      const dist = { codecs: [], totalFiles: 0 };
      mockInsightsService.getCodecDistribution.mockResolvedValue(dist);

      await controller.getCodecDistribution(undefined);

      expect(mockInsightsService.getCodecDistribution).toHaveBeenCalledWith(undefined);
    });

    it('should propagate service errors', async () => {
      mockInsightsService.getCodecDistribution.mockRejectedValue(new Error('codec error'));
      await expect(controller.getCodecDistribution()).rejects.toThrow('codec error');
    });
  });

  describe('getSavingsTrend', () => {
    it('should use default 30 days when days param is omitted', async () => {
      const trend = { dailySavings: [], totalSavedBytes: '0', totalSavedGB: 0 };
      mockInsightsService.getSavingsTrend.mockResolvedValue(trend);

      const response = await controller.getSavingsTrend();

      expect(mockInsightsService.getSavingsTrend).toHaveBeenCalledWith(30, undefined);
      expect(response).toEqual(trend);
    });

    it('should pass provided days and licenseId to service', async () => {
      const trend = { dailySavings: [], totalSavedBytes: '500', totalSavedGB: 0.5 };
      mockInsightsService.getSavingsTrend.mockResolvedValue(trend);

      const response = await controller.getSavingsTrend(7, 'lic-1');

      expect(mockInsightsService.getSavingsTrend).toHaveBeenCalledWith(7, 'lic-1');
      expect(response).toEqual(trend);
    });

    it('should coerce days to a number', async () => {
      mockInsightsService.getSavingsTrend.mockResolvedValue({});

      await controller.getSavingsTrend('90' as never);

      expect(mockInsightsService.getSavingsTrend).toHaveBeenCalledWith(90, undefined);
    });

    it('should propagate service errors', async () => {
      mockInsightsService.getSavingsTrend.mockRejectedValue(new Error('trend error'));
      await expect(controller.getSavingsTrend()).rejects.toThrow('trend error');
    });
  });

  describe('getNodeComparison', () => {
    it('should return node comparison with licenseId', async () => {
      const comparison = { nodes: [{ nodeId: 'node-1', jobsCompleted: 523, successRate: 98.7 }] };
      mockInsightsService.getNodeComparison.mockResolvedValue(comparison);

      const response = await controller.getNodeComparison('lic-1');

      expect(mockInsightsService.getNodeComparison).toHaveBeenCalledWith('lic-1');
      expect(response).toEqual(comparison);
    });

    it('should return node comparison without licenseId', async () => {
      mockInsightsService.getNodeComparison.mockResolvedValue({ nodes: [] });

      await controller.getNodeComparison(undefined);

      expect(mockInsightsService.getNodeComparison).toHaveBeenCalledWith(undefined);
    });

    it('should propagate service errors', async () => {
      mockInsightsService.getNodeComparison.mockRejectedValue(new Error('nodes error'));
      await expect(controller.getNodeComparison()).rejects.toThrow('nodes error');
    });
  });
});
