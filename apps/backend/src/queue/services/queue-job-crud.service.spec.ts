import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { NodeRepository } from '../../common/repositories/node.repository';
import { ContentFingerprintService } from '../../core/services/content-fingerprint.service';
import { NodeConfigService } from '../../core/services/node-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FileFailureTrackingService } from './file-failure-tracking.service';
import { QueueJobCrudService } from './queue-job-crud.service';

describe('QueueJobCrudService', () => {
  let service: QueueJobCrudService;
  let mockJobRepository: jest.Mocked<JobRepository>;
  let mockNodeRepository: jest.Mocked<NodeRepository>;
  let mockNodeConfig: jest.Mocked<NodeConfigService>;
  let mockPrisma: jest.Mocked<PrismaService>;
  let mockContentFingerprint: jest.Mocked<ContentFingerprintService>;
  let mockFileFailureTracking: jest.Mocked<FileFailureTrackingService>;
  let mockHttpService: { post: jest.Mock; patch: jest.Mock; get: jest.Mock };

  beforeEach(async () => {
    mockJobRepository = {
      findUniqueSelect: jest.fn(),
      findById: jest.fn(),
      findFirstWhere: jest.fn(),
      findManyWithInclude: jest.fn(),
      countWhere: jest.fn(),
      aggregateSumWhere: jest.fn(),
      createJob: jest.fn(),
      updateById: jest.fn(),
      updateRaw: jest.fn(),
      atomicUpdateMany: jest.fn(),
      deleteById: jest.fn(),
      deleteManyWhere: jest.fn(),
      findStatusFields: jest.fn(),
    } as any;

    mockNodeRepository = {
      findById: jest.fn(),
    } as any;

    mockNodeConfig = {
      getNodeId: jest.fn().mockReturnValue(null),
      isMainNode: jest.fn().mockReturnValue(true),
      getMainApiUrl: jest.fn().mockReturnValue(null),
    } as any;

    mockPrisma = {
      library: { findUnique: jest.fn() },
      policy: { findUnique: jest.fn() },
      processedFileRecord: { findUnique: jest.fn() },
    } as any;

    mockContentFingerprint = {
      computeFingerprint: jest.fn().mockResolvedValue(null),
    } as any;

    mockFileFailureTracking = {
      isBlacklisted: jest.fn().mockResolvedValue(false),
    } as any;

    mockHttpService = {
      post: jest.fn(),
      patch: jest.fn(),
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueJobCrudService,
        { provide: JobRepository, useValue: mockJobRepository },
        { provide: NodeRepository, useValue: mockNodeRepository },
        { provide: NodeConfigService, useValue: mockNodeConfig },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ContentFingerprintService, useValue: mockContentFingerprint },
        { provide: FileFailureTrackingService, useValue: mockFileFailureTracking },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    service = module.get<QueueJobCrudService>(QueueJobCrudService);
    // Inject httpService manually since token name may vary
    (service as any).httpService = mockHttpService;
  });

  describe('validateJobOwnership', () => {
    it('should return job data when nodeId is null (no node configured)', async () => {
      mockNodeConfig.getNodeId.mockReturnValue(null);
      mockJobRepository.findUniqueSelect.mockResolvedValue({ nodeId: null, updatedAt: new Date() });

      const result = await service.validateJobOwnership('job-1', 'update');

      expect(result).toEqual({ nodeId: null, updatedAt: expect.any(Date) });
    });

    it('should throw NotFoundException when job not found', async () => {
      mockNodeConfig.getNodeId.mockReturnValue(null);
      mockJobRepository.findUniqueSelect.mockResolvedValue(null);

      await expect(service.validateJobOwnership('missing', 'update')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw ForbiddenException when non-main node attempts cross-node operation', async () => {
      mockNodeConfig.getNodeId.mockReturnValue('node-A');
      mockNodeConfig.isMainNode.mockReturnValue(false);
      mockJobRepository.findUniqueSelect.mockResolvedValue({
        nodeId: 'node-B',
        fileLabel: 'movie.mkv',
        updatedAt: new Date(),
      });

      await expect(service.validateJobOwnership('job-1', 'update')).rejects.toThrow(
        ForbiddenException
      );
    });

    it('should allow main node to modify any job', async () => {
      mockNodeConfig.getNodeId.mockReturnValue('node-A');
      mockNodeConfig.isMainNode.mockReturnValue(true);
      const updatedAt = new Date();
      mockJobRepository.findUniqueSelect.mockResolvedValue({
        nodeId: 'node-B',
        fileLabel: 'movie.mkv',
        updatedAt,
      });

      const result = await service.validateJobOwnership('job-1', 'update');
      expect(result.nodeId).toBe('node-B');
    });
  });

  describe('findAll', () => {
    it('should return paginated jobs', async () => {
      const jobs = [{ id: 'job-1', fileLabel: 'a.mkv' }];
      mockJobRepository.findManyWithInclude.mockResolvedValue(jobs as any);
      mockJobRepository.countWhere.mockResolvedValue(1);

      const result = await service.findAll(undefined, undefined, undefined, undefined, 1, 20);

      expect(result.jobs).toEqual(jobs);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('should filter by stage when provided', async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      mockJobRepository.countWhere.mockResolvedValue(0);

      await service.findAll(JobStage.ENCODING);

      expect(mockJobRepository.findManyWithInclude).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ stage: JobStage.ENCODING }) })
      );
    });
  });

  describe('findOne', () => {
    it('should return job when found', async () => {
      const job = { id: 'job-1', fileLabel: 'movie.mkv' };
      mockJobRepository.findManyWithInclude.mockResolvedValue([job] as any);

      const result = await service.findOne('job-1');
      expect(result).toEqual(job);
    });

    it('should throw NotFoundException when job not found', async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete an existing job', async () => {
      mockJobRepository.findById.mockResolvedValue({ id: 'job-1' } as any);
      mockJobRepository.deleteById.mockResolvedValue(undefined as any);

      await service.remove('job-1');

      expect(mockJobRepository.deleteById).toHaveBeenCalledWith('job-1');
    });

    it('should throw NotFoundException when job does not exist', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('clearJobs', () => {
    it('should clear all jobs when no stages provided', async () => {
      mockJobRepository.deleteManyWhere.mockResolvedValue({ count: 5 });

      const count = await service.clearJobs();
      expect(count).toBe(5);
      expect(mockJobRepository.deleteManyWhere).toHaveBeenCalledWith({});
    });

    it('should clear only specified stages', async () => {
      mockJobRepository.deleteManyWhere.mockResolvedValue({ count: 2 });

      const count = await service.clearJobs([JobStage.FAILED]);
      expect(count).toBe(2);
      expect(mockJobRepository.deleteManyWhere).toHaveBeenCalledWith({
        stage: { in: [JobStage.FAILED] },
      });
    });
  });

  describe('update', () => {
    it('should throw ConflictException when atomic update returns count 0', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockJobRepository.findUniqueSelect.mockResolvedValue({ nodeId: null, updatedAt: new Date() });
      mockJobRepository.atomicUpdateMany.mockResolvedValue({ count: 0 });

      await expect(service.update('job-1', { stage: JobStage.QUEUED })).rejects.toThrow(
        ConflictException
      );
    });

    it('should return updated job on success', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      const updatedAt = new Date();
      mockJobRepository.findUniqueSelect.mockResolvedValue({ nodeId: null, updatedAt });
      mockJobRepository.atomicUpdateMany.mockResolvedValue({ count: 1 });
      const job = { id: 'job-1', stage: JobStage.QUEUED };
      mockJobRepository.findById.mockResolvedValue(job as any);

      const result = await service.update('job-1', { stage: JobStage.QUEUED });
      expect(result).toEqual(job);
    });
  });

  describe('updateProgress', () => {
    it('should throw BadRequestException when progress is out of range', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockJobRepository.findUniqueSelect.mockResolvedValue({
        nodeId: null,
        updatedAt: new Date(),
      } as any);
      mockJobRepository.findById.mockResolvedValue({ id: 'job-1', stage: 'QUEUED' } as any);

      await expect(service.updateProgress('job-1', { progress: 150 } as any)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException when stage is HEALTH_CHECK', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockJobRepository.findUniqueSelect.mockResolvedValue({
        nodeId: null,
        updatedAt: new Date(),
      } as any);
      mockJobRepository.findById.mockResolvedValue({ id: 'job-1', stage: 'QUEUED' } as any);

      await expect(
        service.updateProgress('job-1', { stage: JobStage.HEALTH_CHECK } as any)
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getJobStats', () => {
    it('should return aggregated stats for all jobs', async () => {
      mockJobRepository.countWhere.mockResolvedValue(5);
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      mockJobRepository.aggregateSumWhere.mockResolvedValue({
        _sum: { savedBytes: BigInt(1000) },
      } as any);

      const stats = await service.getJobStats();
      expect(stats.queued).toBe(5);
      expect(stats.totalSavedBytes).toBe('1000');
    });

    it('should filter stats by nodeId when provided', async () => {
      mockJobRepository.countWhere.mockResolvedValue(2);
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      mockJobRepository.aggregateSumWhere.mockResolvedValue({
        _sum: { savedBytes: null },
      } as any);

      const stats = await service.getJobStats('node-1');
      expect(stats.nodeId).toBe('node-1');
      expect(stats.totalSavedBytes).toBe('0');
    });

    it('should calculate codecMatchCount for NEEDS_DECISION jobs', async () => {
      mockJobRepository.countWhere.mockResolvedValue(0);
      mockJobRepository.findManyWithInclude.mockResolvedValue([
        { sourceCodec: 'hevc', targetCodec: 'hevc' },
        { sourceCodec: 'h264', targetCodec: 'hevc' },
        { sourceCodec: 'HEVC', targetCodec: 'hevc' },
      ] as any);
      mockJobRepository.aggregateSumWhere.mockResolvedValue({
        _sum: { savedBytes: BigInt(0) },
      } as any);

      const stats = await service.getJobStats();
      expect(stats.codecMatchCount).toBe(2);
    });
  });

  describe('create', () => {
    const baseDto = {
      fileLabel: 'movie.mkv',
      filePath: '/library/movie.mkv',
      sourceCodec: 'h264',
      targetCodec: 'hevc',
      beforeSizeBytes: 1024 * 1024,
      nodeId: 'node-1',
      libraryId: 'lib-1',
      policyId: 'policy-1',
      warning: null,
      resourceThrottled: false,
      resourceThrottleReason: null,
      ffmpegThreads: null,
      type: 'ENCODE',
      sourceContainer: 'mkv',
      targetContainer: 'mkv',
    };

    beforeEach(() => {
      // Skip real filesystem validation in create tests
      jest.spyOn(service, 'validateFilePath').mockImplementation(() => undefined);
    });

    it('should throw BadRequestException when file size exceeds 500 GB', async () => {
      const hugeDto = {
        ...baseDto,
        beforeSizeBytes: Number(BigInt(501) * BigInt(1024) * BigInt(1024) * BigInt(1024)),
      };

      await expect(service.create(hugeDto as any)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when file size is below 1 KB', async () => {
      const tinyDto = { ...baseDto, beforeSizeBytes: 512 };

      await expect(service.create(tinyDto as any)).rejects.toThrow(BadRequestException);
    });

    it('should proxy job creation to MAIN node when mainApiUrl is set', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3000');
      const mockResponse = { data: { id: 'job-proxied' } };
      mockHttpService.post.mockReturnValue({
        pipe: jest.fn(),
        subscribe: jest.fn(),
        toPromise: jest.fn(),
      });

      const { firstValueFrom: fvf } = jest.requireMock('rxjs');
      // We can't easily mock firstValueFrom without rewiring, so test error path instead
      mockHttpService.post.mockReturnValue({
        subscribe: jest.fn(),
        pipe: jest.fn(),
      });

      // Patch firstValueFrom indirectly - test that the error is propagated
      const error = new Error('MAIN unreachable');
      jest.spyOn(require('rxjs'), 'firstValueFrom').mockRejectedValueOnce(error);

      await expect(service.create(baseDto as any)).rejects.toThrow('MAIN unreachable');
    });

    it('should throw NotFoundException when node does not exist', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findById.mockResolvedValue(null);
      (mockPrisma.library.findUnique as jest.Mock).mockResolvedValue({
        id: 'lib-1',
        path: '/library',
      } as any);
      (mockPrisma.policy.findUnique as jest.Mock).mockResolvedValue({ id: 'policy-1' } as any);

      await expect(service.create(baseDto as any)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when library does not exist', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1' } as any);
      (mockPrisma.library.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.policy.findUnique as jest.Mock).mockResolvedValue({ id: 'policy-1' } as any);

      await expect(service.create(baseDto as any)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when policy does not exist', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1' } as any);
      (mockPrisma.library.findUnique as jest.Mock).mockResolvedValue({
        id: 'lib-1',
        path: '/library',
      } as any);
      (mockPrisma.policy.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.create(baseDto as any)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when active job already exists for file', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1' } as any);
      (mockPrisma.library.findUnique as jest.Mock).mockResolvedValue({
        id: 'lib-1',
        path: '/tmp',
      } as any);
      (mockPrisma.policy.findUnique as jest.Mock).mockResolvedValue({ id: 'policy-1' } as any);
      mockJobRepository.findFirstWhere.mockResolvedValue({
        id: 'existing',
        stage: JobStage.QUEUED,
      } as any);

      const dtoWithTmpPath = { ...baseDto, filePath: '/tmp/movie.mkv' };
      await expect(service.create(dtoWithTmpPath as any)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when fingerprint matches already-processed file', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1' } as any);
      (mockPrisma.library.findUnique as jest.Mock).mockResolvedValue({
        id: 'lib-1',
        path: '/tmp',
      } as any);
      (mockPrisma.policy.findUnique as jest.Mock).mockResolvedValue({ id: 'policy-1' } as any);
      mockJobRepository.findFirstWhere.mockResolvedValue(null);
      mockContentFingerprint.computeFingerprint.mockResolvedValue('fp-abc123');
      (mockPrisma.processedFileRecord.findUnique as jest.Mock).mockResolvedValue({
        filePath: '/old/movie.mkv',
        contentFingerprint: 'fp-abc123',
      } as any);

      const dtoWithTmpPath = { ...baseDto, filePath: '/tmp/movie.mkv' };
      await expect(service.create(dtoWithTmpPath as any)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when fingerprint is blacklisted', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1' } as any);
      (mockPrisma.library.findUnique as jest.Mock).mockResolvedValue({
        id: 'lib-1',
        path: '/tmp',
      } as any);
      (mockPrisma.policy.findUnique as jest.Mock).mockResolvedValue({ id: 'policy-1' } as any);
      mockJobRepository.findFirstWhere.mockResolvedValue(null);
      mockContentFingerprint.computeFingerprint.mockResolvedValue('fp-blacklisted');
      (mockPrisma.processedFileRecord.findUnique as jest.Mock).mockResolvedValue(null);
      mockFileFailureTracking.isBlacklisted.mockResolvedValue(true);

      const dtoWithTmpPath = { ...baseDto, filePath: '/tmp/movie.mkv' };
      await expect(service.create(dtoWithTmpPath as any)).rejects.toThrow(BadRequestException);
    });

    it('should continue job creation when fingerprint computation fails with non-BadRequest error', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1' } as any);
      (mockPrisma.library.findUnique as jest.Mock).mockResolvedValue({
        id: 'lib-1',
        path: '/tmp',
      } as any);
      (mockPrisma.policy.findUnique as jest.Mock).mockResolvedValue({ id: 'policy-1' } as any);
      // First call: active job check returns null, second call: old jobs returns []
      mockJobRepository.findFirstWhere.mockResolvedValue(null);
      mockContentFingerprint.computeFingerprint.mockRejectedValue(new Error('IO error'));
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      const createdJob = { id: 'new-job', fileLabel: 'movie.mkv' };
      mockJobRepository.createJob.mockResolvedValue(createdJob as any);

      const dtoWithTmpPath = { ...baseDto, filePath: '/tmp/movie.mkv' };
      const result = await service.create(dtoWithTmpPath as any);
      expect(result.id).toBe('new-job');
    });

    it('should delete old FAILED/CANCELLED jobs before creating new one', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1' } as any);
      (mockPrisma.library.findUnique as jest.Mock).mockResolvedValue({
        id: 'lib-1',
        path: '/tmp',
      } as any);
      (mockPrisma.policy.findUnique as jest.Mock).mockResolvedValue({ id: 'policy-1' } as any);
      mockJobRepository.findFirstWhere.mockResolvedValue(null);
      mockContentFingerprint.computeFingerprint.mockResolvedValue(null);
      mockJobRepository.findManyWithInclude.mockResolvedValue([
        { id: 'old-1', stage: JobStage.FAILED },
        { id: 'old-2', stage: JobStage.CANCELLED },
      ] as any);
      mockJobRepository.deleteManyWhere.mockResolvedValue({ count: 2 });
      const createdJob = { id: 'new-job', fileLabel: 'movie.mkv' };
      mockJobRepository.createJob.mockResolvedValue(createdJob as any);

      const dtoWithTmpPath = { ...baseDto, filePath: '/tmp/movie.mkv' };
      await service.create(dtoWithTmpPath as any);

      expect(mockJobRepository.deleteManyWhere).toHaveBeenCalledWith({
        id: { in: ['old-1', 'old-2'] },
      });
    });

    it('should handle P2002 unique constraint violation and throw BadRequestException when job exists', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1' } as any);
      (mockPrisma.library.findUnique as jest.Mock).mockResolvedValue({
        id: 'lib-1',
        path: '/tmp',
      } as any);
      (mockPrisma.policy.findUnique as jest.Mock).mockResolvedValue({ id: 'policy-1' } as any);
      mockJobRepository.findFirstWhere
        .mockResolvedValueOnce(null) // active job check
        .mockResolvedValueOnce({ id: 'race-job', stage: JobStage.QUEUED } as any); // conflict lookup
      mockContentFingerprint.computeFingerprint.mockResolvedValue(null);
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      const prismaError = {
        code: 'P2002',
        meta: { target: ['unique_active_job_per_file'] },
      };
      mockJobRepository.createJob.mockRejectedValue(prismaError);

      const dtoWithTmpPath = { ...baseDto, filePath: '/tmp/movie.mkv' };
      await expect(service.create(dtoWithTmpPath as any)).rejects.toThrow(BadRequestException);
    });

    it('should rethrow non-P2002 errors from createJob', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1' } as any);
      (mockPrisma.library.findUnique as jest.Mock).mockResolvedValue({
        id: 'lib-1',
        path: '/tmp',
      } as any);
      (mockPrisma.policy.findUnique as jest.Mock).mockResolvedValue({ id: 'policy-1' } as any);
      mockJobRepository.findFirstWhere.mockResolvedValue(null);
      mockContentFingerprint.computeFingerprint.mockResolvedValue(null);
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      mockJobRepository.createJob.mockRejectedValue(new Error('DB connection lost'));

      const dtoWithTmpPath = { ...baseDto, filePath: '/tmp/movie.mkv' };
      await expect(service.create(dtoWithTmpPath as any)).rejects.toThrow('DB connection lost');
    });
  });

  describe('validateFilePath', () => {
    it('should throw BadRequestException for path containing ..', () => {
      expect(() => service.validateFilePath('/library/../etc/passwd', '/library')).toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException for path containing %2e', () => {
      expect(() => service.validateFilePath('/library/%2e%2e/etc/passwd', '/library')).toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException for path containing %2E', () => {
      expect(() => service.validateFilePath('/library/%2E/secret', '/library')).toThrow(
        BadRequestException
      );
    });
  });

  describe('findAll', () => {
    it('should use default page 1 and limit 20 when not provided', async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      mockJobRepository.countWhere.mockResolvedValue(0);

      const result = await service.findAll();

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should use default values when page/limit are 0 or negative', async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      mockJobRepository.countWhere.mockResolvedValue(0);

      const result = await service.findAll(undefined, undefined, undefined, undefined, 0, 0);

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should filter by nodeId when provided', async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      mockJobRepository.countWhere.mockResolvedValue(0);

      await service.findAll(undefined, 'node-1');

      expect(mockJobRepository.findManyWithInclude).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ nodeId: 'node-1' }) })
      );
    });

    it('should filter by libraryId when provided', async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      mockJobRepository.countWhere.mockResolvedValue(0);

      await service.findAll(undefined, undefined, undefined, 'lib-1');

      expect(mockJobRepository.findManyWithInclude).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ libraryId: 'lib-1' }) })
      );
    });

    it('should add OR search clause when search term is provided', async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      mockJobRepository.countWhere.mockResolvedValue(0);

      await service.findAll(undefined, undefined, 'avengers');

      expect(mockJobRepository.findManyWithInclude).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ filePath: { contains: 'avengers' } }, { fileLabel: { contains: 'avengers' } }],
          }),
        })
      );
    });

    it('should sort by failedAt desc for FAILED stage', async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      mockJobRepository.countWhere.mockResolvedValue(0);

      await service.findAll(JobStage.FAILED);

      expect(mockJobRepository.findManyWithInclude).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { failedAt: 'desc' } })
      );
    });

    it('should calculate totalPages correctly', async () => {
      mockJobRepository.findManyWithInclude.mockResolvedValue([]);
      mockJobRepository.countWhere.mockResolvedValue(45);

      const result = await service.findAll(undefined, undefined, undefined, undefined, 1, 10);

      expect(result.totalPages).toBe(5);
    });
  });

  describe('getJobStatus', () => {
    it('should return job status fields', async () => {
      const statusFields = {
        pauseRequestedAt: null,
        pauseProcessedAt: null,
        cancelRequestedAt: null,
        cancelProcessedAt: null,
      };
      mockJobRepository.findStatusFields.mockResolvedValue(statusFields as any);

      const result = await service.getJobStatus('job-1');
      expect(result).toEqual(statusFields);
      expect(mockJobRepository.findStatusFields).toHaveBeenCalledWith('job-1');
    });

    it('should return null when job has no status fields', async () => {
      mockJobRepository.findStatusFields.mockResolvedValue(null);

      const result = await service.getJobStatus('missing');
      expect(result).toBeNull();
    });
  });

  describe('updateJobRaw', () => {
    it('should call repository updateRaw with provided data', async () => {
      mockJobRepository.updateRaw.mockResolvedValue({ id: 'job-1' } as any);

      await service.updateJobRaw('job-1', { stage: 'QUEUED' });

      expect(mockJobRepository.updateRaw).toHaveBeenCalledWith('job-1', { stage: 'QUEUED' });
    });
  });

  describe('updateJobPreview', () => {
    it('should update preview image paths', async () => {
      const updatedJob = { id: 'job-1', previewImagePaths: '["a.jpg","b.jpg"]' };
      mockJobRepository.updateById.mockResolvedValue(updatedJob as any);

      const result = await service.updateJobPreview('job-1', ['a.jpg', 'b.jpg']);

      expect(result).toEqual(updatedJob);
      expect(mockJobRepository.updateById).toHaveBeenCalledWith('job-1', {
        previewImagePaths: '["a.jpg","b.jpg"]',
      });
    });

    it('should propagate errors from repository', async () => {
      mockJobRepository.updateById.mockRejectedValue(new Error('DB error'));

      await expect(service.updateJobPreview('job-1', [])).rejects.toThrow('DB error');
    });
  });

  describe('updateProgress', () => {
    it('should throw BadRequestException when progress is negative', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockJobRepository.findUniqueSelect.mockResolvedValue({
        nodeId: null,
        updatedAt: new Date(),
      } as any);
      mockJobRepository.findById.mockResolvedValue({ id: 'job-1', stage: 'QUEUED' } as any);

      await expect(service.updateProgress('job-1', { progress: -1 } as any)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException when etaSeconds is negative', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockJobRepository.findUniqueSelect.mockResolvedValue({
        nodeId: null,
        updatedAt: new Date(),
      } as any);
      mockJobRepository.findById.mockResolvedValue({ id: 'job-1', stage: 'QUEUED' } as any);

      await expect(service.updateProgress('job-1', { etaSeconds: -5 } as any)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw NotFoundException when job does not exist', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockJobRepository.findUniqueSelect.mockResolvedValue({
        nodeId: null,
        updatedAt: new Date(),
      } as any);
      mockJobRepository.findById.mockResolvedValue(null);

      await expect(service.updateProgress('missing', { progress: 50 } as any)).rejects.toThrow(
        NotFoundException
      );
    });

    it('should set lastHeartbeat when job stage is ENCODING', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockJobRepository.findUniqueSelect.mockResolvedValue({
        nodeId: null,
        updatedAt: new Date(),
      } as any);
      mockJobRepository.findById.mockResolvedValue({
        id: 'job-1',
        stage: 'ENCODING',
        nodeId: 'node-1',
      } as any);
      const updatedJob = { id: 'job-1', progress: 50 };
      mockJobRepository.updateRaw.mockResolvedValue(updatedJob as any);

      await service.updateProgress('job-1', { progress: 50 } as any);

      expect(mockJobRepository.updateRaw).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ lastHeartbeat: expect.any(Date), heartbeatNodeId: 'node-1' })
      );
    });

    it('should proxy update to MAIN node when mainApiUrl is set', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3000');
      const error = new Error('Network error');
      jest.spyOn(require('rxjs'), 'firstValueFrom').mockRejectedValueOnce(error);

      await expect(service.updateProgress('job-1', { progress: 50 } as any)).rejects.toThrow(
        'Network error'
      );
    });

    it('should update lastProgressUpdate when resumeTimestamp is provided', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockJobRepository.findUniqueSelect.mockResolvedValue({
        nodeId: null,
        updatedAt: new Date(),
      } as any);
      mockJobRepository.findById.mockResolvedValue({
        id: 'job-1',
        stage: 'QUEUED',
        nodeId: null,
      } as any);
      const updatedJob = { id: 'job-1' };
      mockJobRepository.updateRaw.mockResolvedValue(updatedJob as any);

      await service.updateProgress('job-1', { resumeTimestamp: 120 } as any);

      expect(mockJobRepository.updateRaw).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ resumeTimestamp: 120, lastProgressUpdate: expect.any(Date) })
      );
    });
  });

  describe('update', () => {
    it('should proxy update to MAIN node when mainApiUrl is set', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3000');
      const error = new Error('Proxy error');
      jest.spyOn(require('rxjs'), 'firstValueFrom').mockRejectedValueOnce(error);

      await expect(service.update('job-1', { stage: JobStage.QUEUED })).rejects.toThrow(
        'Proxy error'
      );
    });

    it('should set lastStageChangeAt when stage is included in update', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      const updatedAt = new Date();
      mockJobRepository.findUniqueSelect.mockResolvedValue({ nodeId: null, updatedAt });
      mockJobRepository.atomicUpdateMany.mockResolvedValue({ count: 1 });
      const job = { id: 'job-1', stage: JobStage.QUEUED };
      mockJobRepository.findById.mockResolvedValue(job as any);

      await service.update('job-1', { stage: JobStage.QUEUED });

      expect(mockJobRepository.atomicUpdateMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ lastStageChangeAt: expect.any(Date) })
      );
    });

    it('should throw NotFoundException when job not found after update', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue(null);
      mockJobRepository.findUniqueSelect.mockResolvedValue({ nodeId: null, updatedAt: new Date() });
      mockJobRepository.atomicUpdateMany.mockResolvedValue({ count: 1 });
      mockJobRepository.findById.mockResolvedValue(null);

      await expect(service.update('job-1', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should propagate errors from deleteById', async () => {
      mockJobRepository.findById.mockResolvedValue({ id: 'job-1' } as any);
      mockJobRepository.deleteById.mockRejectedValue(new Error('Delete failed'));

      await expect(service.remove('job-1')).rejects.toThrow('Delete failed');
    });
  });

  describe('clearJobs', () => {
    it('should clear jobs with empty stages array as all jobs', async () => {
      mockJobRepository.deleteManyWhere.mockResolvedValue({ count: 10 });

      const count = await service.clearJobs([]);
      expect(count).toBe(10);
      expect(mockJobRepository.deleteManyWhere).toHaveBeenCalledWith({});
    });

    it('should propagate errors from deleteManyWhere', async () => {
      mockJobRepository.deleteManyWhere.mockRejectedValue(new Error('Clear failed'));

      await expect(service.clearJobs()).rejects.toThrow('Clear failed');
    });
  });

  describe('validateJobOwnership', () => {
    it('should allow same node to modify its own job', async () => {
      mockNodeConfig.getNodeId.mockReturnValue('node-A');
      mockNodeConfig.isMainNode.mockReturnValue(false);
      const updatedAt = new Date();
      mockJobRepository.findUniqueSelect.mockResolvedValue({
        nodeId: 'node-A',
        fileLabel: 'movie.mkv',
        updatedAt,
      });

      const result = await service.validateJobOwnership('job-1', 'update');
      expect(result.nodeId).toBe('node-A');
    });

    it('should allow when job has no assigned node (nodeId is null)', async () => {
      mockNodeConfig.getNodeId.mockReturnValue('node-A');
      mockNodeConfig.isMainNode.mockReturnValue(false);
      const updatedAt = new Date();
      mockJobRepository.findUniqueSelect.mockResolvedValue({
        nodeId: null,
        fileLabel: 'movie.mkv',
        updatedAt,
      });

      const result = await service.validateJobOwnership('job-1', 'update');
      expect(result.nodeId).toBeNull();
    });

    it('should throw NotFoundException when job not found with nodeId set', async () => {
      mockNodeConfig.getNodeId.mockReturnValue('node-A');
      mockNodeConfig.isMainNode.mockReturnValue(false);
      mockJobRepository.findUniqueSelect.mockResolvedValue(null);

      await expect(service.validateJobOwnership('missing', 'update')).rejects.toThrow(
        NotFoundException
      );
    });
  });
});
