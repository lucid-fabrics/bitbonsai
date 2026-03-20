import { Test, type TestingModule } from '@nestjs/testing';
import type { AccelerationType, NodeStatus } from '@prisma/client';
import { MetricsRepository } from '../../../common/repositories/metrics.repository';
import { NodeRepository } from '../../../common/repositories/node.repository';
import { InsightsService } from '../../insights.service';

describe('InsightsService', () => {
  let service: InsightsService;

  const mockMetrics = [
    {
      id: 'metric1',
      date: new Date('2024-09-30T00:00:00Z'),
      nodeId: 'node1',
      licenseId: 'license1',
      jobsCompleted: 42,
      jobsFailed: 1,
      totalSavedBytes: BigInt(5368709120), // 5 GB
      avgThroughputFilesPerHour: 12.5,
      codecDistribution: { 'H.264': 25, HEVC: 15, AV1: 2 },
      createdAt: new Date('2024-09-30T23:59:59Z'),
    },
    {
      id: 'metric2',
      date: new Date('2024-10-01T00:00:00Z'),
      nodeId: 'node1',
      licenseId: 'license1',
      jobsCompleted: 38,
      jobsFailed: 2,
      totalSavedBytes: BigInt(6442450944), // 6 GB
      avgThroughputFilesPerHour: 11.3,
      codecDistribution: { 'H.264': 22, HEVC: 14, AV1: 2 },
      createdAt: new Date('2024-10-01T23:59:59Z'),
    },
  ];

  const mockNodes = [
    {
      id: 'node1',
      name: 'Main Server',
      acceleration: 'NVIDIA' as AccelerationType,
      status: 'ONLINE' as NodeStatus,
      metrics: mockMetrics,
    },
    {
      id: 'node2',
      name: 'Secondary Server',
      acceleration: 'INTEL_QSV' as AccelerationType,
      status: 'ONLINE' as NodeStatus,
      metrics: [],
    },
  ];

  const mockMetricsRepository = {
    findByDateRange: jest.fn(),
    aggregateByLicense: jest.fn(),
    findCodecDistributions: jest.fn(),
    findByDateRangeOrdered: jest.fn(),
  };

  const mockNodeRepository = {
    findAllWithMetrics: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InsightsService,
        { provide: MetricsRepository, useValue: mockMetricsRepository },
        { provide: NodeRepository, useValue: mockNodeRepository },
      ],
    }).compile();

    service = module.get<InsightsService>(InsightsService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeInstanceOf(InsightsService);
  });

  describe('getTimeSeriesMetrics', () => {
    it('should fetch metrics for a date range', async () => {
      const startDate = new Date('2024-09-01');
      const endDate = new Date('2024-09-30');

      mockMetricsRepository.findByDateRange.mockResolvedValue(mockMetrics);

      const result = await service.getTimeSeriesMetrics({ startDate, endDate });

      expect(result).toEqual(mockMetrics);
      expect(mockMetricsRepository.findByDateRange).toHaveBeenCalledWith({
        startDate,
        endDate,
        nodeId: undefined,
        licenseId: undefined,
      });
    });

    it('should filter metrics by nodeId', async () => {
      const startDate = new Date('2024-09-01');
      const endDate = new Date('2024-09-30');

      mockMetricsRepository.findByDateRange.mockResolvedValue([mockMetrics[0]]);

      await service.getTimeSeriesMetrics({ startDate, endDate, nodeId: 'node1' });

      expect(mockMetricsRepository.findByDateRange).toHaveBeenCalledWith({
        startDate,
        endDate,
        nodeId: 'node1',
        licenseId: undefined,
      });
    });

    it('should filter metrics by licenseId', async () => {
      const startDate = new Date('2024-09-01');
      const endDate = new Date('2024-09-30');

      mockMetricsRepository.findByDateRange.mockResolvedValue(mockMetrics);

      await service.getTimeSeriesMetrics({ startDate, endDate, licenseId: 'license1' });

      expect(mockMetricsRepository.findByDateRange).toHaveBeenCalledWith({
        startDate,
        endDate,
        nodeId: undefined,
        licenseId: 'license1',
      });
    });

    it('should propagate errors from repository', async () => {
      mockMetricsRepository.findByDateRange.mockRejectedValue(new Error('Query timeout'));

      await expect(
        service.getTimeSeriesMetrics({
          startDate: new Date('2024-09-01'),
          endDate: new Date('2024-09-30'),
        })
      ).rejects.toThrow('Query timeout');
    });
  });

  describe('getAggregatedStats', () => {
    it('should calculate aggregated statistics', async () => {
      mockMetricsRepository.aggregateByLicense.mockResolvedValue({
        _sum: {
          jobsCompleted: 80,
          jobsFailed: 3,
          totalSavedBytes: BigInt(11811160064), // 11 GB
        },
        _avg: {
          avgThroughputFilesPerHour: 11.9,
        },
      });

      const result = await service.getAggregatedStats();

      expect(result).toMatchObject({
        totalJobsCompleted: 80,
        totalJobsFailed: 3,
        totalSavedBytes: '11811160064',
        totalSavedGB: 11.0,
        avgThroughput: 11.9,
        successRate: 96.39,
      });
      expect(typeof result.timestamp).toBe('string');
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });

    it('should handle zero values', async () => {
      mockMetricsRepository.aggregateByLicense.mockResolvedValue({
        _sum: {
          jobsCompleted: 0,
          jobsFailed: 0,
          totalSavedBytes: BigInt(0),
        },
        _avg: {
          avgThroughputFilesPerHour: 0,
        },
      });

      const result = await service.getAggregatedStats();

      expect(result).toMatchObject({
        totalJobsCompleted: 0,
        totalJobsFailed: 0,
        totalSavedBytes: '0',
        totalSavedGB: 0,
        avgThroughput: 0,
        successRate: 0,
      });
    });

    it('should filter by licenseId when provided', async () => {
      mockMetricsRepository.aggregateByLicense.mockResolvedValue({
        _sum: {
          jobsCompleted: 42,
          jobsFailed: 1,
          totalSavedBytes: BigInt(5368709120),
        },
        _avg: {
          avgThroughputFilesPerHour: 12.5,
        },
      });

      await service.getAggregatedStats('license1');

      expect(mockMetricsRepository.aggregateByLicense).toHaveBeenCalledWith('license1');
    });

    it('should propagate errors from repository', async () => {
      mockMetricsRepository.aggregateByLicense.mockRejectedValue(new Error('Prisma error'));

      await expect(service.getAggregatedStats()).rejects.toThrow('Prisma error');
    });
  });

  describe('getCodecDistribution', () => {
    it('should calculate codec distribution from metrics', async () => {
      mockMetricsRepository.findCodecDistributions.mockResolvedValue(mockMetrics);

      const result = await service.getCodecDistribution();

      expect(result.distribution).toHaveLength(3);
      expect(result.totalFiles).toBe(80); // Sum of all codec counts
      expect(result.distribution[0].codec).toBe('H.264');
      expect(result.distribution[0].count).toBe(47); // 25 + 22
      expect(result.distribution[0].percentage).toBeCloseTo(58.75, 1);
    });

    it('should handle empty metrics', async () => {
      mockMetricsRepository.findCodecDistributions.mockResolvedValue([]);

      const result = await service.getCodecDistribution();

      expect(result.distribution).toEqual([]);
      expect(result.totalFiles).toBe(0);
    });

    it('should sort by count descending', async () => {
      mockMetricsRepository.findCodecDistributions.mockResolvedValue(mockMetrics);

      const result = await service.getCodecDistribution();

      // Should be sorted: H.264 (47), HEVC (29), AV1 (4)
      expect(result.distribution[0].count).toBeGreaterThanOrEqual(result.distribution[1].count);
      expect(result.distribution[1].count).toBeGreaterThanOrEqual(result.distribution[2].count);
    });

    it('should propagate errors from repository', async () => {
      mockMetricsRepository.findCodecDistributions.mockRejectedValue(new Error('Query timeout'));

      await expect(service.getCodecDistribution()).rejects.toThrow('Query timeout');
    });
  });

  describe('getSavingsTrend', () => {
    it('should calculate savings trend for specified days', async () => {
      mockMetricsRepository.findByDateRangeOrdered.mockResolvedValue(mockMetrics);

      const result = await service.getSavingsTrend(7);

      expect(result.trend.length).toBeGreaterThan(0);
      expect(result.days).toBeGreaterThan(0);
      expect(result.totalSavedBytes).toBe('11811160064');
      expect(result.totalSavedGB).toBeGreaterThan(0);
    });

    it('should group metrics by date', async () => {
      const sameDay = new Date('2024-09-30');
      const metricsOnSameDay = [
        { ...mockMetrics[0], date: sameDay },
        { ...mockMetrics[1], date: sameDay },
      ];

      mockMetricsRepository.findByDateRangeOrdered.mockResolvedValue(metricsOnSameDay);

      const result = await service.getSavingsTrend(7);

      expect(result.trend.length).toBe(1);
      expect(result.trend[0].jobsCompleted).toBe(80); // 42 + 38
    });

    it('should handle empty metrics for trend', async () => {
      mockMetricsRepository.findByDateRangeOrdered.mockResolvedValue([]);

      const result = await service.getSavingsTrend(30);

      expect(result.trend).toEqual([]);
      expect(result.totalSavedBytes).toBe('0');
      expect(result.totalSavedGB).toBe(0);
      expect(result.days).toBe(0);
    });

    it('should propagate errors from repository', async () => {
      mockMetricsRepository.findByDateRangeOrdered.mockRejectedValue(new Error('DB unavailable'));

      await expect(service.getSavingsTrend(7)).rejects.toThrow('DB unavailable');
    });
  });

  describe('getNodeComparison', () => {
    it('should compare performance across nodes', async () => {
      mockNodeRepository.findAllWithMetrics.mockResolvedValue(mockNodes);

      const result = await service.getNodeComparison();

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0]).toMatchObject({
        nodeId: 'node1',
        nodeName: 'Main Server',
        acceleration: 'NVIDIA',
        status: 'ONLINE',
      });
    });

    it('should calculate node metrics correctly', async () => {
      mockNodeRepository.findAllWithMetrics.mockResolvedValue(mockNodes);

      const result = await service.getNodeComparison();

      const mainNode = result.nodes.find((n) => n.nodeId === 'node1');
      expect(mainNode).toMatchObject({ nodeId: 'node1', nodeName: 'Main Server' });
      expect(mainNode?.jobsCompleted).toBe(80); // Sum of both metrics
      expect(mainNode?.jobsFailed).toBe(3);
      expect(mainNode?.successRate).toBeCloseTo(96.39, 1);
    });

    it('should handle nodes with no metrics', async () => {
      mockNodeRepository.findAllWithMetrics.mockResolvedValue(mockNodes);

      const result = await service.getNodeComparison();

      const secondaryNode = result.nodes.find((n) => n.nodeId === 'node2');
      expect(secondaryNode).toMatchObject({ nodeId: 'node2', nodeName: 'Secondary Server' });
      expect(secondaryNode?.jobsCompleted).toBe(0);
      expect(secondaryNode?.successRate).toBe(0);
      expect(secondaryNode?.avgThroughput).toBe(0);
    });

    it('should sort nodes by total saved bytes', async () => {
      const node1 = { ...mockNodes[0], metrics: mockMetrics };
      const node2 = {
        ...mockNodes[1],
        metrics: [
          {
            ...mockMetrics[0],
            totalSavedBytes: BigInt(1073741824), // 1 GB (less than node1)
          },
        ],
      };

      mockNodeRepository.findAllWithMetrics.mockResolvedValue([node1, node2]);

      const result = await service.getNodeComparison();

      // node1 should be first (more savings)
      expect(BigInt(result.nodes[0].totalSavedBytes)).toBeGreaterThan(
        BigInt(result.nodes[1].totalSavedBytes)
      );
    });

    it('should propagate errors from repository', async () => {
      mockNodeRepository.findAllWithMetrics.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.getNodeComparison()).rejects.toThrow('DB connection lost');
    });
  });
});
