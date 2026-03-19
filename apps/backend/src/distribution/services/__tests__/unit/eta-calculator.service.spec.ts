import { Test, type TestingModule } from '@nestjs/testing';
import type { Job } from '@prisma/client';
import { JobRepository } from '../../../../common/repositories/job.repository';
import { NodeRepository } from '../../../../common/repositories/node.repository';
import { EtaCalculatorService } from '../../eta-calculator.service';

describe('EtaCalculatorService', () => {
  let service: EtaCalculatorService;
  let jobRepo: Record<string, jest.Mock>;
  let nodeRepo: Record<string, jest.Mock>;

  // Shims so existing `prisma.job.X` / `prisma.node.X` references in tests still work
  let prisma: {
    job: Record<string, jest.Mock>;
    node: Record<string, jest.Mock>;
  };

  beforeEach(async () => {
    jobRepo = {
      findCompletedSince: jest.fn(),
      findActiveForNode: jest.fn(),
      findQueuedAndEncodingForNode: jest.fn(),
      updateById: jest.fn(),
    };
    nodeRepo = {
      findWithSelect: jest.fn(),
      updateById: jest.fn(),
    };

    prisma = {
      job: {
        findMany: jobRepo.findCompletedSince,
        update: jobRepo.updateById,
      },
      node: {
        findUnique: nodeRepo.findWithSelect,
        update: nodeRepo.updateById,
      },
    };

    // Keep repo mocks in sync with shims
    jobRepo.findCompletedSince = prisma.job.findMany;
    jobRepo.updateById = prisma.job.update;
    nodeRepo.findWithSelect = prisma.node.findUnique;
    nodeRepo.updateById = prisma.node.update;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EtaCalculatorService,
        { provide: JobRepository, useValue: jobRepo },
        { provide: NodeRepository, useValue: nodeRepo },
      ],
    }).compile();

    service = module.get<EtaCalculatorService>(EtaCalculatorService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.clearCache();
  });

  const createMockJob = (overrides: Partial<Job> = {}): Job =>
    ({
      id: 'job-1',
      filePath: '/media/movie.mkv',
      fileLabel: 'movie.mkv',
      sourceCodec: 'H264',
      targetCodec: 'HEVC',
      stage: 'QUEUED',
      progress: 0,
      etaSeconds: null,
      beforeSizeBytes: BigInt(5 * 1024 * 1024 * 1024), // 5GB
      afterSizeBytes: null,
      savedBytes: null,
      savedPercent: null,
      startedAt: null,
      completedAt: null,
      error: null,
      nodeId: 'node-1',
      libraryId: 'lib-1',
      policyId: 'policy-1',
      estimatedDuration: null,
      estimatedStartAt: null,
      estimatedCompleteAt: null,
      ...overrides,
    }) as unknown as Job;

  describe('estimateDuration', () => {
    it('should use historical data when available', async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const startTime = new Date(thirtyDaysAgo.getTime() + 1000);
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000); // 2 hours later

      prisma.job.findMany.mockResolvedValue([
        {
          sourceCodec: 'H264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(3 * 1024 * 1024 * 1024), // 3GB
          startedAt: startTime,
          completedAt: endTime, // 2 hours = 1.5 GB/h
        },
      ]);

      const job = createMockJob({ beforeSizeBytes: BigInt(6 * 1024 * 1024 * 1024) }); // 6GB
      const result = await service.estimateDuration(job);

      expect(result.confidence).toBe('HIGH');
      expect(result.basedOn).toBe('HISTORICAL');
      // 6GB at 1.5 GB/h = 4 hours = 14400 seconds
      expect(result.estimatedSeconds).toBe(14400);
    });

    it('should fall back to file size estimation when no history', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      const job = createMockJob({
        beforeSizeBytes: BigInt(3 * 1024 * 1024 * 1024), // 3GB
        targetCodec: 'HEVC',
      });
      const result = await service.estimateDuration(job);

      expect(result.confidence).toBe('LOW');
      expect(result.basedOn).toBe('FILE_SIZE');
      // 3GB / 1.5 GB/h * 3600 = 7200 seconds
      expect(result.estimatedSeconds).toBe(7200);
    });

    it('should use correct base rate for AV1 encoding', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      const job = createMockJob({
        beforeSizeBytes: BigInt(1 * 1024 * 1024 * 1024), // 1GB
        targetCodec: 'AV1',
      });
      const result = await service.estimateDuration(job);

      // 1GB / 0.5 GB/h * 3600 = 7200 seconds
      expect(result.estimatedSeconds).toBe(7200);
      expect(result.factors.targetCodec).toBe('AV1');
    });

    it('should use correct base rate for H264 encoding', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      const job = createMockJob({
        beforeSizeBytes: BigInt(3 * 1024 * 1024 * 1024), // 3GB
        targetCodec: 'H264',
      });
      const result = await service.estimateDuration(job);

      // 3GB / 3.0 GB/h * 3600 = 3600 seconds
      expect(result.estimatedSeconds).toBe(3600);
    });

    it('should use default rate for unknown codecs', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      const job = createMockJob({
        beforeSizeBytes: BigInt(1.5 * 1024 * 1024 * 1024),
        targetCodec: 'UNKNOWN_CODEC',
      });
      const result = await service.estimateDuration(job);

      // 1.5GB / 1.5 GB/h * 3600 = 3600 seconds (default rate)
      expect(result.estimatedSeconds).toBe(3600);
    });

    it('should handle null source codec', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      const job = createMockJob({
        sourceCodec: null as any,
        targetCodec: 'HEVC',
        beforeSizeBytes: BigInt(1.5 * 1024 * 1024 * 1024),
      });
      const result = await service.estimateDuration(job);

      expect(result.factors.sourceCodec).toBe('UNKNOWN');
      expect(result.basedOn).toBe('FILE_SIZE');
    });

    it('should handle null target codec', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      const job = createMockJob({
        targetCodec: null as any,
        beforeSizeBytes: BigInt(1.5 * 1024 * 1024 * 1024),
      });
      const result = await service.estimateDuration(job);

      // Default target codec is HEVC
      expect(result.factors.targetCodec).toBe('HEVC');
    });

    it('should cache encoding rates for 1 hour', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      const job = createMockJob();
      await service.estimateDuration(job);
      await service.estimateDuration(job);

      // Only one database query for rates
      expect(prisma.job.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('getEncodingRates (private, tested via estimateDuration)', () => {
    it('should aggregate rates from multiple completed jobs', async () => {
      const startTime = new Date('2026-01-01T00:00:00Z');

      prisma.job.findMany.mockResolvedValue([
        {
          sourceCodec: 'H264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(4 * 1024 * 1024 * 1024), // 4GB
          startedAt: startTime,
          completedAt: new Date(startTime.getTime() + 2 * 60 * 60 * 1000), // 2h => 2 GB/h
        },
        {
          sourceCodec: 'H264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(2 * 1024 * 1024 * 1024), // 2GB
          startedAt: startTime,
          completedAt: new Date(startTime.getTime() + 1 * 60 * 60 * 1000), // 1h => 2 GB/h
        },
      ]);

      const job = createMockJob({
        beforeSizeBytes: BigInt(4 * 1024 * 1024 * 1024), // 4GB
      });
      const result = await service.estimateDuration(job);

      // Aggregated: totalGB=6, totalHours=3, rate=2 GB/h
      // 4GB / 2 GB/h * 3600 = 7200 seconds
      expect(result.confidence).toBe('HIGH');
      expect(result.estimatedSeconds).toBe(7200);
    });

    it('should skip jobs with missing startedAt or completedAt', async () => {
      prisma.job.findMany.mockResolvedValue([
        {
          sourceCodec: 'H264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(2 * 1024 * 1024 * 1024),
          startedAt: null,
          completedAt: new Date(),
        },
        {
          sourceCodec: 'H264',
          targetCodec: 'HEVC',
          beforeSizeBytes: BigInt(2 * 1024 * 1024 * 1024),
          startedAt: new Date(),
          completedAt: null,
        },
      ]);

      const job = createMockJob();
      const result = await service.estimateDuration(job);

      // No valid history => file size fallback
      expect(result.basedOn).toBe('FILE_SIZE');
    });

    it('should handle database errors gracefully', async () => {
      prisma.job.findMany.mockRejectedValue(new Error('DB error'));

      const job = createMockJob({
        beforeSizeBytes: BigInt(1.5 * 1024 * 1024 * 1024),
      });
      const result = await service.estimateDuration(job);

      // Should fall back to file size estimation
      expect(result.basedOn).toBe('FILE_SIZE');
    });
  });

  describe('calculateNodeFreeAt', () => {
    it('should return null for a node with no active jobs', async () => {
      jobRepo.findActiveForNode.mockResolvedValue([]);
      const result = await service.calculateNodeFreeAt('node-1');
      expect(result).toBeNull();
    });

    it('should calculate free time based on active jobs', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-21T12:00:00Z'));

      // Clear rate cache to avoid interference from other tests
      service.clearCache();

      jobRepo.findActiveForNode.mockResolvedValue([
        createMockJob({
          id: 'job-1',
          stage: 'ENCODING' as any,
          etaSeconds: 3600, // 1 hour remaining
        }),
        createMockJob({
          id: 'job-2',
          stage: 'QUEUED' as any,
          estimatedDuration: 7200, // 2 hours
        }),
      ]);
      // encoding rates query
      prisma.job.findMany.mockResolvedValue([]);

      nodeRepo.findWithSelect.mockResolvedValue({ maxWorkers: 1 });

      const result = await service.calculateNodeFreeAt('node-1');
      expect(result).not.toBeNull();

      // Total: 3600 + 7200 = 10800 seconds / 1 worker = 10800 seconds = 3 hours
      const expectedTime = new Date('2026-02-21T15:00:00Z');
      expect(result!.getTime()).toBe(expectedTime.getTime());

      jest.useRealTimers();
    });

    it('should divide by worker count for parallel processing', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-21T12:00:00Z'));
      service.clearCache();

      jobRepo.findActiveForNode.mockResolvedValue([
        createMockJob({ stage: 'QUEUED' as any, estimatedDuration: 7200 }),
        createMockJob({ stage: 'QUEUED' as any, estimatedDuration: 7200 }),
      ]);
      prisma.job.findMany.mockResolvedValue([]);

      nodeRepo.findWithSelect.mockResolvedValue({ maxWorkers: 2 });

      const result = await service.calculateNodeFreeAt('node-1');
      // Total: 14400 / 2 workers = 7200 seconds = 2 hours
      const expectedTime = new Date('2026-02-21T14:00:00Z');
      expect(result!.getTime()).toBe(expectedTime.getTime());

      jest.useRealTimers();
    });

    it('should default to 1 worker if maxWorkers not set', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-21T12:00:00Z'));
      service.clearCache();

      jobRepo.findActiveForNode.mockResolvedValue([
        createMockJob({ stage: 'QUEUED' as any, estimatedDuration: 3600 }),
      ]);
      prisma.job.findMany.mockResolvedValue([]);

      nodeRepo.findWithSelect.mockResolvedValue({ maxWorkers: null });

      const result = await service.calculateNodeFreeAt('node-1');
      // 3600 / 1 = 3600 seconds = 1 hour
      const expectedTime = new Date('2026-02-21T13:00:00Z');
      expect(result!.getTime()).toBe(expectedTime.getTime());

      jest.useRealTimers();
    });
  });

  describe('updateNodeETAs', () => {
    it('should update ETAs for all jobs on a node', async () => {
      jest.useFakeTimers();
      const now = new Date('2026-02-21T12:00:00Z');
      jest.setSystemTime(now);
      service.clearCache();

      const jobs = [
        createMockJob({
          id: 'job-1',
          stage: 'QUEUED' as any,
          estimatedDuration: 3600,
          progress: 0,
        }),
        createMockJob({
          id: 'job-2',
          stage: 'QUEUED' as any,
          estimatedDuration: 7200,
          progress: 0,
        }),
      ];

      jobRepo.findQueuedAndEncodingForNode.mockResolvedValue(jobs);
      nodeRepo.findWithSelect.mockResolvedValue({ maxWorkers: 1 });
      jobRepo.updateById.mockResolvedValue({});
      nodeRepo.updateById.mockResolvedValue({});

      await service.updateNodeETAs('node-1');

      // Should update both jobs
      expect(jobRepo.updateById).toHaveBeenCalledTimes(2);
      // Should update node's estimatedFreeAt
      expect(nodeRepo.updateById).toHaveBeenCalledWith(
        'node-1',
        expect.objectContaining({
          estimatedFreeAt: expect.any(Date),
        })
      );

      jest.useRealTimers();
    });

    it('should account for progress on encoding jobs', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-21T12:00:00Z'));
      service.clearCache();

      const jobs = [
        createMockJob({
          id: 'job-1',
          stage: 'ENCODING' as any,
          estimatedDuration: 10000,
          progress: 50, // 50% done
        }),
      ];

      jobRepo.findQueuedAndEncodingForNode.mockResolvedValue(jobs);
      nodeRepo.findWithSelect.mockResolvedValue({ maxWorkers: 1 });
      jobRepo.updateById.mockResolvedValue({});
      nodeRepo.updateById.mockResolvedValue({});

      await service.updateNodeETAs('node-1');

      // Should update with adjusted duration (50% of 10000 = 5000)
      expect(jobRepo.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          estimatedDuration: 5000,
        })
      );

      jest.useRealTimers();
    });

    it('should handle multiple workers with slot scheduling', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-21T12:00:00Z'));
      service.clearCache();

      const jobs = [
        createMockJob({ id: 'job-1', stage: 'QUEUED' as any, estimatedDuration: 3600 }),
        createMockJob({ id: 'job-2', stage: 'QUEUED' as any, estimatedDuration: 3600 }),
      ];

      jobRepo.findQueuedAndEncodingForNode.mockResolvedValue(jobs);
      nodeRepo.findWithSelect.mockResolvedValue({ maxWorkers: 2 });
      jobRepo.updateById.mockResolvedValue({});
      nodeRepo.updateById.mockResolvedValue({});

      await service.updateNodeETAs('node-1');

      expect(jobRepo.updateById).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe('clearCache', () => {
    it('should reset encoding rates cache', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      const job = createMockJob();
      await service.estimateDuration(job);

      // Should use cache (1 call)
      await service.estimateDuration(job);
      expect(prisma.job.findMany).toHaveBeenCalledTimes(1);

      service.clearCache();

      // Should query DB again
      await service.estimateDuration(job);
      expect(prisma.job.findMany).toHaveBeenCalledTimes(2);
    });
  });
});
