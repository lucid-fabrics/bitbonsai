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
import {
  EncodingCancelledEvent,
  EncodingFailedEvent,
  EncodingPreviewUpdateEvent,
  EncodingProcessMarkedEvent,
  EncodingProgressUpdateEvent,
} from '../../../common/events';
import { QueueService } from '../../queue.service';
import { QueueDelegationService } from '../../services/queue-delegation.service';
import { QueueJobCrudService } from '../../services/queue-job-crud.service';
import { QueueJobStateService } from '../../services/queue-job-state.service';
import { QueueProcessingService } from '../../services/queue-processing.service';

describe('QueueService', () => {
  let service: QueueService;
  let jobCrudService: Record<string, jest.Mock>;
  let jobStateService: Record<string, jest.Mock>;
  let delegationService: Record<string, jest.Mock>;
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

    delegationService = {
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

  // ─── QueueJobCrudService additional methods ─────────────────────────

  describe('getJobStatus', () => {
    it('should return job status object when job exists', async () => {
      const mockStatus = {
        pauseRequestedAt: null,
        pauseProcessedAt: null,
        cancelRequestedAt: new Date(),
        cancelProcessedAt: null,
      };
      jobCrudService.getJobStatus.mockResolvedValue(mockStatus);

      const result = await service.getJobStatus('job-1');

      expect(result).toEqual(mockStatus);
      expect(jobCrudService.getJobStatus).toHaveBeenCalledWith('job-1');
    });

    it('should return null when job does not exist', async () => {
      jobCrudService.getJobStatus.mockResolvedValue(null);

      const result = await service.getJobStatus('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('updateJobRaw', () => {
    it('should delegate raw update to jobCrudService', async () => {
      jobCrudService.updateJobRaw.mockResolvedValue(undefined);

      await service.updateJobRaw('job-1', { cancelRequestedAt: new Date() });

      expect(jobCrudService.updateJobRaw).toHaveBeenCalledWith('job-1', {
        cancelRequestedAt: expect.any(Date),
      });
    });
  });

  describe('updateJobPreview', () => {
    it('should update preview paths and return updated job', async () => {
      const previewPaths = ['/tmp/preview_1.jpg', '/tmp/preview_2.jpg'];
      const updatedJob = { ...mockJob, previewPaths };
      jobCrudService.updateJobPreview.mockResolvedValue(updatedJob);

      const result = await service.updateJobPreview('job-1', previewPaths);

      expect(result).toEqual(updatedJob);
      expect(jobCrudService.updateJobPreview).toHaveBeenCalledWith('job-1', previewPaths);
    });
  });

  describe('update', () => {
    it('should update job with Prisma input and return updated job', async () => {
      const updateData = { progress: 75 };
      const updatedJob = { ...mockJob, progress: 75 };
      jobCrudService.update.mockResolvedValue(updatedJob);

      const result = await service.update('job-1', updateData);

      expect(result).toEqual(updatedJob);
      expect(jobCrudService.update).toHaveBeenCalledWith('job-1', updateData);
    });
  });

  describe('clearJobs', () => {
    it('should clear all jobs when no stage filter provided', async () => {
      jobCrudService.clearJobs.mockResolvedValue(42);

      const result = await service.clearJobs();

      expect(result).toBe(42);
      expect(jobCrudService.clearJobs).toHaveBeenCalledWith(undefined);
    });

    it('should clear jobs for specified stages', async () => {
      jobCrudService.clearJobs.mockResolvedValue(10);

      const result = await service.clearJobs([JobStage.COMPLETED, JobStage.CANCELLED]);

      expect(result).toBe(10);
      expect(jobCrudService.clearJobs).toHaveBeenCalledWith([
        JobStage.COMPLETED,
        JobStage.CANCELLED,
      ]);
    });
  });

  // ─── QueueJobStateService additional methods ────────────────────────

  describe('unblacklistJob', () => {
    it('should unblacklist a job and return updated job', async () => {
      const unblacklistedJob = { ...mockJob, stage: JobStage.QUEUED };
      jobStateService.unblacklistJob.mockResolvedValue(unblacklistedJob);

      const result = await service.unblacklistJob('job-1');

      expect(result).toEqual(unblacklistedJob);
      expect(jobStateService.unblacklistJob).toHaveBeenCalledWith('job-1');
    });
  });

  describe('cancelAllQueued', () => {
    it('should cancel all queued jobs and return count', async () => {
      jobStateService.cancelAllQueued.mockResolvedValue({ cancelledCount: 15 });

      const result = await service.cancelAllQueued();

      expect(result.cancelledCount).toBe(15);
      expect(jobStateService.cancelAllQueued).toHaveBeenCalled();
    });

    it('should return zero when no queued jobs exist', async () => {
      jobStateService.cancelAllQueued.mockResolvedValue({ cancelledCount: 0 });

      const result = await service.cancelAllQueued();

      expect(result.cancelledCount).toBe(0);
    });
  });

  describe('pauseJob', () => {
    it('should pause a job and return updated job', async () => {
      const pausedJob = { ...mockJob, stage: JobStage.ENCODING };
      jobStateService.pauseJob.mockResolvedValue(pausedJob);

      const result = await service.pauseJob('job-1');

      expect(result).toEqual(pausedJob);
      expect(jobStateService.pauseJob).toHaveBeenCalledWith('job-1');
    });

    it('should throw NotFoundException if job does not exist', async () => {
      jobStateService.pauseJob.mockRejectedValue(new NotFoundException('Job not found'));

      await expect(service.pauseJob('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('resumeJob', () => {
    it('should resume a paused job', async () => {
      const resumedJob = { ...mockJob, stage: JobStage.ENCODING };
      jobStateService.resumeJob.mockResolvedValue(resumedJob);

      const result = await service.resumeJob('job-1');

      expect(result).toEqual(resumedJob);
      expect(jobStateService.resumeJob).toHaveBeenCalledWith('job-1');
    });
  });

  describe('retryJob', () => {
    it('should retry a failed job and requeue it', async () => {
      const requeuedJob = { ...mockJob, stage: JobStage.QUEUED, error: null };
      jobStateService.retryJob.mockResolvedValue(requeuedJob);

      const result = await service.retryJob('job-1');

      expect(result.stage).toBe(JobStage.QUEUED);
      expect(jobStateService.retryJob).toHaveBeenCalledWith('job-1');
    });
  });

  describe('forceStartJob', () => {
    it('should force start a job bypassing normal queue order', async () => {
      const startedJob = { ...mockJob, stage: JobStage.ENCODING };
      jobStateService.forceStartJob.mockResolvedValue(startedJob);

      const result = await service.forceStartJob('job-1');

      expect(result).toEqual(startedJob);
      expect(jobStateService.forceStartJob).toHaveBeenCalledWith('job-1');
    });
  });

  describe('recheckHealth', () => {
    it('should trigger health recheck for a job', async () => {
      const recheckedJob = { ...mockJob, stage: JobStage.HEALTH_CHECK };
      jobStateService.recheckHealth.mockResolvedValue(recheckedJob);

      const result = await service.recheckHealth('job-1');

      expect(result).toEqual(recheckedJob);
      expect(jobStateService.recheckHealth).toHaveBeenCalledWith('job-1');
    });
  });

  describe('retryAllCancelled', () => {
    it('should retry all cancelled jobs and return summary', async () => {
      const mockResult = {
        retriedCount: 3,
        totalSizeBytes: '32212254720',
        jobs: [
          { id: 'job-1', fileLabel: 'Avatar.mkv', beforeSizeBytes: BigInt(10737418240) },
          { id: 'job-2', fileLabel: 'Dune.mkv', beforeSizeBytes: BigInt(10737418240) },
          { id: 'job-3', fileLabel: 'Interstellar.mkv', beforeSizeBytes: BigInt(10737418240) },
        ],
      };
      jobStateService.retryAllCancelled.mockResolvedValue(mockResult);

      const result = await service.retryAllCancelled();

      expect(result.retriedCount).toBe(3);
      expect(result.jobs).toHaveLength(3);
      expect(jobStateService.retryAllCancelled).toHaveBeenCalled();
    });
  });

  describe('retryAllFailed', () => {
    it('should retry all failed jobs without error filter', async () => {
      const mockResult = {
        retriedCount: 2,
        jobs: [
          { id: 'job-1', fileLabel: 'Avatar.mkv', error: 'FFmpeg crash' },
          { id: 'job-2', fileLabel: 'Dune.mkv', error: 'FFmpeg crash' },
        ],
      };
      jobStateService.retryAllFailed.mockResolvedValue(mockResult);

      const result = await service.retryAllFailed();

      expect(result.retriedCount).toBe(2);
      expect(jobStateService.retryAllFailed).toHaveBeenCalledWith(undefined);
    });

    it('should filter by error string when provided', async () => {
      const mockResult = {
        retriedCount: 1,
        jobs: [{ id: 'job-1', fileLabel: 'Avatar.mkv', error: 'FFmpeg crash' }],
      };
      jobStateService.retryAllFailed.mockResolvedValue(mockResult);

      await service.retryAllFailed('FFmpeg crash');

      expect(jobStateService.retryAllFailed).toHaveBeenCalledWith('FFmpeg crash');
    });
  });

  describe('skipAllCodecMatch', () => {
    it('should skip all codec-match jobs and return summary', async () => {
      const mockResult = {
        skippedCount: 5,
        jobs: [{ id: 'job-1', fileLabel: 'Avatar.mkv', sourceCodec: 'HEVC', targetCodec: 'HEVC' }],
      };
      jobStateService.skipAllCodecMatch.mockResolvedValue(mockResult);

      const result = await service.skipAllCodecMatch();

      expect(result.skippedCount).toBe(5);
      expect(jobStateService.skipAllCodecMatch).toHaveBeenCalled();
    });
  });

  describe('forceEncodeAllCodecMatch', () => {
    it('should force encode all codec-match jobs and return summary', async () => {
      const mockResult = {
        queuedCount: 4,
        jobs: [{ id: 'job-1', fileLabel: 'Avatar.mkv', sourceCodec: 'HEVC', targetCodec: 'HEVC' }],
      };
      jobStateService.forceEncodeAllCodecMatch.mockResolvedValue(mockResult);

      const result = await service.forceEncodeAllCodecMatch();

      expect(result.queuedCount).toBe(4);
      expect(jobStateService.forceEncodeAllCodecMatch).toHaveBeenCalled();
    });
  });

  describe('updateJobPriority', () => {
    it('should update job priority and return updated job', async () => {
      const updatedJob = { ...mockJob };
      jobStateService.updateJobPriority.mockResolvedValue(updatedJob);

      const result = await service.updateJobPriority('job-1', 1);

      expect(result).toEqual(updatedJob);
      expect(jobStateService.updateJobPriority).toHaveBeenCalledWith('job-1', 1);
    });
  });

  describe('requestKeepOriginal', () => {
    it('should request keep-original flag on a job', async () => {
      const updatedJob = { ...mockJob };
      jobStateService.requestKeepOriginal.mockResolvedValue(updatedJob);

      const result = await service.requestKeepOriginal('job-1');

      expect(result).toEqual(updatedJob);
      expect(jobStateService.requestKeepOriginal).toHaveBeenCalledWith('job-1');
    });
  });

  describe('deleteOriginalBackup', () => {
    it('should delete original backup and return freed space', async () => {
      jobStateService.deleteOriginalBackup.mockResolvedValue({ freedSpace: BigInt(5368709120) });

      const result = await service.deleteOriginalBackup('job-1');

      expect(result.freedSpace).toBe(BigInt(5368709120));
      expect(jobStateService.deleteOriginalBackup).toHaveBeenCalledWith('job-1');
    });
  });

  describe('restoreOriginal', () => {
    it('should restore original file and return updated job', async () => {
      const restoredJob = { ...mockJob };
      jobStateService.restoreOriginal.mockResolvedValue(restoredJob);

      const result = await service.restoreOriginal('job-1');

      expect(result).toEqual(restoredJob);
      expect(jobStateService.restoreOriginal).toHaveBeenCalledWith('job-1');
    });
  });

  describe('recheckFailedJob', () => {
    it('should re-check a failed job and return updated job', async () => {
      const recheckedJob = { ...mockJob, stage: JobStage.HEALTH_CHECK };
      jobStateService.recheckFailedJob.mockResolvedValue(recheckedJob);

      const result = await service.recheckFailedJob('job-1');

      expect(result).toEqual(recheckedJob);
      expect(jobStateService.recheckFailedJob).toHaveBeenCalledWith('job-1');
    });
  });

  describe('detectAndRequeueIfUncompressed', () => {
    it('should detect and requeue an uncompressed job', async () => {
      const requeuedJob = { ...mockJob, stage: JobStage.QUEUED };
      jobStateService.detectAndRequeueIfUncompressed.mockResolvedValue(requeuedJob);

      const result = await service.detectAndRequeueIfUncompressed('job-1');

      expect(result).toEqual(requeuedJob);
      expect(jobStateService.detectAndRequeueIfUncompressed).toHaveBeenCalledWith('job-1');
    });
  });

  describe('resolveDecision', () => {
    it('should resolve a decision without data', async () => {
      const resolvedJob = { ...mockJob, stage: JobStage.QUEUED };
      jobStateService.resolveDecision.mockResolvedValue(resolvedJob);

      const result = await service.resolveDecision('job-1');

      expect(result).toEqual(resolvedJob);
      expect(jobStateService.resolveDecision).toHaveBeenCalledWith('job-1', undefined);
    });

    it('should resolve a decision with data payload', async () => {
      const resolvedJob = { ...mockJob, stage: JobStage.QUEUED };
      const decisionData = { action: 'encode', keepOriginal: true };
      jobStateService.resolveDecision.mockResolvedValue(resolvedJob);

      const result = await service.resolveDecision('job-1', decisionData);

      expect(result).toEqual(resolvedJob);
      expect(jobStateService.resolveDecision).toHaveBeenCalledWith('job-1', decisionData);
    });
  });

  // ─── QueueDelegationService methods ────────────────────────────────

  describe('delegateJob', () => {
    it('should delegate a job to a target node', async () => {
      const delegatedJob = { ...mockJob, nodeId: 'node-2' };
      delegationService.delegateJob.mockResolvedValue(delegatedJob);

      const result = await service.delegateJob('job-1', 'node-2');

      expect(result).toEqual(delegatedJob);
      expect(delegationService.delegateJob).toHaveBeenCalledWith('job-1', 'node-2');
    });

    it('should throw NotFoundException if target node does not exist', async () => {
      delegationService.delegateJob.mockRejectedValue(
        new NotFoundException('Node "node-99" not found')
      );

      await expect(service.delegateJob('job-1', 'node-99')).rejects.toThrow(NotFoundException);
    });
  });

  describe('rebalanceJobs', () => {
    it('should rebalance jobs across nodes and return moved count', async () => {
      delegationService.rebalanceJobs.mockResolvedValue(3);

      const result = await service.rebalanceJobs();

      expect(result).toBe(3);
      expect(delegationService.rebalanceJobs).toHaveBeenCalled();
    });

    it('should return zero when no rebalancing is needed', async () => {
      delegationService.rebalanceJobs.mockResolvedValue(0);

      const result = await service.rebalanceJobs();

      expect(result).toBe(0);
    });
  });

  describe('fixStuckTransfers', () => {
    it('should fix stuck transfers and return fixed count', async () => {
      delegationService.fixStuckTransfers.mockResolvedValue(2);

      const result = await service.fixStuckTransfers();

      expect(result).toBe(2);
      expect(delegationService.fixStuckTransfers).toHaveBeenCalled();
    });
  });

  // ─── Event Handlers ─────────────────────────────────────────────────

  describe('handleEncodingProgressUpdate', () => {
    it('should update progress when encoding progress event is received', async () => {
      jobCrudService.updateProgress.mockResolvedValue(mockJob);
      const event = new EncodingProgressUpdateEvent('job-1', {
        progress: 60,
        etaSeconds: 300,
        fps: 24,
        resumeTimestamp: '00:01:00.000',
        tempFilePath: '/tmp/job-1.mkv',
      });

      await service.handleEncodingProgressUpdate(event);

      expect(jobCrudService.updateProgress).toHaveBeenCalledWith('job-1', {
        progress: 60,
        etaSeconds: 300,
        fps: 24,
        resumeTimestamp: '00:01:00.000',
        tempFilePath: '/tmp/job-1.mkv',
      });
    });

    it('should silently swallow errors from updateProgress', async () => {
      jobCrudService.updateProgress.mockRejectedValue(new Error('DB write failed'));
      const event = new EncodingProgressUpdateEvent('job-1', {
        progress: 60,
        etaSeconds: 300,
        fps: 24,
      });

      await expect(service.handleEncodingProgressUpdate(event)).resolves.not.toThrow();
    });
  });

  describe('handleEncodingPreviewUpdate', () => {
    it('should update preview paths when preview event is received', async () => {
      jobCrudService.updateJobPreview.mockResolvedValue(mockJob);
      const event = new EncodingPreviewUpdateEvent('job-1', ['/tmp/p1.jpg', '/tmp/p2.jpg']);

      await service.handleEncodingPreviewUpdate(event);

      expect(jobCrudService.updateJobPreview).toHaveBeenCalledWith('job-1', [
        '/tmp/p1.jpg',
        '/tmp/p2.jpg',
      ]);
    });

    it('should silently swallow errors from updateJobPreview', async () => {
      jobCrudService.updateJobPreview.mockRejectedValue(new Error('Storage unavailable'));
      const event = new EncodingPreviewUpdateEvent('job-1', ['/tmp/p1.jpg']);

      await expect(service.handleEncodingPreviewUpdate(event)).resolves.not.toThrow();
    });
  });

  describe('handleEncodingFailed', () => {
    it('should fail the job when encoding failed event is received', async () => {
      jobStateService.failJob.mockResolvedValue({ ...mockJob, stage: JobStage.FAILED });
      const event = new EncodingFailedEvent('job-1', 'FFmpeg: codec not supported');

      await service.handleEncodingFailed(event);

      expect(jobStateService.failJob).toHaveBeenCalledWith('job-1', 'FFmpeg: codec not supported');
    });

    it('should silently swallow errors from failJob', async () => {
      jobStateService.failJob.mockRejectedValue(new Error('Job already deleted'));
      const event = new EncodingFailedEvent('job-1', 'FFmpeg crash');

      await expect(service.handleEncodingFailed(event)).resolves.not.toThrow();
    });
  });

  describe('handleEncodingCancelled', () => {
    it('should cancel the job when encoding cancelled event is received', async () => {
      jobStateService.cancelJob.mockResolvedValue({ ...mockJob, stage: JobStage.CANCELLED });
      const event = new EncodingCancelledEvent('job-1');

      await service.handleEncodingCancelled(event);

      expect(jobStateService.cancelJob).toHaveBeenCalledWith('job-1', false);
    });

    it('should silently swallow errors from cancelJob', async () => {
      jobStateService.cancelJob.mockRejectedValue(new Error('Job not found'));
      const event = new EncodingCancelledEvent('job-1');

      await expect(service.handleEncodingCancelled(event)).resolves.not.toThrow();
    });
  });

  describe('handleEncodingProcessMarked', () => {
    it('should update raw job fields when process-marked event is received', async () => {
      jobCrudService.updateJobRaw.mockResolvedValue(undefined);
      const updates = { cancelProcessedAt: new Date('2024-01-01T00:00:00.000Z') };
      const event = new EncodingProcessMarkedEvent('job-1', updates);

      await service.handleEncodingProcessMarked(event);

      expect(jobCrudService.updateJobRaw).toHaveBeenCalledWith('job-1', updates);
    });

    it('should silently swallow errors from updateJobRaw', async () => {
      jobCrudService.updateJobRaw.mockRejectedValue(new Error('Prisma error'));
      const event = new EncodingProcessMarkedEvent('job-1', {
        pauseProcessedAt: new Date(),
      });

      await expect(service.handleEncodingProcessMarked(event)).resolves.not.toThrow();
    });
  });

  // ── non-Error thrown values (covers `instanceof Error ? ... : 'Unknown error'`) ──

  describe('handleEncodingProgressUpdate — non-Error thrown value', () => {
    it('handles string thrown without crashing', async () => {
      jobCrudService.updateProgress.mockRejectedValue('string error');
      const event = new EncodingProgressUpdateEvent('job-1', {
        progress: 50,
        etaSeconds: 100,
        fps: 24,
      });

      await expect(service.handleEncodingProgressUpdate(event)).resolves.not.toThrow();
    });
  });

  describe('handleEncodingPreviewUpdate — non-Error thrown value', () => {
    it('handles plain object thrown without crashing', async () => {
      jobCrudService.updateJobPreview.mockRejectedValue({ code: 500 });
      const event = new EncodingPreviewUpdateEvent('job-1', ['/tmp/p1.jpg']);

      await expect(service.handleEncodingPreviewUpdate(event)).resolves.not.toThrow();
    });
  });

  describe('handleEncodingFailed — non-Error thrown value', () => {
    it('handles number thrown without crashing', async () => {
      jobStateService.failJob.mockRejectedValue(42);
      const event = new EncodingFailedEvent('job-1', 'crash');

      await expect(service.handleEncodingFailed(event)).resolves.not.toThrow();
    });
  });

  describe('handleEncodingCancelled — non-Error thrown value', () => {
    it('handles null thrown without crashing', async () => {
      jobStateService.cancelJob.mockRejectedValue(null);
      const event = new EncodingCancelledEvent('job-1');

      await expect(service.handleEncodingCancelled(event)).resolves.not.toThrow();
    });
  });

  describe('handleEncodingProcessMarked — non-Error thrown value', () => {
    it('handles string thrown without crashing', async () => {
      jobCrudService.updateJobRaw.mockRejectedValue('unexpected string');
      const event = new EncodingProcessMarkedEvent('job-1', { pauseProcessedAt: new Date() });

      await expect(service.handleEncodingProcessMarked(event)).resolves.not.toThrow();
    });
  });
});
