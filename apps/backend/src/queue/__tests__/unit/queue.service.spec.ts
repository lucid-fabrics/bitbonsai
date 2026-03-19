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
import { QueueService } from '../../queue.service';
import { QueueDelegationService } from '../../services/queue-delegation.service';
import { QueueJobCrudService } from '../../services/queue-job-crud.service';
import { QueueJobStateService } from '../../services/queue-job-state.service';
import { QueueProcessingService } from '../../services/queue-processing.service';

describe('QueueService', () => {
  let service: QueueService;
  let jobCrudService: Record<string, jest.Mock>;
  let jobStateService: Record<string, jest.Mock>;
  let processingService: Record<string, jest.Mock>;

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
    jobCrudService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      getJobStatus: jest.fn(),
      updateJobRaw: jest.fn(),
      updateProgress: jest.fn(),
      updateJobPreview: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      clearJobs: jest.fn(),
      getJobStats: jest.fn(),
    };

    jobStateService = {
      completeJob: jest.fn(),
      failJob: jest.fn(),
      cancelJob: jest.fn(),
      unblacklistJob: jest.fn(),
      cancelAllQueued: jest.fn(),
      pauseJob: jest.fn(),
      resumeJob: jest.fn(),
      retryJob: jest.fn(),
      forceStartJob: jest.fn(),
      recheckHealth: jest.fn(),
      retryAllCancelled: jest.fn(),
      retryAllFailed: jest.fn(),
      skipAllCodecMatch: jest.fn(),
      forceEncodeAllCodecMatch: jest.fn(),
      updateJobPriority: jest.fn(),
      requestKeepOriginal: jest.fn(),
      deleteOriginalBackup: jest.fn(),
      restoreOriginal: jest.fn(),
      recheckFailedJob: jest.fn(),
      detectAndRequeueIfUncompressed: jest.fn(),
      resolveDecision: jest.fn(),
    };

    const delegationService = {
      delegateJob: jest.fn(),
      rebalanceJobs: jest.fn(),
      fixStuckTransfers: jest.fn(),
    };

    processingService = {
      getNextJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        { provide: QueueJobCrudService, useValue: jobCrudService },
        { provide: QueueJobStateService, useValue: jobStateService },
        { provide: QueueDelegationService, useValue: delegationService },
        { provide: QueueProcessingService, useValue: processingService },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
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
      jobCrudService.create.mockResolvedValue(mockJob);

      const result = await service.create(createDto);

      expect(result).toEqual(mockJob);
      expect(jobCrudService.create).toHaveBeenCalledWith(createDto);
    });

    it('should throw NotFoundException if node does not exist', async () => {
      jobCrudService.create.mockRejectedValue(
        new NotFoundException('Node with ID "node-1" not found')
      );

      await expect(service.create(createDto)).rejects.toThrow(NotFoundException);
      await expect(service.create(createDto)).rejects.toThrow('Node with ID "node-1" not found');
    });

    it('should throw NotFoundException if library does not exist', async () => {
      jobCrudService.create.mockRejectedValue(
        new NotFoundException('Library with ID "lib-1" not found')
      );

      await expect(service.create(createDto)).rejects.toThrow(NotFoundException);
      await expect(service.create(createDto)).rejects.toThrow('Library with ID "lib-1" not found');
    });

    it('should throw NotFoundException if policy does not exist', async () => {
      jobCrudService.create.mockRejectedValue(
        new NotFoundException('Policy with ID "policy-1" not found')
      );

      await expect(service.create(createDto)).rejects.toThrow(NotFoundException);
      await expect(service.create(createDto)).rejects.toThrow(
        'Policy with ID "policy-1" not found'
      );
    });
  });

  describe('findAll', () => {
    it('should return all jobs without filters', async () => {
      const mockJobs = [mockJobWithRelations];
      jobCrudService.findAll.mockResolvedValue({
        jobs: mockJobs,
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      });

      const result = await service.findAll();

      expect(result.jobs).toEqual(mockJobs);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(jobCrudService.findAll).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );
    });

    it('should filter jobs by stage', async () => {
      const mockJobs = [mockJobWithRelations];
      jobCrudService.findAll.mockResolvedValue({
        jobs: mockJobs,
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      });

      const result = await service.findAll(JobStage.QUEUED);

      expect(result.jobs).toEqual(mockJobs);
      expect(jobCrudService.findAll).toHaveBeenCalledWith(
        JobStage.QUEUED,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );
    });

    it('should filter jobs by node ID', async () => {
      const mockJobs = [mockJobWithRelations];
      jobCrudService.findAll.mockResolvedValue({
        jobs: mockJobs,
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      });

      const result = await service.findAll(undefined, 'node-1');

      expect(result.jobs).toEqual(mockJobs);
      expect(jobCrudService.findAll).toHaveBeenCalledWith(
        undefined,
        'node-1',
        undefined,
        undefined,
        undefined,
        undefined
      );
    });
  });

  describe('findOne', () => {
    it('should return a single job with full details', async () => {
      jobCrudService.findOne.mockResolvedValue(mockJobWithRelations);

      const result = await service.findOne('job-1');

      expect(result).toEqual(mockJobWithRelations);
      expect(jobCrudService.findOne).toHaveBeenCalledWith('job-1');
    });

    it('should throw NotFoundException if job does not exist', async () => {
      jobCrudService.findOne.mockRejectedValue(
        new NotFoundException('Job with ID "non-existent" not found')
      );

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('non-existent')).rejects.toThrow(
        'Job with ID "non-existent" not found'
      );
    });
  });

  describe('getNextJob', () => {
    it('should return next queued job and update to ENCODING stage', async () => {
      const updatedJob = {
        ...mockJobWithRelations,
        stage: JobStage.ENCODING,
        startedAt: new Date(),
        policy: mockPolicy,
      };

      processingService.getNextJob.mockResolvedValue(updatedJob);

      const result = await service.getNextJob('node-1');

      expect(result).not.toBeNull();
      expect(result?.stage).toBe(JobStage.ENCODING);
      expect(processingService.getNextJob).toHaveBeenCalledWith('node-1');
    });

    it('should return null if no queued jobs available', async () => {
      processingService.getNextJob.mockResolvedValue(null);

      const result = await service.getNextJob('node-1');

      expect(result).toBeNull();
    });

    it('should throw NotFoundException if node does not exist', async () => {
      processingService.getNextJob.mockRejectedValue(new NotFoundException('Node not found'));

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
      jobCrudService.updateProgress.mockResolvedValue(updatedJob);

      const result = await service.updateProgress('job-1', updateDto);

      expect(result).toEqual(updatedJob);
      expect(jobCrudService.updateProgress).toHaveBeenCalledWith('job-1', updateDto);
    });

    it('should throw NotFoundException if job does not exist', async () => {
      jobCrudService.updateProgress.mockRejectedValue(new NotFoundException('Job not found'));

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

      jobStateService.completeJob.mockResolvedValue(completedJob);

      const result = await service.completeJob('job-1', completeDto);

      expect(result.stage).toBe(JobStage.COMPLETED);
      expect(result.progress).toBe(100);
      expect(jobStateService.completeJob).toHaveBeenCalledWith('job-1', completeDto);
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

      jobStateService.failJob.mockResolvedValue(failedJob);

      const result = await service.failJob('job-1', errorMessage);

      expect(result.stage).toBe(JobStage.FAILED);
      expect(result.error).toBe(errorMessage);
      expect(jobStateService.failJob).toHaveBeenCalledWith('job-1', errorMessage);
    });
  });

  describe('cancelJob', () => {
    it('should cancel a queued job', async () => {
      const cancelledJob = {
        ...mockJob,
        stage: JobStage.CANCELLED,
        completedAt: new Date(),
      };

      jobStateService.cancelJob.mockResolvedValue(cancelledJob);

      const result = await service.cancelJob('job-1');

      expect(result.stage).toBe(JobStage.CANCELLED);
      expect(jobStateService.cancelJob).toHaveBeenCalledWith('job-1', false);
    });

    it('should throw NotFoundException if job does not exist', async () => {
      jobStateService.cancelJob.mockRejectedValue(new NotFoundException('Job not found'));

      await expect(service.cancelJob('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if job is already completed', async () => {
      jobStateService.cancelJob.mockRejectedValue(
        new BadRequestException('Cannot cancel a completed job')
      );

      await expect(service.cancelJob('job-1')).rejects.toThrow(BadRequestException);
      await expect(service.cancelJob('job-1')).rejects.toThrow('Cannot cancel a completed job');
    });
  });

  describe('remove', () => {
    it('should delete a job successfully', async () => {
      jobCrudService.remove.mockResolvedValue(undefined);

      await service.remove('job-1');

      expect(jobCrudService.remove).toHaveBeenCalledWith('job-1');
    });

    it('should throw NotFoundException if job does not exist', async () => {
      jobCrudService.remove.mockRejectedValue(new NotFoundException('Job not found'));

      await expect(service.remove('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getJobStats', () => {
    it('should return job statistics without node filter', async () => {
      const mockStats = {
        detected: 0,
        healthCheck: 0,
        needsDecision: 0,
        queued: 42,
        transferring: 0,
        encoding: 3,
        verifying: 0,
        completed: 150,
        failed: 5,
        cancelled: 0,
        totalSavedBytes: '536870912000',
      };

      jobCrudService.getJobStats.mockResolvedValue(mockStats);

      const result = await service.getJobStats();

      expect(result.completed).toBe(150);
      expect(result.failed).toBe(5);
      expect(result.encoding).toBe(3);
      expect(result.queued).toBe(42);
      expect(result.totalSavedBytes).toBe('536870912000');
      expect(jobCrudService.getJobStats).toHaveBeenCalledWith(undefined);
    });

    it('should return job statistics filtered by node', async () => {
      const mockStats = {
        detected: 0,
        healthCheck: 0,
        needsDecision: 0,
        queued: 10,
        transferring: 0,
        encoding: 1,
        verifying: 0,
        completed: 50,
        failed: 2,
        cancelled: 0,
        totalSavedBytes: '100000000000',
      };

      jobCrudService.getJobStats.mockResolvedValue(mockStats);

      const result = await service.getJobStats('node-1');

      expect(result.completed).toBe(50);
      expect(result.failed).toBe(2);
      expect(result.encoding).toBe(1);
      expect(result.queued).toBe(10);
      expect(result.totalSavedBytes).toBe('100000000000');
      expect(jobCrudService.getJobStats).toHaveBeenCalledWith('node-1');
    });
  });
});
