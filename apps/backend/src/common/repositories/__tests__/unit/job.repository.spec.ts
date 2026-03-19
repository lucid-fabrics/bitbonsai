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
});
