import { Test, type TestingModule } from '@nestjs/testing';
import { type JobStage } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { JobRepository } from '../../job.repository';

const mockJob = {
  id: 'job-1',
  fileLabel: 'movie.mkv',
  filePath: '/mnt/movies/movie.mkv',
  libraryId: 'lib-1',
  nodeId: 'node-1',
  stage: 'QUEUED' as JobStage,
  progress: 0,
  priority: 0,
  beforeSizeBytes: BigInt(1000000),
  afterSizeBytes: null,
  savedBytes: null,
  savedPercent: null,
  sourceCodec: 'h264',
  targetCodec: 'hevc',
  startedAt: null,
  completedAt: null,
  failedAt: null,
  error: null,
  pauseRequestedAt: null,
  pauseProcessedAt: null,
  cancelRequestedAt: null,
  cancelProcessedAt: null,
  stuckRecoveryCount: 0,
  lastProgressUpdate: null,
  stickyUntil: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockPrismaJob = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  delete: jest.fn(),
  deleteMany: jest.fn(),
  count: jest.fn(),
  aggregate: jest.fn(),
  groupBy: jest.fn(),
};

const mockPrisma = {
  job: mockPrismaJob,
};

describe('JobRepository', () => {
  let repository: JobRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [JobRepository, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    repository = module.get<JobRepository>(JobRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeInstanceOf(JobRepository);
  });

  describe('findById', () => {
    it('should return job when found', async () => {
      mockPrismaJob.findUnique.mockResolvedValue(mockJob);

      const result = await repository.findById('job-1');

      expect(result).toEqual(mockJob);
      expect(mockPrismaJob.findUnique).toHaveBeenCalledWith({ where: { id: 'job-1' } });
    });

    it('should return null when not found', async () => {
      mockPrismaJob.findUnique.mockResolvedValue(null);

      const result = await repository.findById('ghost');

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithLibrary', () => {
    it('should return job with library nodeId', async () => {
      const withLibrary = { ...mockJob, library: { nodeId: 'node-1' } };
      mockPrismaJob.findUnique.mockResolvedValue(withLibrary);

      const result = await repository.findByIdWithLibrary('job-1');

      expect(result).toEqual(withLibrary);
      expect(mockPrismaJob.findUnique).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        include: { library: { select: { nodeId: true } } },
      });
    });

    it('should return null when not found', async () => {
      mockPrismaJob.findUnique.mockResolvedValue(null);

      const result = await repository.findByIdWithLibrary('ghost');

      expect(result).toBeNull();
    });
  });

  describe('findByStage', () => {
    it('should return jobs matching stage', async () => {
      mockPrismaJob.findMany.mockResolvedValue([mockJob]);

      const result = await repository.findByStage('QUEUED');

      expect(result).toEqual([mockJob]);
      expect(mockPrismaJob.findMany).toHaveBeenCalledWith({ where: { stage: 'QUEUED' } });
    });

    it('should return empty array when no jobs in stage', async () => {
      mockPrismaJob.findMany.mockResolvedValue([]);

      const result = await repository.findByStage('ENCODING');

      expect(result).toEqual([]);
    });
  });

  describe('findQueued', () => {
    it('should return queued jobs with default limit', async () => {
      mockPrismaJob.findMany.mockResolvedValue([mockJob]);

      const result = await repository.findQueued();

      expect(result).toEqual([mockJob]);
      expect(mockPrismaJob.findMany).toHaveBeenCalledWith({
        where: { stage: 'QUEUED' },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });
    });

    it('should use provided limit', async () => {
      mockPrismaJob.findMany.mockResolvedValue([]);

      await repository.findQueued(5);

      expect(mockPrismaJob.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
    });
  });

  describe('findActiveForNode', () => {
    it('should return active jobs for a node with default stages', async () => {
      mockPrismaJob.findMany.mockResolvedValue([mockJob]);

      const result = await repository.findActiveForNode('node-1');

      expect(result).toEqual([mockJob]);
      expect(mockPrismaJob.findMany).toHaveBeenCalledWith({
        where: { nodeId: 'node-1', stage: { in: ['ENCODING', 'QUEUED', 'VERIFYING'] } },
        orderBy: { priority: 'desc' },
      });
    });

    it('should use provided stages', async () => {
      mockPrismaJob.findMany.mockResolvedValue([mockJob]);

      await repository.findActiveForNode('node-1', ['ENCODING']);

      expect(mockPrismaJob.findMany).toHaveBeenCalledWith({
        where: { nodeId: 'node-1', stage: { in: ['ENCODING'] } },
        orderBy: { priority: 'desc' },
      });
    });
  });

  describe('findQueuedExcludingNode', () => {
    it('should return queued jobs excluding a node', async () => {
      mockPrismaJob.findMany.mockResolvedValue([{ ...mockJob, nodeId: 'node-2' }]);

      const result = await repository.findQueuedExcludingNode('node-1', 10);

      expect(result).toHaveLength(1);
      expect(mockPrismaJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            stage: 'QUEUED',
            nodeId: { not: 'node-1' },
          }),
          take: 10,
        })
      );
    });
  });

  describe('countByStage', () => {
    it('should return counts keyed by stage', async () => {
      mockPrismaJob.groupBy.mockResolvedValue([
        { stage: 'QUEUED', _count: 5 },
        { stage: 'ENCODING', _count: 2 },
      ]);

      const result = await repository.countByStage();

      expect(result).toEqual({ QUEUED: 5, ENCODING: 2 });
    });

    it('should return empty object when no jobs', async () => {
      mockPrismaJob.groupBy.mockResolvedValue([]);

      const result = await repository.countByStage();

      expect(result).toEqual({});
    });
  });

  describe('countForNode', () => {
    it('should return count for node and stage', async () => {
      mockPrismaJob.count.mockResolvedValue(3);

      const result = await repository.countForNode('node-1', 'ENCODING');

      expect(result).toBe(3);
      expect(mockPrismaJob.count).toHaveBeenCalledWith({
        where: { nodeId: 'node-1', stage: 'ENCODING' },
      });
    });
  });

  describe('countForNodeStages', () => {
    it('should return count for node across multiple stages', async () => {
      mockPrismaJob.count.mockResolvedValue(7);

      const result = await repository.countForNodeStages('node-1', ['QUEUED', 'ENCODING']);

      expect(result).toBe(7);
      expect(mockPrismaJob.count).toHaveBeenCalledWith({
        where: { nodeId: 'node-1', stage: { in: ['QUEUED', 'ENCODING'] } },
      });
    });
  });

  describe('atomicUpdateMany', () => {
    it('should update many jobs matching where', async () => {
      mockPrismaJob.updateMany.mockResolvedValue({ count: 3 });

      const result = await repository.atomicUpdateMany(
        { nodeId: 'node-1', stage: 'ENCODING' },
        { stage: 'QUEUED' }
      );

      expect(result).toEqual({ count: 3 });
      expect(mockPrismaJob.updateMany).toHaveBeenCalledWith({
        where: { nodeId: 'node-1', stage: 'ENCODING' },
        data: { stage: 'QUEUED' },
      });
    });
  });

  describe('updateById', () => {
    it('should update job by id', async () => {
      const updated = { ...mockJob, progress: 50 };
      mockPrismaJob.update.mockResolvedValue(updated);

      const result = await repository.updateById('job-1', { progress: 50 });

      expect(result).toEqual(updated);
      expect(mockPrismaJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { progress: 50 },
      });
    });

    it('should propagate errors when job not found', async () => {
      mockPrismaJob.update.mockRejectedValue(new Error('Record not found'));

      await expect(repository.updateById('ghost', { progress: 50 })).rejects.toThrow(
        'Record not found'
      );
    });
  });

  describe('updateProgress', () => {
    it('should update job progress', async () => {
      const updated = { ...mockJob, progress: 75 };
      mockPrismaJob.update.mockResolvedValue(updated);

      const result = await repository.updateProgress('job-1', 75);

      expect(result).toEqual(updated);
      expect(mockPrismaJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { progress: 75 },
      });
    });
  });

  describe('markCompleted', () => {
    it('should mark job as completed with afterSizeBytes', async () => {
      const completed = { ...mockJob, stage: 'COMPLETED' as JobStage, progress: 100 };
      mockPrismaJob.update.mockResolvedValue(completed);

      const result = await repository.markCompleted('job-1', BigInt(800000));

      expect(result).toEqual(completed);
      expect(mockPrismaJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          stage: 'COMPLETED',
          progress: 100,
          afterSizeBytes: BigInt(800000),
          completedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('createJob', () => {
    it('should create a job', async () => {
      mockPrismaJob.create.mockResolvedValue(mockJob);

      const createData = {
        fileLabel: 'movie.mkv',
        filePath: '/mnt/movies/movie.mkv',
        libraryId: 'lib-1',
        nodeId: 'node-1',
      } as Parameters<typeof repository.createJob>[0];
      const result = await repository.createJob(createData);

      expect(result).toEqual(mockJob);
      expect(mockPrismaJob.create).toHaveBeenCalledWith({ data: createData });
    });
  });

  describe('deleteById', () => {
    it('should delete job by id', async () => {
      mockPrismaJob.delete.mockResolvedValue(mockJob);

      const result = await repository.deleteById('job-1');

      expect(result).toEqual(mockJob);
      expect(mockPrismaJob.delete).toHaveBeenCalledWith({ where: { id: 'job-1' } });
    });

    it('should propagate errors when not found', async () => {
      mockPrismaJob.delete.mockRejectedValue(new Error('Record not found'));

      await expect(repository.deleteById('ghost')).rejects.toThrow('Record not found');
    });
  });

  describe('deleteManyWhere', () => {
    it('should delete many jobs matching where', async () => {
      mockPrismaJob.deleteMany.mockResolvedValue({ count: 5 });

      const result = await repository.deleteManyWhere({ libraryId: 'lib-1' });

      expect(result).toEqual({ count: 5 });
      expect(mockPrismaJob.deleteMany).toHaveBeenCalledWith({ where: { libraryId: 'lib-1' } });
    });
  });

  describe('findStatusFields', () => {
    it('should return status fields for a job', async () => {
      const statusFields = {
        pauseRequestedAt: null,
        pauseProcessedAt: null,
        cancelRequestedAt: null,
        cancelProcessedAt: null,
      };
      mockPrismaJob.findUnique.mockResolvedValue(statusFields);

      const result = await repository.findStatusFields('job-1');

      expect(result).toEqual(statusFields);
      expect(mockPrismaJob.findUnique).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        select: {
          pauseRequestedAt: true,
          pauseProcessedAt: true,
          cancelRequestedAt: true,
          cancelProcessedAt: true,
        },
      });
    });

    it('should return null when job not found', async () => {
      mockPrismaJob.findUnique.mockResolvedValue(null);

      const result = await repository.findStatusFields('ghost');

      expect(result).toBeNull();
    });
  });

  describe('findManyCount', () => {
    it('should return jobs and total count in parallel', async () => {
      mockPrismaJob.findMany.mockResolvedValue([mockJob]);
      mockPrismaJob.count.mockResolvedValue(1);

      const [jobs, count] = await repository.findManyCount({ where: { nodeId: 'node-1' } });

      expect(jobs).toEqual([mockJob]);
      expect(count).toBe(1);
      expect(mockPrismaJob.findMany).toHaveBeenCalled();
      expect(mockPrismaJob.count).toHaveBeenCalledWith({ where: { nodeId: 'node-1' } });
    });
  });

  describe('groupByStageCount', () => {
    it('should return stage counts for a where clause', async () => {
      mockPrismaJob.groupBy.mockResolvedValue([
        { stage: 'QUEUED', _count: 4 },
        { stage: 'COMPLETED', _count: 10 },
      ]);

      const result = await repository.groupByStageCount({ nodeId: 'node-1' });

      expect(result).toEqual([
        { stage: 'QUEUED', _count: 4 },
        { stage: 'COMPLETED', _count: 10 },
      ]);
    });

    it('should return empty array when no jobs match', async () => {
      mockPrismaJob.groupBy.mockResolvedValue([]);

      const result = await repository.groupByStageCount({ nodeId: 'ghost' });

      expect(result).toEqual([]);
    });
  });

  describe('aggregateWithAvgCount', () => {
    it('should return sum and avg aggregates', async () => {
      const aggResult = {
        _sum: { savedBytes: BigInt(500000) },
        _avg: { savedPercent: 45.5 },
      };
      mockPrismaJob.aggregate.mockResolvedValue(aggResult);

      const result = await repository.aggregateWithAvgCount({ nodeId: 'node-1' });

      expect(result).toEqual(aggResult);
      expect(mockPrismaJob.aggregate).toHaveBeenCalledWith({
        where: { nodeId: 'node-1' },
        _sum: { savedBytes: true },
        _avg: { savedPercent: true },
      });
    });
  });

  describe('updateManyByIds', () => {
    it('should update many jobs by ids', async () => {
      mockPrismaJob.updateMany.mockResolvedValue({ count: 2 });

      const result = await repository.updateManyByIds(['job-1', 'job-2'], { stage: 'QUEUED' });

      expect(result).toEqual({ count: 2 });
      expect(mockPrismaJob.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['job-1', 'job-2'] } },
        data: { stage: 'QUEUED' },
      });
    });
  });

  describe('findCompletedSince', () => {
    it('should return completed jobs since given date', async () => {
      const since = new Date('2025-01-01');
      mockPrismaJob.findMany.mockResolvedValue([mockJob]);

      const result = await repository.findCompletedSince(since);

      expect(result).toEqual([mockJob]);
      expect(mockPrismaJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            stage: 'COMPLETED',
            completedAt: { gte: since },
          }),
        })
      );
    });
  });

  describe('findByLibraryId', () => {
    it('should return jobs for a library', async () => {
      mockPrismaJob.findMany.mockResolvedValue([mockJob]);
      const result = await repository.findByLibraryId('lib-1');
      expect(result).toEqual([mockJob]);
      expect(mockPrismaJob.findMany).toHaveBeenCalledWith({ where: { libraryId: 'lib-1' } });
    });
  });

  describe('findQueuedAndEncodingForNode', () => {
    it('should return queued and encoding jobs for node', async () => {
      mockPrismaJob.findMany.mockResolvedValue([mockJob]);
      const result = await repository.findQueuedAndEncodingForNode('node-1');
      expect(result).toEqual([mockJob]);
      expect(mockPrismaJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { nodeId: 'node-1', stage: { in: ['QUEUED', 'ENCODING'] } },
        })
      );
    });
  });

  describe('findEligibleForRebalance', () => {
    it('should return eligible queued jobs with library include', async () => {
      const jobWithLib = { ...mockJob, library: { nodeId: 'node-1' } };
      mockPrismaJob.findMany.mockResolvedValue([jobWithLib]);
      const result = await repository.findEligibleForRebalance(500);
      expect(result).toEqual([jobWithLib]);
      expect(mockPrismaJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ stage: 'QUEUED' }),
          include: { library: { select: { nodeId: true } } },
          take: 500,
        })
      );
    });

    it('uses default limit of 500', async () => {
      mockPrismaJob.findMany.mockResolvedValue([]);
      await repository.findEligibleForRebalance();
      expect(mockPrismaJob.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
    });
  });

  describe('countCompletedForNodeSince', () => {
    it('should return count of completed jobs for node since date', async () => {
      mockPrismaJob.count.mockResolvedValue(10);
      const since = new Date('2025-01-01');
      const result = await repository.countCompletedForNodeSince('node-1', since);
      expect(result).toBe(10);
      expect(mockPrismaJob.count).toHaveBeenCalledWith({
        where: { nodeId: 'node-1', stage: 'COMPLETED', completedAt: { gte: since } },
      });
    });
  });

  describe('countLargeFilesForNode', () => {
    it('should count large queued/encoding files for node', async () => {
      mockPrismaJob.count.mockResolvedValue(3);
      const result = await repository.countLargeFilesForNode('node-1', BigInt(1_000_000_000));
      expect(result).toBe(3);
      expect(mockPrismaJob.count).toHaveBeenCalledWith({
        where: {
          nodeId: 'node-1',
          stage: { in: ['QUEUED', 'ENCODING'] },
          beforeSizeBytes: { gt: BigInt(1_000_000_000) },
        },
      });
    });
  });

  describe('countByLibraryAndNode', () => {
    it('should count queued/encoding jobs for node and library', async () => {
      mockPrismaJob.count.mockResolvedValue(7);
      const result = await repository.countByLibraryAndNode('node-1', 'lib-1');
      expect(result).toBe(7);
      expect(mockPrismaJob.count).toHaveBeenCalledWith({
        where: {
          nodeId: 'node-1',
          libraryId: 'lib-1',
          stage: { in: ['QUEUED', 'ENCODING'] },
        },
      });
    });
  });

  describe('findFirstWhere', () => {
    it('should return first job matching where', async () => {
      mockPrismaJob.findFirst.mockResolvedValue(mockJob);
      const result = await repository.findFirstWhere({ stage: 'QUEUED' });
      expect(result).toEqual(mockJob);
      expect(mockPrismaJob.findFirst).toHaveBeenCalledWith({ where: { stage: 'QUEUED' } });
    });

    it('should return null when no match', async () => {
      mockPrismaJob.findFirst.mockResolvedValue(null);
      const result = await repository.findFirstWhere({ stage: 'FAILED' });
      expect(result).toBeNull();
    });
  });

  describe('findFirstSelect', () => {
    it('should return projected fields', async () => {
      const projected = { id: 'job-1', stage: 'QUEUED' };
      mockPrismaJob.findFirst.mockResolvedValue(projected);
      const result = await repository.findFirstSelect(
        { nodeId: 'node-1' },
        { id: true, stage: true }
      );
      expect(result).toEqual(projected);
      expect(mockPrismaJob.findFirst).toHaveBeenCalledWith({
        where: { nodeId: 'node-1' },
        select: { id: true, stage: true },
      });
    });
  });

  describe('findUniqueSelect', () => {
    it('should return unique job with selected fields', async () => {
      const projected = { id: 'job-1', progress: 50 };
      mockPrismaJob.findUnique.mockResolvedValue(projected);
      const result = await repository.findUniqueSelect(
        { id: 'job-1' },
        { id: true, progress: true }
      );
      expect(result).toEqual(projected);
    });

    it('should return null when not found', async () => {
      mockPrismaJob.findUnique.mockResolvedValue(null);
      const result = await repository.findUniqueSelect({ id: 'ghost' }, { id: true });
      expect(result).toBeNull();
    });
  });

  describe('findUniqueWithInclude', () => {
    it('should return job with include', async () => {
      const jobWithLib = { ...mockJob, library: { nodeId: 'node-1' } };
      mockPrismaJob.findUnique.mockResolvedValue(jobWithLib);
      const result = await repository.findUniqueWithInclude('job-1', { library: true });
      expect(result).toEqual(jobWithLib);
      expect(mockPrismaJob.findUnique).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        include: { library: true },
      });
    });
  });

  describe('findManyWithInclude', () => {
    it('should return jobs with provided args', async () => {
      mockPrismaJob.findMany.mockResolvedValue([mockJob]);
      const result = await repository.findManyWithInclude({ where: { nodeId: 'node-1' } });
      expect(result).toEqual([mockJob]);
      expect(mockPrismaJob.findMany).toHaveBeenCalledWith({ where: { nodeId: 'node-1' } });
    });
  });

  describe('countWhere', () => {
    it('should count jobs matching where', async () => {
      mockPrismaJob.count.mockResolvedValue(42);
      const result = await repository.countWhere({ stage: 'COMPLETED' });
      expect(result).toBe(42);
      expect(mockPrismaJob.count).toHaveBeenCalledWith({ where: { stage: 'COMPLETED' } });
    });
  });

  describe('aggregateSumWhere', () => {
    it('should return sum aggregate', async () => {
      const aggResult = { _sum: { savedBytes: BigInt(5_000_000) } };
      mockPrismaJob.aggregate.mockResolvedValue(aggResult);
      const result = await repository.aggregateSumWhere({ nodeId: 'node-1' }, { savedBytes: true });
      expect(result).toEqual(aggResult);
      expect(mockPrismaJob.aggregate).toHaveBeenCalledWith({
        where: { nodeId: 'node-1' },
        _sum: { savedBytes: true },
      });
    });
  });

  describe('updateRaw', () => {
    it('should update job by id with raw data', async () => {
      const updated = { ...mockJob, progress: 99 };
      mockPrismaJob.update.mockResolvedValue(updated);
      const result = await repository.updateRaw('job-1', { progress: 99 });
      expect(result).toEqual(updated);
      expect(mockPrismaJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { progress: 99 },
      });
    });
  });

  describe('findManySelect', () => {
    it('should return jobs with selected fields', async () => {
      const projected = [{ id: 'job-1', stage: 'ENCODING' }];
      mockPrismaJob.findMany.mockResolvedValue(projected);
      const result = await repository.findManySelect(
        { stage: 'ENCODING' },
        { id: true, stage: true }
      );
      expect(result).toEqual(projected);
      expect(mockPrismaJob.findMany).toHaveBeenCalledWith({
        where: { stage: 'ENCODING' },
        select: { id: true, stage: true },
      });
    });
  });

  describe('updateByIdWithInclude', () => {
    it('should update job and return with include', async () => {
      const updatedWithLib = { ...mockJob, stage: 'COMPLETED', library: { nodeId: 'node-1' } };
      mockPrismaJob.update.mockResolvedValue(updatedWithLib);
      const result = await repository.updateByIdWithInclude(
        'job-1',
        { stage: 'COMPLETED' },
        { library: true }
      );
      expect(result).toEqual(updatedWithLib);
      expect(mockPrismaJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { stage: 'COMPLETED' },
        include: { library: true },
      });
    });
  });

  describe('updateManyWhere', () => {
    it('should update many jobs matching where', async () => {
      mockPrismaJob.updateMany.mockResolvedValue({ count: 5 });
      const result = await repository.updateManyWhere({ stage: 'ENCODING' }, { stage: 'FAILED' });
      expect(result).toEqual({ count: 5 });
      expect(mockPrismaJob.updateMany).toHaveBeenCalledWith({
        where: { stage: 'ENCODING' },
        data: { stage: 'FAILED' },
      });
    });
  });

  describe('groupByNodeIdCount', () => {
    it('should return job counts grouped by nodeId', async () => {
      mockPrismaJob.groupBy.mockResolvedValue([
        { nodeId: 'node-1', _count: { id: 5 } },
        { nodeId: 'node-2', _count: { id: 3 } },
      ]);
      const result = await repository.groupByNodeIdCount({ stage: 'QUEUED' });
      expect(result).toEqual([
        { nodeId: 'node-1', _count: 5 },
        { nodeId: 'node-2', _count: 3 },
      ]);
    });
  });

  describe('groupByNodeIdSum', () => {
    it('should return sum grouped by nodeId', async () => {
      mockPrismaJob.groupBy.mockResolvedValue([
        { nodeId: 'node-1', _count: { id: 3 }, _sum: { savedBytes: BigInt(1000) } },
      ]);
      const result = await repository.groupByNodeIdSum(
        { stage: 'COMPLETED' },
        { savedBytes: true }
      );
      expect(result[0].nodeId).toBe('node-1');
      expect(result[0]._sum.savedBytes).toBe(BigInt(1000));
    });
  });

  describe('groupByLibraryIdCount', () => {
    it('should return job counts grouped by libraryId', async () => {
      mockPrismaJob.groupBy.mockResolvedValue([{ libraryId: 'lib-1', _count: { id: 8 } }]);
      const result = await repository.groupByLibraryIdCount({ nodeId: 'node-1' });
      expect(result).toEqual([{ libraryId: 'lib-1', _count: { id: 8 } }]);
    });
  });

  describe('groupByLibraryIdSum', () => {
    it('should return sum grouped by libraryId', async () => {
      mockPrismaJob.groupBy.mockResolvedValue([
        { libraryId: 'lib-1', _sum: { savedBytes: BigInt(500_000) } },
      ]);
      const result = await repository.groupByLibraryIdSum(
        { stage: 'COMPLETED' },
        { savedBytes: true }
      );
      expect(result[0].libraryId).toBe('lib-1');
      expect(result[0]._sum.savedBytes).toBe(BigInt(500_000));
    });
  });

  describe('groupByTargetCodecAvg', () => {
    it('should return avg savedPercent grouped by targetCodec', async () => {
      mockPrismaJob.groupBy.mockResolvedValue([
        { targetCodec: 'hevc', _avg: { savedPercent: 35.5 }, _count: 10 },
      ]);
      const result = await repository.groupByTargetCodecAvg({ stage: 'COMPLETED' });
      expect(result[0].targetCodec).toBe('hevc');
      expect(result[0]._avg.savedPercent).toBe(35.5);
      expect(result[0]._count).toBe(10);
    });
  });

  describe('aggregateCount', () => {
    it('should return count aggregate', async () => {
      mockPrismaJob.aggregate.mockResolvedValue({ _count: { id: 42 } });
      const result = await repository.aggregateCount({ nodeId: 'node-1' });
      expect(result).toEqual({ _count: { id: 42 } });
      expect(mockPrismaJob.aggregate).toHaveBeenCalledWith({
        where: { nodeId: 'node-1' },
        _count: { id: true },
      });
    });
  });

  describe('findManyForNode', () => {
    it('should return projected jobs ordered by completedAt desc', async () => {
      const projected = [{ id: 'job-1', stage: 'COMPLETED' }];
      mockPrismaJob.findMany.mockResolvedValue(projected);
      const result = await repository.findManyForNode(
        { nodeId: 'node-1', stage: 'COMPLETED' },
        { id: true, stage: true },
        20
      );
      expect(result).toEqual(projected);
      expect(mockPrismaJob.findMany).toHaveBeenCalledWith({
        where: { nodeId: 'node-1', stage: 'COMPLETED' },
        select: { id: true, stage: true },
        take: 20,
        orderBy: { completedAt: 'desc' },
      });
    });
  });
});
