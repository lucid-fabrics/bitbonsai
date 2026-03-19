import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MetricsRepository } from '../../metrics.repository';

const mockMetric = {
  id: 'metric-1',
  date: new Date('2025-01-15'),
  nodeId: 'node-1',
  licenseId: 'license-1',
  jobsCompleted: 10,
  jobsFailed: 1,
  totalSavedBytes: BigInt(1024),
  avgThroughputFilesPerHour: 5.5,
  codecDistribution: { HEVC: 8, AV1: 2 },
  createdAt: new Date('2025-01-15'),
  updatedAt: new Date('2025-01-15'),
};

const mockPrismaMetric = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  count: jest.fn(),
  aggregate: jest.fn(),
};

const mockPrisma = {
  metric: mockPrismaMetric,
};

describe('MetricsRepository', () => {
  let repository: MetricsRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsRepository, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    repository = module.get<MetricsRepository>(MetricsRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeInstanceOf(MetricsRepository);
  });

  describe('findByDateRange', () => {
    const startDate = new Date('2025-01-01');
    const endDate = new Date('2025-01-31');

    it('should return metrics within date range', async () => {
      mockPrismaMetric.findMany.mockResolvedValue([mockMetric]);

      const result = await repository.findByDateRange({ startDate, endDate });

      expect(result).toEqual([mockMetric]);
      expect(mockPrismaMetric.findMany).toHaveBeenCalledWith({
        where: {
          date: { gte: startDate, lte: endDate },
          nodeId: undefined,
          licenseId: undefined,
        },
        orderBy: { date: 'asc' },
      });
    });

    it('should filter by nodeId when provided', async () => {
      mockPrismaMetric.findMany.mockResolvedValue([mockMetric]);

      await repository.findByDateRange({ startDate, endDate, nodeId: 'node-1' });

      expect(mockPrismaMetric.findMany).toHaveBeenCalledWith({
        where: {
          date: { gte: startDate, lte: endDate },
          nodeId: 'node-1',
          licenseId: undefined,
        },
        orderBy: { date: 'asc' },
      });
    });

    it('should filter by licenseId when provided', async () => {
      mockPrismaMetric.findMany.mockResolvedValue([mockMetric]);

      await repository.findByDateRange({ startDate, endDate, licenseId: 'license-1' });

      expect(mockPrismaMetric.findMany).toHaveBeenCalledWith({
        where: {
          date: { gte: startDate, lte: endDate },
          nodeId: undefined,
          licenseId: 'license-1',
        },
        orderBy: { date: 'asc' },
      });
    });

    it('should return empty array when no metrics in range', async () => {
      mockPrismaMetric.findMany.mockResolvedValue([]);

      const result = await repository.findByDateRange({ startDate, endDate });

      expect(result).toEqual([]);
    });
  });

  describe('aggregateByLicense', () => {
    const mockAggResult = {
      _sum: { jobsCompleted: 100, jobsFailed: 5, totalSavedBytes: BigInt(10240) },
      _avg: { avgThroughputFilesPerHour: 7.2 },
    };

    it('should aggregate all metrics when no licenseId provided', async () => {
      mockPrismaMetric.aggregate.mockResolvedValue(mockAggResult);

      const result = await repository.aggregateByLicense();

      expect(result).toEqual(mockAggResult);
      expect(mockPrismaMetric.aggregate).toHaveBeenCalledWith({
        where: {},
        _sum: { jobsCompleted: true, jobsFailed: true, totalSavedBytes: true },
        _avg: { avgThroughputFilesPerHour: true },
      });
    });

    it('should aggregate metrics filtered by licenseId', async () => {
      mockPrismaMetric.aggregate.mockResolvedValue(mockAggResult);

      const result = await repository.aggregateByLicense('license-1');

      expect(result).toEqual(mockAggResult);
      expect(mockPrismaMetric.aggregate).toHaveBeenCalledWith({
        where: { licenseId: 'license-1' },
        _sum: { jobsCompleted: true, jobsFailed: true, totalSavedBytes: true },
        _avg: { avgThroughputFilesPerHour: true },
      });
    });

    it('should return zero sums when no data', async () => {
      const emptyResult = {
        _sum: { jobsCompleted: null, jobsFailed: null, totalSavedBytes: null },
        _avg: { avgThroughputFilesPerHour: null },
      };
      mockPrismaMetric.aggregate.mockResolvedValue(emptyResult);

      const result = await repository.aggregateByLicense();

      expect(result._sum.jobsCompleted).toBeNull();
    });
  });

  describe('findCodecDistributions', () => {
    it('should return codec distribution for all metrics', async () => {
      const distributions = [{ codecDistribution: { HEVC: 5 } }];
      mockPrismaMetric.findMany.mockResolvedValue(distributions);

      const result = await repository.findCodecDistributions();

      expect(result).toEqual(distributions);
      expect(mockPrismaMetric.findMany).toHaveBeenCalledWith({
        where: {},
        select: { codecDistribution: true },
      });
    });

    it('should filter by licenseId when provided', async () => {
      const distributions = [{ codecDistribution: { AV1: 3 } }];
      mockPrismaMetric.findMany.mockResolvedValue(distributions);

      const result = await repository.findCodecDistributions('license-1');

      expect(result).toEqual(distributions);
      expect(mockPrismaMetric.findMany).toHaveBeenCalledWith({
        where: { licenseId: 'license-1' },
        select: { codecDistribution: true },
      });
    });

    it('should return empty array when no metrics', async () => {
      mockPrismaMetric.findMany.mockResolvedValue([]);

      const result = await repository.findCodecDistributions();

      expect(result).toEqual([]);
    });
  });

  describe('findByDateRangeOrdered', () => {
    const startDate = new Date('2025-01-01');
    const endDate = new Date('2025-01-31');

    it('should return metrics ordered by date without licenseId', async () => {
      mockPrismaMetric.findMany.mockResolvedValue([mockMetric]);

      const result = await repository.findByDateRangeOrdered({ startDate, endDate });

      expect(result).toEqual([mockMetric]);
      expect(mockPrismaMetric.findMany).toHaveBeenCalledWith({
        where: {
          date: { gte: startDate, lte: endDate },
        },
        orderBy: { date: 'asc' },
      });
    });

    it('should include licenseId filter when provided', async () => {
      mockPrismaMetric.findMany.mockResolvedValue([mockMetric]);

      await repository.findByDateRangeOrdered({ startDate, endDate, licenseId: 'license-1' });

      expect(mockPrismaMetric.findMany).toHaveBeenCalledWith({
        where: {
          date: { gte: startDate, lte: endDate },
          licenseId: 'license-1',
        },
        orderBy: { date: 'asc' },
      });
    });

    it('should NOT include licenseId in where when not provided', async () => {
      mockPrismaMetric.findMany.mockResolvedValue([]);

      await repository.findByDateRangeOrdered({ startDate, endDate });

      const callArgs = mockPrismaMetric.findMany.mock.calls[0][0];
      expect(callArgs.where).not.toHaveProperty('licenseId');
    });

    it('should return empty array when no metrics', async () => {
      mockPrismaMetric.findMany.mockResolvedValue([]);

      const result = await repository.findByDateRangeOrdered({ startDate, endDate });

      expect(result).toEqual([]);
    });
  });
});
