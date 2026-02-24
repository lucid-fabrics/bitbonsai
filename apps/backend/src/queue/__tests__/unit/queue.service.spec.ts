import { HttpService } from '@nestjs/axios';
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
import { NodeConfigService } from '../../../core/services/node-config.service';
import { FfmpegService } from '../../../encoding/ffmpeg.service';
import { MediaAnalysisService } from '../../../libraries/services/media-analysis.service';
import { SharedStorageVerifierService } from '../../../nodes/services/shared-storage-verifier.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../../queue.service';
import { FileTransferService } from '../../services/file-transfer.service';
import { JobHistoryService } from '../../services/job-history.service';
import { JobRouterService } from '../../services/job-router.service';

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
          provide: MediaAnalysisService,
          useValue: { analyze: jest.fn(), getMediaInfo: jest.fn() },
        },
        {
          provide: FfmpegService,
          useValue: { encode: jest.fn(), probe: jest.fn() },
        },
        {
          provide: JobHistoryService,
          useValue: { recordHistory: jest.fn(), recordEvent: jest.fn(), getHistory: jest.fn() },
        },
        {
          provide: JobRouterService,
          useValue: { findOptimalNode: jest.fn(), routeJob: jest.fn() },
        },
        {
          provide: FileTransferService,
          useValue: { transferFile: jest.fn(), verifyTransfer: jest.fn() },
        },
        {
          provide: NodeConfigService,
          useValue: {
            getConfig: jest.fn(),
            isMainNode: jest.fn().mockReturnValue(true),
            getMainApiUrl: jest.fn().mockReturnValue(null),
            getNodeRole: jest.fn().mockReturnValue('MAIN'),
            getNodeId: jest.fn().mockReturnValue('node-1'),
            getRole: jest.fn().mockReturnValue('MAIN'),
          },
        },
        {
          provide: HttpService,
          useValue: { get: jest.fn(), post: jest.fn(), axiosRef: {} },
        },
        {
          provide: SharedStorageVerifierService,
          useValue: { verify: jest.fn(), isSharedStorage: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn().mockImplementation((fn: any) => {
              if (typeof fn === 'function') {
                return fn({
                  $executeRaw: jest.fn(),
                  $queryRaw: jest.fn(),
                  job: {
                    findFirst: jest.fn(),
                    update: jest.fn(),
                    updateMany: jest.fn(),
                    findUnique: jest.fn(),
                    findMany: jest.fn().mockResolvedValue([]),
                    count: jest.fn().mockResolvedValue(0),
                  },
                  node: {
                    findUnique: jest.fn(),
                  },
                });
              }
              return Promise.all(fn);
            }),
            node: {
              findUnique: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
            },
            library: {
              findUnique: jest.fn(),
            },
            policy: {
              findUnique: jest.fn(),
            },
            job: {
              create: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
              count: jest.fn().mockResolvedValue(0),
              aggregate: jest.fn(),
              groupBy: jest.fn().mockResolvedValue([]),
            },
            metric: {
              upsert: jest.fn(),
            },
            license: {
              findFirst: jest.fn(),
            },
            jobHistory: {
              create: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
            },
          },
        },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
    prisma = module.get<PrismaService>(PrismaService);

    // Skip file path validation since test paths don't exist on disk
    jest.spyOn(service as any, 'validateFilePath').mockImplementation(() => {});
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
      jest.spyOn(prisma.job, 'findMany').mockResolvedValue([]);
      jest.spyOn(prisma.job, 'create').mockResolvedValue(mockJob as never);

      const result = await service.create(createDto);

      expect(result).toEqual(mockJob);
      expect(prisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            filePath: createDto.filePath,
            fileLabel: createDto.fileLabel,
            sourceCodec: createDto.sourceCodec,
            targetCodec: createDto.targetCodec,
            beforeSizeBytes: BigInt(createDto.beforeSizeBytes),
            nodeId: createDto.nodeId,
            libraryId: createDto.libraryId,
            policyId: createDto.policyId,
          }),
        })
      );
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
      jest.spyOn(prisma.job, 'count').mockResolvedValue(1);

      const result = await service.findAll();

      expect(result.jobs).toEqual(mockJobs);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          include: expect.any(Object),
        })
      );
    });

    it('should filter jobs by stage', async () => {
      const mockJobs = [mockJobWithRelations];
      jest.spyOn(prisma.job, 'findMany').mockResolvedValue(mockJobs as never);
      jest.spyOn(prisma.job, 'count').mockResolvedValue(1);

      const result = await service.findAll(JobStage.QUEUED);

      expect(result.jobs).toEqual(mockJobs);
      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stage: JobStage.QUEUED },
          include: expect.any(Object),
        })
      );
    });

    it('should filter jobs by node ID', async () => {
      const mockJobs = [mockJobWithRelations];
      jest.spyOn(prisma.job, 'findMany').mockResolvedValue(mockJobs as never);
      jest.spyOn(prisma.job, 'count').mockResolvedValue(1);

      const result = await service.findAll(undefined, 'node-1');

      expect(result.jobs).toEqual(mockJobs);
      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { nodeId: 'node-1' },
          include: expect.any(Object),
        })
      );
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
        maxWorkers: 5,
        _count: { jobs: 2 },
      };
      const updatedJob = {
        ...mockJobWithRelations,
        stage: JobStage.ENCODING,
        startedAt: new Date(),
        policy: mockPolicy,
      };

      // Pre-transaction node lookup
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(nodeWithCapacity as never);

      // $transaction receives a callback; mock the inner tx operations
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
        const tx = {
          $executeRaw: jest.fn(),
          $queryRaw: jest.fn(),
          job: {
            findFirst: jest.fn().mockResolvedValue(mockJobWithRelations),
            findUnique: jest.fn().mockResolvedValue(updatedJob),
            update: jest.fn().mockResolvedValue(updatedJob),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            count: jest.fn().mockResolvedValue(2),
          },
          node: {
            findUnique: jest.fn().mockResolvedValue(nodeWithCapacity),
          },
        };
        return fn(tx);
      });

      const result = await service.getNextJob('node-1');

      expect(result).toBeTruthy();
      expect(result?.stage).toBe(JobStage.ENCODING);
    });

    it('should return null if no queued jobs available', async () => {
      const nodeWithCapacity = {
        ...mockNode,
        maxWorkers: 5,
        _count: { jobs: 0 },
      };

      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(nodeWithCapacity as never);

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
        const tx = {
          $executeRaw: jest.fn(),
          $queryRaw: jest.fn(),
          job: {
            findFirst: jest.fn().mockResolvedValue(null),
            count: jest.fn().mockResolvedValue(0),
          },
          node: {
            findUnique: jest.fn().mockResolvedValue(nodeWithCapacity),
          },
        };
        return fn(tx);
      });

      const result = await service.getNextJob('node-1');

      expect(result).toBeNull();
    });

    it('should throw NotFoundException if node does not exist', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(null);

      await expect(service.getNextJob('non-existent')).rejects.toThrow(NotFoundException);
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
        node: { ...mockNode, license: mockLicense },
      };

      // validateJobOwnership pre-check
      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue({
        ...mockJob,
        nodeId: 'node-1',
        fileLabel: 'Avatar',
        updatedAt: new Date(),
      } as never);

      // completeJob now uses $transaction with updateMetrics
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => {
        const tx = {
          job: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce({ stage: JobStage.ENCODING }) // First: existence check
              .mockResolvedValue(completedJob), // Second: full fetch
            update: jest.fn().mockResolvedValue(completedJob),
          },
          node: {
            findUnique: jest.fn().mockResolvedValue({ ...mockNode, license: mockLicense }),
          },
          metric: {
            upsert: jest.fn().mockResolvedValue({}),
          },
          metricsProcessedJob: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      });

      const result = await service.completeJob('job-1', completeDto);

      expect(result.stage).toBe(JobStage.COMPLETED);
      expect(result.progress).toBe(100);
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
        failedAt: new Date(),
      };

      jest.spyOn(prisma.job, 'findUnique').mockResolvedValue(mockJob as never);
      jest.spyOn(prisma.job, 'update').mockResolvedValue(failedJob as never);

      const result = await service.failJob('job-1', errorMessage);

      expect(result.stage).toBe(JobStage.FAILED);
      expect(result.error).toBe(errorMessage);
      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1' },
          data: expect.objectContaining({
            stage: JobStage.FAILED,
            error: errorMessage,
          }),
        })
      );
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
      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1' },
          data: expect.objectContaining({
            stage: JobStage.CANCELLED,
          }),
        })
      );
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
      // 10 count calls (detected, healthCheck, needsDecision, queued, transferring, encoding, verifying, completed, failed, cancelled)
      jest
        .spyOn(prisma.job, 'count')
        .mockResolvedValueOnce(0) // detected
        .mockResolvedValueOnce(0) // healthCheck
        .mockResolvedValueOnce(0) // needsDecision
        .mockResolvedValueOnce(42) // queued
        .mockResolvedValueOnce(0) // transferring
        .mockResolvedValueOnce(3) // encoding
        .mockResolvedValueOnce(0) // verifying
        .mockResolvedValueOnce(150) // completed
        .mockResolvedValueOnce(5) // failed
        .mockResolvedValueOnce(0); // cancelled

      jest.spyOn(prisma.job, 'findMany').mockResolvedValue([] as never);
      jest.spyOn(prisma.job, 'aggregate').mockResolvedValue({
        _sum: { savedBytes: BigInt(536870912000) },
      } as never);

      const result = await service.getJobStats();

      expect(result.completed).toBe(150);
      expect(result.failed).toBe(5);
      expect(result.encoding).toBe(3);
      expect(result.queued).toBe(42);
      expect(result.totalSavedBytes).toBe('536870912000');
    });

    it('should return job statistics filtered by node', async () => {
      jest
        .spyOn(prisma.job, 'count')
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(10) // queued
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1) // encoding
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(50) // completed
        .mockResolvedValueOnce(2) // failed
        .mockResolvedValueOnce(0);

      jest.spyOn(prisma.job, 'findMany').mockResolvedValue([] as never);
      jest.spyOn(prisma.job, 'aggregate').mockResolvedValue({
        _sum: { savedBytes: BigInt(100000000000) },
      } as never);

      const result = await service.getJobStats('node-1');

      expect(result.completed).toBe(50);
      expect(result.failed).toBe(2);
      expect(result.encoding).toBe(1);
      expect(result.queued).toBe(10);
      expect(result.totalSavedBytes).toBe('100000000000');
    });
  });
});
