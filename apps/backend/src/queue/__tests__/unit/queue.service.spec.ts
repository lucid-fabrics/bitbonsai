import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  JobStage,
  LicenseStatus,
  LicenseTier,
  MediaType,
  NodeRole,
  NodeStatus,
  PolicyPreset,
  TargetCodec,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../../queue.service';

describe('QueueService', () => {
  let service: QueueService;
  let prisma: PrismaService;

  const mockLicense = {
    id: 'license-1',
    key: 'test-license-key',
    tier: LicenseTier.PATREON,
    status: LicenseStatus.ACTIVE,
    email: 'test@example.com',
    maxNodes: 3,
    maxConcurrentJobs: 5,
    features: { multiNode: true, advancedPresets: true, api: true },
    validUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockNode = {
    id: 'node-1',
    name: 'Main Server',
    status: NodeStatus.ONLINE,
    role: NodeRole.MAIN,
    licenseId: 'license-1',
    license: mockLicense,
    _count: {
      jobs: 0,
    },
  };

  const mockLibrary = {
    id: 'lib-1',
    name: 'Movie Collection',
    path: '/mnt/user/media/Movies',
    mediaType: MediaType.MOVIE,
    enabled: true,
    nodeId: 'node-1',
  };

  const mockPolicy = {
    id: 'policy-1',
    name: 'Balanced HEVC',
    preset: PolicyPreset.BALANCED_HEVC,
    targetCodec: TargetCodec.HEVC,
    targetQuality: 23,
    deviceProfiles: {},
    advancedSettings: {},
  };

  const mockJob = {
    id: 'job-1',
    filePath: '/mnt/user/media/Movies/Avatar.mkv',
    fileLabel: 'Avatar (2009).mkv',
    sourceCodec: 'H.264',
    targetCodec: 'HEVC',
    stage: JobStage.QUEUED,
    progress: 0,
    etaSeconds: null,
    beforeSizeBytes: BigInt(10737418240),
    afterSizeBytes: null,
    savedBytes: null,
    savedPercent: null,
    startedAt: null,
    completedAt: null,
    error: null,
    nodeId: 'node-1',
    libraryId: 'lib-1',
    policyId: 'policy-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockJobWithRelations = {
    ...mockJob,
    node: mockNode,
    library: mockLibrary,
    policy: mockPolicy,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: PrismaService,
          useValue: {
            node: {
              findUnique: jest.fn(),
            },
            library: {
              findUnique: jest.fn(),
            },
            policy: {
              findUnique: jest.fn(),
            },
            job: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
              aggregate: jest.fn(),
            },
            metric: {
              upsert: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createDto = {
      filePath: '/mnt/user/media/Movies/Avatar.mkv',
      fileLabel: 'Avatar (2009).mkv',
      sourceCodec: 'H.264',
      targetCodec: 'HEVC',
      beforeSizeBytes: '10737418240',
      nodeId: 'node-1',
      libraryId: 'lib-1',
      policyId: 'policy-1',
    };

    it('should create a job successfully', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibrary as never);
      jest.spyOn(prisma.policy, 'findUnique').mockResolvedValue(mockPolicy as never);
      jest.spyOn(prisma.job, 'create').mockResolvedValue(mockJob as never);

      const result = await service.create(createDto);

      expect(result).toEqual(mockJob);
      expect(prisma.job.create).toHaveBeenCalledWith({
        data: {
          filePath: createDto.filePath,
          fileLabel: createDto.fileLabel,
          sourceCodec: createDto.sourceCodec,
          targetCodec: createDto.targetCodec,
          beforeSizeBytes: BigInt(createDto.beforeSizeBytes),
          stage: JobStage.QUEUED,
          nodeId: createDto.nodeId,
          libraryId: createDto.libraryId,
          policyId: createDto.policyId,
        },
      });
    });

    it('should throw NotFoundException if node does not exist', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(NotFoundException);
      await expect(service.create(createDto)).rejects.toThrow('Node with ID "node-1" not found');
    });

    it('should throw NotFoundException if library does not exist', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(NotFoundException);
      await expect(service.create(createDto)).rejects.toThrow('Library with ID "lib-1" not found');
    });

    it('should throw NotFoundException if policy does not exist', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibrary as never);
      jest.spyOn(prisma.policy, 'findUnique').mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(NotFoundException);
      await expect(service.create(createDto)).rejects.toThrow(
        'Policy with ID "policy-1" not found'
      );
    });
  });

  describe('findAll', () => {
    it('should return all jobs without filters', async () => {
      const mockJobs = [mockJobWithRelations];
      jest.spyOn(prisma.job, 'findMany').mockResolvedValue(mockJobs as never);

      const result = await service.findAll();

      expect(result).toEqual(mockJobs);
      expect(prisma.job.findMany).toHaveBeenCalledWith({
        where: {},
        include: expect.any(Object),
        orderBy: {
          createdAt: 'asc',
        },
      });
    });

    it('should filter jobs by stage', async () => {
      const mockJobs = [mockJobWithRelations];
      jest.spyOn(prisma.job, 'findMany').mockResolvedValue(mockJobs as never);

      const result = await service.findAll(JobStage.QUEUED);

      expect(result).toEqual(mockJobs);
      expect(prisma.job.findMany).toHaveBeenCalledWith({
        where: { stage: JobStage.QUEUED },
        include: expect.any(Object),
        orderBy: {
          createdAt: 'asc',
        },
      });
    });

    it('should filter jobs by node ID', async () => {
      const mockJobs = [mockJobWithRelations];
      jest.spyOn(prisma.job, 'findMany').mockResolvedValue(mockJobs as never);

      const result = await service.findAll(undefined, 'node-1');

      expect(result).toEqual(mockJobs);
      expect(prisma.job.findMany).toHaveBeenCalledWith({
        where: { nodeId: 'node-1' },
        include: expect.any(Object),
        orderBy: {
          createdAt: 'asc',
        },
      });
    });
  });

  describe('findOne', () => {
    it('should return a single job with full details', async () => {
      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(mockJobWithRelations as never);

      const result = await service.findOne('job-1');

      expect(result).toEqual(mockJobWithRelations);
      expect(prisma.job.findUnique).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        include: expect.any(Object),
      });
    });

    it('should throw NotFoundException if job does not exist', async () => {
      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('non-existent')).rejects.toThrow(
        'Job with ID "non-existent" not found'
      );
    });
  });

  describe('getNextJob', () => {
    it('should return next queued job and update to ENCODING stage', async () => {
      const nodeWithCapacity = {
        ...mockNode,
        _count: { jobs: 2 }, // Below max of 5
      };
      const updatedJob = {
        ...mockJobWithRelations,
        stage: JobStage.ENCODING,
        startedAt: new Date(),
      };

      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(nodeWithCapacity as never);
      jest.spyOn(prisma.job, 'findFirst').mockResolvedValue(mockJobWithRelations as never);
      jest.spyOn(prisma.job, 'update').mockResolvedValue(updatedJob as never);

      const result = await service.getNextJob('node-1');

      expect(result).toBeTruthy();
      expect(result?.stage).toBe(JobStage.ENCODING);
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          stage: JobStage.ENCODING,
          startedAt: expect.any(Date),
        },
        include: expect.any(Object),
      });
    });

    it('should return null if node is at capacity', async () => {
      const nodeAtCapacity = {
        ...mockNode,
        _count: { jobs: 5 }, // At max of 5
      };

      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(nodeAtCapacity as never);

      const result = await service.getNextJob('node-1');

      expect(result).toBeNull();
      expect(prisma.job.findFirst).not.toHaveBeenCalled();
    });

    it('should return null if no queued jobs available', async () => {
      const nodeWithCapacity = {
        ...mockNode,
        _count: { jobs: 0 },
      };

      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(nodeWithCapacity as never);
      jest.spyOn(prisma.job, 'findFirst').mockResolvedValue(null);

      const result = await service.getNextJob('node-1');

      expect(result).toBeNull();
    });

    it('should throw NotFoundException if node does not exist', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(null);

      await expect(service.getNextJob('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.getNextJob('non-existent')).rejects.toThrow(
        'Node with ID "non-existent" not found'
      );
    });
  });

  describe('updateProgress', () => {
    const updateDto = {
      progress: 45.5,
      etaSeconds: 1800,
    };

    it('should update job progress successfully', async () => {
      const updatedJob = { ...mockJob, ...updateDto };
      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(mockJob as never);
      jest.spyOn(prisma.job, 'update').mockResolvedValue(updatedJob as never);

      const result = await service.updateProgress('job-1', updateDto);

      expect(result).toEqual(updatedJob);
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: updateDto,
      });
    });

    it('should throw NotFoundException if job does not exist', async () => {
      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(null);

      await expect(service.updateProgress('non-existent', updateDto)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('completeJob', () => {
    const completeDto = {
      afterSizeBytes: '5368709120',
      savedBytes: '5368709120',
      savedPercent: 50.0,
    };

    it('should complete job and update metrics', async () => {
      const completedJob = {
        ...mockJobWithRelations,
        stage: JobStage.COMPLETED,
        progress: 100,
        afterSizeBytes: BigInt(completeDto.afterSizeBytes),
        savedBytes: BigInt(completeDto.savedBytes),
        savedPercent: completeDto.savedPercent,
        completedAt: new Date(),
      };

      jest.spyOn(prisma.job, 'update').mockResolvedValue(completedJob as never);
      jest.spyOn(prisma.metric, 'upsert').mockResolvedValue({} as never);

      const result = await service.completeJob('job-1', completeDto);

      expect(result.stage).toBe(JobStage.COMPLETED);
      expect(result.progress).toBe(100);
      expect(prisma.metric.upsert).toHaveBeenCalledTimes(2); // Node and license metrics
    });
  });

  describe('failJob', () => {
    const errorMessage = 'FFmpeg encoding failed: Unsupported codec';

    it('should mark job as failed', async () => {
      const failedJob = {
        ...mockJob,
        stage: JobStage.FAILED,
        error: errorMessage,
        completedAt: new Date(),
      };

      jest.spyOn(prisma.job, 'update').mockResolvedValue(failedJob as never);

      const result = await service.failJob('job-1', errorMessage);

      expect(result.stage).toBe(JobStage.FAILED);
      expect(result.error).toBe(errorMessage);
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          stage: JobStage.FAILED,
          completedAt: expect.any(Date),
          error: errorMessage,
        },
      });
    });
  });

  describe('cancelJob', () => {
    it('should cancel a queued job', async () => {
      const cancelledJob = {
        ...mockJob,
        stage: JobStage.CANCELLED,
        completedAt: new Date(),
      };

      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(mockJob as never);
      jest.spyOn(prisma.job, 'update').mockResolvedValue(cancelledJob as never);

      const result = await service.cancelJob('job-1');

      expect(result.stage).toBe(JobStage.CANCELLED);
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          stage: JobStage.CANCELLED,
          completedAt: expect.any(Date),
        },
      });
    });

    it('should throw NotFoundException if job does not exist', async () => {
      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(null);

      await expect(service.cancelJob('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if job is already completed', async () => {
      const completedJob = { ...mockJob, stage: JobStage.COMPLETED };
      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(completedJob as never);

      await expect(service.cancelJob('job-1')).rejects.toThrow(BadRequestException);
      await expect(service.cancelJob('job-1')).rejects.toThrow('Cannot cancel a completed job');
    });
  });

  describe('remove', () => {
    it('should delete a job successfully', async () => {
      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(mockJob as never);
      jest.spyOn(prisma.job, 'delete').mockResolvedValue(mockJob as never);

      await service.remove('job-1');

      expect(prisma.job.delete).toHaveBeenCalledWith({
        where: { id: 'job-1' },
      });
    });

    it('should throw NotFoundException if job does not exist', async () => {
      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(null);

      await expect(service.remove('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getJobStats', () => {
    it('should return job statistics without node filter', async () => {
      jest
        .spyOn(prisma.job, 'count')
        .mockResolvedValueOnce(150) // completed
        .mockResolvedValueOnce(5) // failed
        .mockResolvedValueOnce(3) // encoding
        .mockResolvedValueOnce(42); // queued

      jest.spyOn(prisma.job, 'aggregate').mockResolvedValue({
        _sum: { savedBytes: BigInt(536870912000) },
      } as never);

      const result = await service.getJobStats();

      expect(result).toEqual({
        completed: 150,
        failed: 5,
        encoding: 3,
        queued: 42,
        totalSavedBytes: '536870912000',
        nodeId: undefined,
      });
    });

    it('should return job statistics filtered by node', async () => {
      jest
        .spyOn(prisma.job, 'count')
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(10);

      jest.spyOn(prisma.job, 'aggregate').mockResolvedValue({
        _sum: { savedBytes: BigInt(100000000000) },
      } as never);

      const result = await service.getJobStats('node-1');

      expect(result).toEqual({
        completed: 50,
        failed: 2,
        encoding: 1,
        queued: 10,
        totalSavedBytes: '100000000000',
        nodeId: 'node-1',
      });
    });
  });
});
