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
  });
});
