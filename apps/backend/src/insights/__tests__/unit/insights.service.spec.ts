import { Test, type TestingModule } from '@nestjs/testing';
import type { AccelerationType, NodeStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { InsightsService } from '../../insights.service';

describe('InsightsService', () => {
  let service: InsightsService;
  let prisma: PrismaService;

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

  const mockPrismaService = {
    metric: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    node: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InsightsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<InsightsService>(InsightsService);
    prisma = module.get<PrismaService>(PrismaService);

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getTimeSeriesMetrics', () => {
    it('should fetch metrics for a date range', async () => {
      const startDate = new Date('2024-09-01');
      const endDate = new Date('2024-09-30');

      mockPrismaService.metric.findMany.mockResolvedValue(mockMetrics);

      const result = await service.getTimeSeriesMetrics({
        startDate,
        endDate,
      });

      expect(result).toEqual(mockMetrics);
      expect(prisma.metric.findMany).toHaveBeenCalledWith({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
          nodeId: undefined,
          licenseId: undefined,
        },
        orderBy: {
          date: 'asc',
        },
      });
    });

    it('should filter metrics by nodeId', async () => {
      const startDate = new Date('2024-09-01');
      const endDate = new Date('2024-09-30');
      const nodeId = 'node1';

      mockPrismaService.metric.findMany.mockResolvedValue([mockMetrics[0]]);

      await service.getTimeSeriesMetrics({
        startDate,
        endDate,
        nodeId,
      });

      expect(prisma.metric.findMany).toHaveBeenCalledWith({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
          nodeId: 'node1',
          licenseId: undefined,
        },
        orderBy: {
          date: 'asc',
        },
      });
    });

    it('should filter metrics by licenseId', async () => {
      const startDate = new Date('2024-09-01');
      const endDate = new Date('2024-09-30');
      const licenseId = 'license1';

      mockPrismaService.metric.findMany.mockResolvedValue(mockMetrics);

      await service.getTimeSeriesMetrics({
        startDate,
        endDate,
        licenseId,
      });

      expect(prisma.metric.findMany).toHaveBeenCalledWith({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
          nodeId: undefined,
          licenseId: 'license1',
        },
        orderBy: {
          date: 'asc',
        },
      });
    });
  });

  describe('getAggregatedStats', () => {
    it('should calculate aggregated statistics', async () => {
      mockPrismaService.metric.aggregate.mockResolvedValue({
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
      expect(result.timestamp).toBeDefined();
    });

    it('should handle zero values', async () => {
      mockPrismaService.metric.aggregate.mockResolvedValue({
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
      mockPrismaService.metric.aggregate.mockResolvedValue({
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

      expect(prisma.metric.aggregate).toHaveBeenCalledWith({
        where: { licenseId: 'license1' },
        _sum: {
          jobsCompleted: true,
          jobsFailed: true,
          totalSavedBytes: true,
        },
        _avg: {
          avgThroughputFilesPerHour: true,
        },
      });
    });
  });

  describe('getCodecDistribution', () => {
    it('should calculate codec distribution from metrics', async () => {
      mockPrismaService.metric.findMany.mockResolvedValue(mockMetrics);

      const result = await service.getCodecDistribution();

      expect(result.distribution).toHaveLength(3);
      expect(result.totalFiles).toBe(80); // Sum of all codec counts
      expect(result.distribution[0].codec).toBe('H.264');
      expect(result.distribution[0].count).toBe(47); // 25 + 22
      expect(result.distribution[0].percentage).toBeCloseTo(58.75, 1);
    });

    it('should handle empty metrics', async () => {
      mockPrismaService.metric.findMany.mockResolvedValue([]);

      const result = await service.getCodecDistribution();

      expect(result.distribution).toEqual([]);
      expect(result.totalFiles).toBe(0);
    });

    it('should sort by count descending', async () => {
      mockPrismaService.metric.findMany.mockResolvedValue(mockMetrics);

      const result = await service.getCodecDistribution();

      // Should be sorted: H.264 (47), HEVC (29), AV1 (4)
      expect(result.distribution[0].count).toBeGreaterThanOrEqual(result.distribution[1].count);
      expect(result.distribution[1].count).toBeGreaterThanOrEqual(result.distribution[2].count);
    });
  });

  describe('getSavingsTrend', () => {
    it('should calculate savings trend for specified days', async () => {
      mockPrismaService.metric.findMany.mockResolvedValue(mockMetrics);

      const result = await service.getSavingsTrend(7);

      expect(result.trend.length).toBeGreaterThan(0);
      expect(result.days).toBeGreaterThan(0);
      expect(result.totalSavedBytes).toBeDefined();
      expect(result.totalSavedGB).toBeGreaterThan(0);
    });

    it('should group metrics by date', async () => {
      // Both metrics on same date
      const sameDay = new Date('2024-09-30');
      const metricsOnSameDay = [
        { ...mockMetrics[0], date: sameDay },
        { ...mockMetrics[1], date: sameDay },
      ];

      mockPrismaService.metric.findMany.mockResolvedValue(metricsOnSameDay);

      const result = await service.getSavingsTrend(7);

      // Should combine metrics from same date
      expect(result.trend.length).toBe(1);
      expect(result.trend[0].jobsCompleted).toBe(80); // 42 + 38
    });

    it('should handle empty metrics for trend', async () => {
      mockPrismaService.metric.findMany.mockResolvedValue([]);

      const result = await service.getSavingsTrend(30);

      expect(result.trend).toEqual([]);
      expect(result.totalSavedBytes).toBe('0');
      expect(result.totalSavedGB).toBe(0);
      expect(result.days).toBe(0);
    });
  });

  describe('getNodeComparison', () => {
    it('should compare performance across nodes', async () => {
      mockPrismaService.node.findMany.mockResolvedValue(mockNodes);

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
      mockPrismaService.node.findMany.mockResolvedValue(mockNodes);

      const result = await service.getNodeComparison();

      const mainNode = result.nodes.find((n) => n.nodeId === 'node1');
      expect(mainNode).toBeDefined();
      expect(mainNode?.jobsCompleted).toBe(80); // Sum of both metrics
      expect(mainNode?.jobsFailed).toBe(3);
      expect(mainNode?.successRate).toBeCloseTo(96.39, 1);
    });

    it('should handle nodes with no metrics', async () => {
      mockPrismaService.node.findMany.mockResolvedValue(mockNodes);

      const result = await service.getNodeComparison();

      const secondaryNode = result.nodes.find((n) => n.nodeId === 'node2');
      expect(secondaryNode).toBeDefined();
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

      mockPrismaService.node.findMany.mockResolvedValue([node1, node2]);

      const result = await service.getNodeComparison();

      // node1 should be first (more savings)
      expect(BigInt(result.nodes[0].totalSavedBytes)).toBeGreaterThan(
        BigInt(result.nodes[1].totalSavedBytes)
      );
    });
  });
});
