import { Test, type TestingModule } from '@nestjs/testing';
import type { TimeSeriesQueryDto } from './dto/time-series-query.dto';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

describe('InsightsController', () => {
  let controller: InsightsController;
  let service: InsightsService;

  const mockMetric = {
    id: 'metric1',
    date: new Date('2024-09-30T00:00:00Z'),
    nodeId: 'node1',
    licenseId: 'license1',
    jobsCompleted: 42,
    jobsFailed: 1,
    totalSavedBytes: BigInt(5368709120),
    avgThroughputFilesPerHour: 12.5,
    codecDistribution: { 'H.264': 25, HEVC: 15, AV1: 2 },
    createdAt: new Date('2024-09-30T23:59:59Z'),
  };

  const mockInsightsService = {
    getTimeSeriesMetrics: jest.fn(),
    getAggregatedStats: jest.fn(),
    getCodecDistribution: jest.fn(),
    getSavingsTrend: jest.fn(),
    getNodeComparison: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InsightsController],
      providers: [
        {
          provide: InsightsService,
          useValue: mockInsightsService,
        },
      ],
    }).compile();

    controller = module.get<InsightsController>(InsightsController);
    service = module.get<InsightsService>(InsightsService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getMetrics', () => {
    it('should return time-series metrics', async () => {
      const query: TimeSeriesQueryDto = {
        startDate: new Date('2024-09-01'),
        endDate: new Date('2024-09-30'),
      };

      mockInsightsService.getTimeSeriesMetrics.mockResolvedValue([mockMetric]);

      const result = await controller.getMetrics(query);

      expect(result).toEqual([mockMetric]);
      expect(service.getTimeSeriesMetrics).toHaveBeenCalledWith({
        startDate: query.startDate,
        endDate: query.endDate,
        nodeId: undefined,
        licenseId: undefined,
      });
    });

    it('should pass optional filters to service', async () => {
      const query: TimeSeriesQueryDto = {
        startDate: new Date('2024-09-01'),
        endDate: new Date('2024-09-30'),
        nodeId: 'node1',
        licenseId: 'license1',
      };

      mockInsightsService.getTimeSeriesMetrics.mockResolvedValue([mockMetric]);

      await controller.getMetrics(query);

      expect(service.getTimeSeriesMetrics).toHaveBeenCalledWith({
        startDate: query.startDate,
        endDate: query.endDate,
        nodeId: 'node1',
        licenseId: 'license1',
      });
    });
  });

  describe('getStats', () => {
    it('should return aggregated statistics', async () => {
      const mockStats = {
        totalJobsCompleted: 1247,
        totalJobsFailed: 23,
        totalSavedBytes: '524288000000',
        totalSavedGB: 488.28,
        avgThroughput: 12.5,
        successRate: 98.2,
        timestamp: '2024-09-30T21:45:32.123Z',
      };

      mockInsightsService.getAggregatedStats.mockResolvedValue(mockStats);

      const result = await controller.getStats();

      expect(result).toEqual(mockStats);
      expect(service.getAggregatedStats).toHaveBeenCalledWith(undefined);
    });

    it('should pass licenseId filter when provided', async () => {
      const mockStats = {
        totalJobsCompleted: 500,
        totalJobsFailed: 10,
        totalSavedBytes: '200000000000',
        totalSavedGB: 186.26,
        avgThroughput: 10.5,
        successRate: 98.0,
        timestamp: '2024-09-30T21:45:32.123Z',
      };

      mockInsightsService.getAggregatedStats.mockResolvedValue(mockStats);

      const result = await controller.getStats('license1');

      expect(result).toEqual(mockStats);
      expect(service.getAggregatedStats).toHaveBeenCalledWith('license1');
    });
  });

  describe('getCodecDistribution', () => {
    it('should return codec distribution', async () => {
      const mockDistribution = {
        distribution: [
          { codec: 'H.264', count: 425, percentage: 59.4 },
          { codec: 'HEVC', count: 245, percentage: 34.2 },
          { codec: 'AV1', count: 38, percentage: 5.3 },
          { codec: 'VP9', count: 8, percentage: 1.1 },
        ],
        totalFiles: 716,
        timestamp: '2024-09-30T21:45:32.123Z',
      };

      mockInsightsService.getCodecDistribution.mockResolvedValue(mockDistribution);

      const result = await controller.getCodecDistribution();

      expect(result).toEqual(mockDistribution);
      expect(service.getCodecDistribution).toHaveBeenCalledWith(undefined);
    });

    it('should filter by licenseId when provided', async () => {
      const mockDistribution = {
        distribution: [{ codec: 'H.264', count: 100, percentage: 100 }],
        totalFiles: 100,
        timestamp: '2024-09-30T21:45:32.123Z',
      };

      mockInsightsService.getCodecDistribution.mockResolvedValue(mockDistribution);

      await controller.getCodecDistribution('license1');

      expect(service.getCodecDistribution).toHaveBeenCalledWith('license1');
    });
  });

  describe('getSavingsTrend', () => {
    it('should return savings trend with default 30 days', async () => {
      const mockTrend = {
        trend: [
          {
            date: '2024-09-30',
            savedBytes: '5368709120',
            savedGB: 5.0,
            jobsCompleted: 42,
          },
        ],
        totalSavedBytes: '107374182400',
        totalSavedGB: 100.0,
        days: 30,
        timestamp: '2024-09-30T21:45:32.123Z',
      };

      mockInsightsService.getSavingsTrend.mockResolvedValue(mockTrend);

      const result = await controller.getSavingsTrend();

      expect(result).toEqual(mockTrend);
      expect(service.getSavingsTrend).toHaveBeenCalledWith(30, undefined);
    });

    it('should use custom days parameter', async () => {
      const mockTrend = {
        trend: [],
        totalSavedBytes: '0',
        totalSavedGB: 0,
        days: 7,
        timestamp: '2024-09-30T21:45:32.123Z',
      };

      mockInsightsService.getSavingsTrend.mockResolvedValue(mockTrend);

      await controller.getSavingsTrend(7);

      expect(service.getSavingsTrend).toHaveBeenCalledWith(7, undefined);
    });

    it('should pass licenseId filter when provided', async () => {
      const mockTrend = {
        trend: [],
        totalSavedBytes: '0',
        totalSavedGB: 0,
        days: 90,
        timestamp: '2024-09-30T21:45:32.123Z',
      };

      mockInsightsService.getSavingsTrend.mockResolvedValue(mockTrend);

      await controller.getSavingsTrend(90, 'license1');

      expect(service.getSavingsTrend).toHaveBeenCalledWith(90, 'license1');
    });
  });

  describe('getNodeComparison', () => {
    it('should return node performance comparison', async () => {
      const mockComparison = {
        nodes: [
          {
            nodeId: 'node1',
            nodeName: 'Main Server',
            acceleration: 'NVIDIA',
            jobsCompleted: 523,
            jobsFailed: 7,
            successRate: 98.7,
            totalSavedBytes: '268435456000',
            totalSavedGB: 250.0,
            avgThroughput: 15.3,
            status: 'ONLINE',
          },
          {
            nodeId: 'node2',
            nodeName: 'Secondary Server',
            acceleration: 'INTEL_QSV',
            jobsCompleted: 412,
            jobsFailed: 9,
            successRate: 97.8,
            totalSavedBytes: '201863462912',
            totalSavedGB: 188.3,
            avgThroughput: 11.2,
            status: 'ONLINE',
          },
        ],
        timestamp: '2024-09-30T21:45:32.123Z',
      };

      mockInsightsService.getNodeComparison.mockResolvedValue(mockComparison);

      const result = await controller.getNodeComparison();

      expect(result).toEqual(mockComparison);
      expect(service.getNodeComparison).toHaveBeenCalledWith(undefined);
    });

    it('should filter by licenseId when provided', async () => {
      const mockComparison = {
        nodes: [
          {
            nodeId: 'node1',
            nodeName: 'Single Node',
            acceleration: 'CPU',
            jobsCompleted: 100,
            jobsFailed: 5,
            successRate: 95.24,
            totalSavedBytes: '53687091200',
            totalSavedGB: 50.0,
            avgThroughput: 8.5,
            status: 'ONLINE',
          },
        ],
        timestamp: '2024-09-30T21:45:32.123Z',
      };

      mockInsightsService.getNodeComparison.mockResolvedValue(mockComparison);

      await controller.getNodeComparison('license1');

      expect(service.getNodeComparison).toHaveBeenCalledWith('license1');
    });
  });
});
