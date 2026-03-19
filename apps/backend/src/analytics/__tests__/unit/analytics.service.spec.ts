import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { AnalyticsService } from '../../analytics.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  const mockPrismaService = {
    job: {
      count: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });
  });

  describe('getStorageProviders', () => {
    it('should return list of storage providers with costs', () => {
      const providers = service.getStorageProviders();

      expect(providers.length).toBeGreaterThan(0);
      expect(providers).toContainEqual(
        expect.objectContaining({
          name: expect.any(String),
          costPerGB: expect.any(Number),
        })
      );
    });

    it('should include common providers', () => {
      const providers = service.getStorageProviders();
      const providerNames = providers.map((p) => p.name);

      expect(providerNames).toContain('AWS S3');
      expect(providerNames).toContain('Google Cloud');
      expect(providerNames).toContain('Local HDD');
    });
  });

  describe('getCostSavings', () => {
    it('should calculate cost savings for AWS S3', async () => {
      mockPrismaService.job.aggregate.mockResolvedValue({
        _sum: { savedBytes: BigInt(1024 * 1024 * 1024 * 100) }, // 100GB
      });

      const result = await service.getCostSavings('AWS S3');

      expect(result.provider).toBe('AWS S3');
      expect(result.totalSavedGB).toBeCloseTo(100, 0);
      expect(result.costPerGB).toBe(0.023);
      expect(result.estimatedMonthlyCost).toBeCloseTo(2.3, 1);
      expect(result.estimatedYearlyCost).toBeCloseTo(27.6, 1);
    });

    it('should use default cost if provider not found', async () => {
      mockPrismaService.job.aggregate.mockResolvedValue({
        _sum: { savedBytes: BigInt(1024 * 1024 * 1024 * 100) },
      });

      const result = await service.getCostSavings('Unknown Provider');

      expect(result.provider).toBe('Unknown Provider');
      expect(result.costPerGB).toBe(0.02); // Default
    });

    it('should handle zero saved bytes', async () => {
      mockPrismaService.job.aggregate.mockResolvedValue({
        _sum: { savedBytes: BigInt(0) },
      });

      const result = await service.getCostSavings('AWS S3');

      expect(result.totalSavedGB).toBe(0);
      expect(result.estimatedMonthlyCost).toBe(0);
      expect(result.estimatedYearlyCost).toBe(0);
    });

    it('should handle null saved bytes', async () => {
      mockPrismaService.job.aggregate.mockResolvedValue({
        _sum: { savedBytes: null },
      });

      const result = await service.getCostSavings('AWS S3');

      expect(result.totalSavedGB).toBe(0);
    });
  });

  describe('getSummary', () => {
    beforeEach(() => {
      // Default mocks for summary
      mockPrismaService.job.count.mockResolvedValue(100);
      mockPrismaService.job.aggregate.mockResolvedValue({
        _sum: { savedBytes: BigInt(1024 * 1024 * 1024 * 500) }, // 500GB
        _avg: { savedPercent: 45 },
        _count: { id: 100 },
      });
      mockPrismaService.$queryRaw.mockResolvedValue([{ avg_duration_ms: 3600000 }]); // 1 hour avg
      mockPrismaService.job.groupBy.mockResolvedValue([
        { targetCodec: 'HEVC', _avg: { savedPercent: 50 }, _count: 80 },
        { targetCodec: 'AV1', _avg: { savedPercent: 60 }, _count: 20 },
      ]);
      mockPrismaService.job.findMany.mockResolvedValue([]);
    });

    it('should return analytics summary', async () => {
      const result = await service.getSummary();

      expect(result.totalJobsProcessed).toBe(100);
      expect(result.totalFilesEncoded).toBe(100);
      expect(result.avgSavedPercent).toBe(45);
      expect(result.mostEfficientCodec).toBe('AV1'); // Higher saved percent
    });

    it('should calculate success rate correctly', async () => {
      mockPrismaService.job.count
        .mockResolvedValueOnce(90) // Completed
        .mockResolvedValueOnce(10); // Failed

      const result = await service.getSummary();

      expect(result.successRate).toBe(90); // 90 / (90 + 10) * 100
    });

    it('should handle 100% success rate', async () => {
      mockPrismaService.job.count
        .mockResolvedValueOnce(100) // Completed
        .mockResolvedValueOnce(0); // Failed

      const result = await service.getSummary();

      expect(result.successRate).toBe(100);
    });

    it('should handle zero jobs', async () => {
      mockPrismaService.job.count.mockResolvedValue(0);
      mockPrismaService.job.aggregate.mockResolvedValue({
        _sum: { savedBytes: null },
        _avg: { savedPercent: null },
        _count: { id: 0 },
      });
      mockPrismaService.job.groupBy.mockResolvedValue([]);

      const result = await service.getSummary();

      expect(result.totalJobsProcessed).toBe(0);
      expect(result.successRate).toBe(100); // Default when no jobs
      expect(result.mostEfficientCodec).toBe('N/A');
    });
  });

  describe('getEncodingSpeedTrends', () => {
    it('should return empty array for no jobs', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([]);

      const result = await service.getEncodingSpeedTrends('30d');

      expect(result).toEqual([]);
    });

    it('should calculate speed trends from jobs', async () => {
      const mockJobs = [
        {
          completedAt: new Date('2024-01-15T10:00:00Z'),
          startedAt: new Date('2024-01-15T09:00:00Z'), // 1 hour = 3600s
          beforeSizeBytes: BigInt(1024 * 1024 * 1024), // 1GB
          targetCodec: 'HEVC',
        },
        {
          completedAt: new Date('2024-01-15T12:00:00Z'),
          startedAt: new Date('2024-01-15T11:00:00Z'),
          beforeSizeBytes: BigInt(1024 * 1024 * 1024 * 2), // 2GB
          targetCodec: 'HEVC',
        },
      ];

      mockPrismaService.job.findMany.mockResolvedValue(mockJobs);

      const result = await service.getEncodingSpeedTrends('30d');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('avgBytesPerSecond');
      expect(result[0]).toHaveProperty('codec', 'HEVC');
      expect(result[0]).toHaveProperty('jobCount');
    });

    it('should skip jobs with missing timing data', async () => {
      const mockJobs = [
        {
          completedAt: null,
          startedAt: new Date('2024-01-15T09:00:00Z'),
          beforeSizeBytes: BigInt(1024 * 1024 * 1024),
          targetCodec: 'HEVC',
        },
      ];

      mockPrismaService.job.findMany.mockResolvedValue(mockJobs);

      const result = await service.getEncodingSpeedTrends('30d');

      expect(result).toEqual([]);
    });
  });

  describe('getCodecPerformance', () => {
    it('should return empty array for no jobs', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([]);

      const result = await service.getCodecPerformance('30d');

      expect(result).toEqual([]);
    });

    it('should group performance by codec', async () => {
      const mockJobs = [
        {
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1024 * 1024 * 1024),
          savedPercent: 40,
          startedAt: new Date('2024-01-15T09:00:00Z'),
          completedAt: new Date('2024-01-15T10:00:00Z'),
        },
        {
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(1024 * 1024 * 1024),
          savedPercent: 50,
          startedAt: new Date('2024-01-15T11:00:00Z'),
          completedAt: new Date('2024-01-15T12:00:00Z'),
        },
        {
          targetCodec: 'AV1',
          beforeSizeBytes: BigInt(1024 * 1024 * 1024),
          savedPercent: 60,
          startedAt: new Date('2024-01-15T13:00:00Z'),
          completedAt: new Date('2024-01-15T15:00:00Z'), // 2 hours
        },
      ];

      mockPrismaService.job.findMany.mockResolvedValue(mockJobs);

      const result = await service.getCodecPerformance('30d');

      expect(result.length).toBe(2);

      const hevcResult = result.find((r) => r.codec === 'HEVC');
      const av1Result = result.find((r) => r.codec === 'AV1');

      expect(hevcResult).not.toBeUndefined();
      expect(hevcResult?.jobCount).toBe(2);
      expect(hevcResult?.avgSavedPercent).toBe(45); // (40 + 50) / 2

      expect(av1Result).not.toBeUndefined();
      expect(av1Result?.jobCount).toBe(1);
      expect(av1Result?.avgSavedPercent).toBe(60);
    });
  });

  describe('getNodePerformance', () => {
    it('should return empty array for no jobs', async () => {
      mockPrismaService.job.findMany.mockResolvedValue([]);
      mockPrismaService.job.groupBy.mockResolvedValue([]);

      const result = await service.getNodePerformance('30d');

      expect(result).toEqual([]);
    });

    it('should calculate node performance metrics', async () => {
      const mockJobs = [
        {
          nodeId: 'node-1',
          beforeSizeBytes: BigInt(1024 * 1024 * 1024),
          savedPercent: 40,
          startedAt: new Date('2024-01-15T09:00:00Z'),
          completedAt: new Date('2024-01-15T10:00:00Z'),
          node: { name: 'Main Node' },
        },
      ];

      mockPrismaService.job.findMany.mockResolvedValue(mockJobs);
      mockPrismaService.job.groupBy.mockResolvedValue([]); // No failed jobs

      const result = await service.getNodePerformance('30d');

      expect(result.length).toBe(1);
      expect(result[0].nodeId).toBe('node-1');
      expect(result[0].nodeName).toBe('Main Node');
      expect(result[0].jobCount).toBe(1);
      expect(result[0].successRate).toBe(100);
    });

    it('should calculate success rate with failed jobs', async () => {
      const mockJobs = [
        {
          nodeId: 'node-1',
          beforeSizeBytes: BigInt(1024 * 1024 * 1024),
          savedPercent: 40,
          startedAt: new Date('2024-01-15T09:00:00Z'),
          completedAt: new Date('2024-01-15T10:00:00Z'),
          node: { name: 'Main Node' },
        },
      ];

      mockPrismaService.job.findMany.mockResolvedValue(mockJobs);
      mockPrismaService.job.groupBy.mockResolvedValue([
        { nodeId: 'node-1', _count: 4 }, // 4 failed jobs
      ]);

      const result = await service.getNodePerformance('30d');

      // 1 completed / (1 completed + 4 failed) * 100 = 20%
      expect(result[0].successRate).toBe(20);
    });
  });

  describe('time period filtering', () => {
    it('should accept 24h period', async () => {
      mockPrismaService.job.count.mockResolvedValue(10);
      mockPrismaService.job.aggregate.mockResolvedValue({
        _sum: { savedBytes: BigInt(0) },
        _avg: { savedPercent: 0 },
        _count: { id: 0 },
      });
      mockPrismaService.$queryRaw.mockResolvedValue([{ avg_duration_ms: 0 }]);
      mockPrismaService.job.groupBy.mockResolvedValue([]);
      mockPrismaService.job.findMany.mockResolvedValue([]);

      const result = await service.getSummary('24h');

      expect(result.totalJobsProcessed).toBe(10);
    });

    it('should accept 7d period', async () => {
      mockPrismaService.job.count.mockResolvedValue(10);
      mockPrismaService.job.aggregate.mockResolvedValue({
        _sum: { savedBytes: BigInt(0) },
        _avg: { savedPercent: 0 },
        _count: { id: 0 },
      });
      mockPrismaService.$queryRaw.mockResolvedValue([{ avg_duration_ms: 0 }]);
      mockPrismaService.job.groupBy.mockResolvedValue([]);
      mockPrismaService.job.findMany.mockResolvedValue([]);

      const result = await service.getSummary('7d');

      expect(result.totalJobsProcessed).toBe(10);
    });

    it('should accept 90d period', async () => {
      mockPrismaService.job.count.mockResolvedValue(10);
      mockPrismaService.job.aggregate.mockResolvedValue({
        _sum: { savedBytes: BigInt(0) },
        _avg: { savedPercent: 0 },
        _count: { id: 0 },
      });
      mockPrismaService.$queryRaw.mockResolvedValue([{ avg_duration_ms: 0 }]);
      mockPrismaService.job.groupBy.mockResolvedValue([]);
      mockPrismaService.job.findMany.mockResolvedValue([]);

      const result = await service.getSummary('90d');

      expect(result.totalJobsProcessed).toBe(10);
    });

    it('should accept all period', async () => {
      mockPrismaService.job.count.mockResolvedValue(10);
      mockPrismaService.job.aggregate.mockResolvedValue({
        _sum: { savedBytes: BigInt(0) },
        _avg: { savedPercent: 0 },
        _count: { id: 0 },
      });
      mockPrismaService.$queryRaw.mockResolvedValue([{ avg_duration_ms: 0 }]);
      mockPrismaService.job.groupBy.mockResolvedValue([]);
      mockPrismaService.job.findMany.mockResolvedValue([]);

      const result = await service.getSummary('all');

      expect(result.totalJobsProcessed).toBe(10);
    });
  });
});
