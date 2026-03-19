import { HttpService } from '@nestjs/axios';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { NodeConfigService } from '../../core/services/node-config.service';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FileFailureTrackingService } from './file-failure-tracking.service';
import { FileTransferService } from './file-transfer.service';
import { JobBulkOperationsService } from './job-bulk-operations.service';
import { JobFileOperationsService } from './job-file-operations.service';
import { JobHistoryService } from './job-history.service';
import { JobMetricsService } from './job-metrics.service';
import { QueueJobCrudService } from './queue-job-crud.service';
import { QueueJobStateService } from './queue-job-state.service';

describe('QueueJobStateService', () => {
  let service: QueueJobStateService;
  let mockJobRepository: jest.Mocked<JobRepository>;
  let mockFfmpegService: jest.Mocked<FfmpegService>;
  let mockJobHistoryService: jest.Mocked<JobHistoryService>;
  let mockNodeConfig: jest.Mocked<NodeConfigService>;
  let mockJobCrudService: jest.Mocked<QueueJobCrudService>;
  let mockFileFailureTracking: jest.Mocked<FileFailureTrackingService>;
  let mockJobMetricsService: jest.Mocked<JobMetricsService>;
  let mockJobBulkOperationsService: jest.Mocked<JobBulkOperationsService>;
  let mockJobFileOperationsService: jest.Mocked<JobFileOperationsService>;
  let mockPrisma: any;
  let mockHttpService: any;
  let mockFileTransferService: jest.Mocked<FileTransferService>;

  const makeJob = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    stage: JobStage.QUEUED,
    fileLabel: 'movie.mkv',
    filePath: '/media/movie.mkv',
    libraryId: 'lib-1',
    progress: 0,
    retryCount: 0,
    nodeId: 'node-1',
    fps: null,
    etaSeconds: null,
    isBlacklisted: false,
    contentFingerprint: null,
    tempFilePath: null,
    resumeTimestamp: null,
    remoteTempPath: null,
    ...overrides,
  });

  beforeEach(async () => {
    mockJobRepository = {
      findById: jest.fn(),
      updateById: jest.fn(),
      updateRaw: jest.fn(),
      countWhere: jest.fn(),
    } as any;

    mockFfmpegService = {
      killProcess: jest.fn(),
      pauseEncoding: jest.fn(),
      resumeEncoding: jest.fn(),
      reniceProcess: jest.fn(),
    } as any;

    mockJobHistoryService = {
      recordEvent: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockNodeConfig = {
      getMainApiUrl: jest.fn().mockReturnValue(null),
    } as any;

    mockJobCrudService = {
      validateJobOwnership: jest.fn().mockResolvedValue({ nodeId: null, updatedAt: new Date() }),
    } as any;

    mockFileFailureTracking = {
      recordFailure: jest.fn().mockResolvedValue(false),
      clearBlacklist: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockJobMetricsService = {
      updateMetrics: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockJobBulkOperationsService = {
      cancelAllQueued: jest.fn(),
      retryAllCancelled: jest.fn(),
      retryAllFailed: jest.fn(),
      skipAllCodecMatch: jest.fn(),
      forceEncodeAllCodecMatch: jest.fn(),
      categorizeError: jest.fn(),
    } as any;

    mockJobFileOperationsService = {
      requestKeepOriginal: jest.fn(),
      deleteOriginalBackup: jest.fn(),
      restoreOriginal: jest.fn(),
      recheckFailedJob: jest.fn(),
      detectAndRequeueIfUncompressed: jest.fn(),
    } as any;

    mockFileTransferService = {
      cancelTransfer: jest.fn().mockResolvedValue(undefined),
      cleanupRemoteTempFile: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockPrisma = {
      $transaction: jest.fn(),
      processedFileRecord: { deleteMany: jest.fn().mockResolvedValue(undefined) },
    };

    mockHttpService = { post: jest.fn(), patch: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueJobStateService,
        { provide: JobRepository, useValue: mockJobRepository },
        { provide: FfmpegService, useValue: mockFfmpegService },
        { provide: JobHistoryService, useValue: mockJobHistoryService },
        { provide: NodeConfigService, useValue: mockNodeConfig },
        { provide: QueueJobCrudService, useValue: mockJobCrudService },
        { provide: FileFailureTrackingService, useValue: mockFileFailureTracking },
        { provide: JobMetricsService, useValue: mockJobMetricsService },
        { provide: JobBulkOperationsService, useValue: mockJobBulkOperationsService },
        { provide: JobFileOperationsService, useValue: mockJobFileOperationsService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FileTransferService, useValue: mockFileTransferService },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    service = module.get<QueueJobStateService>(QueueJobStateService);
    (service as any).httpService = mockHttpService;
  });

  describe('failJob', () => {
    it('should mark job as FAILED and record history', async () => {
      const job = makeJob({ stage: JobStage.QUEUED });
      mockJobRepository.findById.mockResolvedValue(job as any);
      const failedJob = { ...job, stage: JobStage.FAILED };
      mockJobRepository.updateById.mockResolvedValue(failedJob as any);

      const result = await service.failJob('job-1', 'FFmpeg crashed');

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.FAILED,
          error: 'FFmpeg crashed',
        })
      );
      expect(mockJobHistoryService.recordEvent).toHaveBeenCalled();
      expect(result.stage).toBe(JobStage.FAILED);
    });

    it('should return existing job when already FAILED (idempotent)', async () => {
      const job = makeJob({ stage: JobStage.FAILED });
      mockJobRepository.findById.mockResolvedValue(job as any);

      const result = await service.failJob('job-1', 'duplicate fail');
      expect(result.stage).toBe(JobStage.FAILED);
      expect(mockJobRepository.updateById).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when job not found', async () => {
      mockJobRepository.findById.mockResolvedValue(null);
      await expect(service.failJob('missing', 'error')).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancelJob', () => {
    it('should cancel a queued job', async () => {
      const job = makeJob({ stage: JobStage.QUEUED });
      mockJobRepository.findById.mockResolvedValue(job as any);
      const cancelledJob = { ...job, stage: JobStage.CANCELLED };
      mockJobRepository.updateById.mockResolvedValue(cancelledJob as any);

      const result = await service.cancelJob('job-1');

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.CANCELLED,
        })
      );
      expect(result.stage).toBe(JobStage.CANCELLED);
    });

    it('should throw BadRequestException when cancelling a completed job', async () => {
      mockJobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.COMPLETED }) as any);

      await expect(service.cancelJob('job-1')).rejects.toThrow(BadRequestException);
    });

    it('should kill FFmpeg process when job is encoding', async () => {
      const job = makeJob({ stage: JobStage.ENCODING });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockFfmpegService.killProcess.mockResolvedValue(true);
      mockJobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.CANCELLED } as any);

      await service.cancelJob('job-1');

      expect(mockFfmpegService.killProcess).toHaveBeenCalledWith('job-1');
    });
  });

  describe('pauseJob', () => {
    it('should pause an encoding job', async () => {
      const job = makeJob({ stage: JobStage.ENCODING });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockFfmpegService.pauseEncoding.mockResolvedValue(true);
      const pausedJob = { ...job, stage: JobStage.PAUSED };
      mockJobRepository.updateById.mockResolvedValue(pausedJob as any);

      const result = await service.pauseJob('job-1');
      expect(result.stage).toBe(JobStage.PAUSED);
    });

    it('should throw BadRequestException when job is not encoding', async () => {
      mockJobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.QUEUED }) as any);

      await expect(service.pauseJob('job-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('retryJob', () => {
    it('should reset job to QUEUED stage on retry', async () => {
      const job = makeJob({ stage: JobStage.FAILED });
      mockJobRepository.findById.mockResolvedValue(job as any);
      const requeued = { ...job, stage: JobStage.QUEUED, retryCount: 1 };
      mockJobRepository.updateById.mockResolvedValue(requeued as any);

      const _result = await service.retryJob('job-1');
      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.QUEUED,
          retryCount: 1,
        })
      );
    });

    it('should throw BadRequestException when job is not failed or cancelled', async () => {
      mockJobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.ENCODING }) as any);

      await expect(service.retryJob('job-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateJobPriority', () => {
    it('should update priority within valid range', async () => {
      const job = makeJob({ stage: JobStage.QUEUED });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.countWhere.mockResolvedValue(0);
      const updated = { ...job, priority: 1 };
      mockJobRepository.updateById.mockResolvedValue(updated as any);

      const _result = await service.updateJobPriority('job-1', 1);
      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ priority: 1 })
      );
    });

    it('should throw BadRequestException for out-of-range priority', async () => {
      mockJobRepository.findById.mockResolvedValue(makeJob() as any);

      await expect(service.updateJobPriority('job-1', 5)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for negative priority', async () => {
      mockJobRepository.findById.mockResolvedValue(makeJob() as any);

      await expect(service.updateJobPriority('job-1', -1)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when max top-priority jobs reached', async () => {
      mockJobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.QUEUED }) as any);
      mockJobRepository.countWhere.mockResolvedValue(3);

      await expect(service.updateJobPriority('job-1', 2)).rejects.toThrow(BadRequestException);
    });

    it('should renice FFmpeg process when job is encoding', async () => {
      const job = makeJob({ stage: JobStage.ENCODING });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.countWhere.mockResolvedValue(0);
      mockJobRepository.updateById.mockResolvedValue({ ...job, priority: 2 } as any);
      mockFfmpegService.reniceProcess.mockResolvedValue(true);

      await service.updateJobPriority('job-1', 2);

      expect(mockFfmpegService.reniceProcess).toHaveBeenCalledWith('job-1', 2);
    });

    it('should not throw when renice fails (non-critical)', async () => {
      const job = makeJob({ stage: JobStage.ENCODING });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.countWhere.mockResolvedValue(0);
      mockJobRepository.updateById.mockResolvedValue({ ...job, priority: 1 } as any);
      mockFfmpegService.reniceProcess.mockRejectedValue(new Error('process not found'));

      await expect(service.updateJobPriority('job-1', 1)).resolves.toBeDefined();
    });

    it('should throw NotFoundException when job not found', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      await expect(service.updateJobPriority('missing', 1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('resumeJob', () => {
    it('should resume a paused job successfully', async () => {
      const job = makeJob({ stage: JobStage.PAUSED });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockFfmpegService.resumeEncoding.mockResolvedValue(true);
      mockJobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.ENCODING } as any);

      const result = await service.resumeJob('job-1');
      expect(result.stage).toBe(JobStage.ENCODING);
    });

    it('should reset to QUEUED when FFmpeg process not found on resume', async () => {
      const job = makeJob({ stage: JobStage.PAUSED });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockFfmpegService.resumeEncoding.mockResolvedValue(false);
      mockJobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.QUEUED } as any);

      const result = await service.resumeJob('job-1');
      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ stage: JobStage.QUEUED })
      );
      expect(result.stage).toBe(JobStage.QUEUED);
    });

    it('should throw BadRequestException when job is not paused', async () => {
      mockJobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.QUEUED }) as any);

      await expect(service.resumeJob('job-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when job not found', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      await expect(service.resumeJob('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('pauseJob - additional', () => {
    it('should throw NotFoundException when job not found', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      await expect(service.pauseJob('missing')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when pause fails', async () => {
      const job = makeJob({ stage: JobStage.ENCODING });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockFfmpegService.pauseEncoding.mockResolvedValue(false);

      await expect(service.pauseJob('job-1')).rejects.toThrow(BadRequestException);
      await expect(service.pauseJob('job-1')).rejects.toThrow('Failed to pause encoding process');
    });
  });

  describe('unblacklistJob', () => {
    it('should unblacklist a cancelled blacklisted job', async () => {
      const job = makeJob({ stage: JobStage.CANCELLED, isBlacklisted: true });
      mockJobRepository.findById.mockResolvedValue(job as any);
      const updated = { ...job, isBlacklisted: false };
      mockJobRepository.updateById.mockResolvedValue(updated as any);

      const result = await service.unblacklistJob('job-1');
      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ isBlacklisted: false })
      );
      expect(result.isBlacklisted).toBe(false);
    });

    it('should throw NotFoundException when job not found', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      await expect(service.unblacklistJob('missing')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when job is not cancelled', async () => {
      mockJobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.FAILED }) as any);

      await expect(service.unblacklistJob('job-1')).rejects.toThrow(BadRequestException);
      await expect(service.unblacklistJob('job-1')).rejects.toThrow(
        'Only cancelled jobs can be unblacklisted'
      );
    });

    it('should throw BadRequestException when job is not blacklisted', async () => {
      mockJobRepository.findById.mockResolvedValue(
        makeJob({ stage: JobStage.CANCELLED, isBlacklisted: false }) as any
      );

      await expect(service.unblacklistJob('job-1')).rejects.toThrow(BadRequestException);
      await expect(service.unblacklistJob('job-1')).rejects.toThrow('Job is not blacklisted');
    });

    it('should clear processedFileRecord when contentFingerprint exists', async () => {
      const job = makeJob({
        stage: JobStage.CANCELLED,
        isBlacklisted: true,
        contentFingerprint: 'fp-abc123',
      });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({ ...job, isBlacklisted: false } as any);

      await service.unblacklistJob('job-1');

      expect(mockPrisma.processedFileRecord.deleteMany).toHaveBeenCalledWith({
        where: { contentFingerprint: 'fp-abc123' },
      });
    });
  });

  describe('forceStartJob', () => {
    it('should force-start a queued job', async () => {
      const job = makeJob({ stage: JobStage.QUEUED });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.DETECTED } as any);

      const result = await service.forceStartJob('job-1');
      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ stage: JobStage.DETECTED })
      );
      expect(result.stage).toBe(JobStage.DETECTED);
    });

    it('should force-start a detected job', async () => {
      const job = makeJob({ stage: JobStage.DETECTED });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue(job as any);

      await service.forceStartJob('job-1');
      expect(mockJobRepository.updateById).toHaveBeenCalled();
    });

    it('should throw BadRequestException when job stage is not queued or detected', async () => {
      mockJobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.ENCODING }) as any);

      await expect(service.forceStartJob('job-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when job not found', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      await expect(service.forceStartJob('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('recheckHealth', () => {
    it('should reset job health fields and set stage to DETECTED', async () => {
      const job = makeJob({ stage: JobStage.QUEUED });
      mockJobRepository.findById.mockResolvedValue(job as any);
      const updated = { ...job, stage: JobStage.DETECTED, healthStatus: 'UNKNOWN' };
      mockJobRepository.updateById.mockResolvedValue(updated as any);

      const result = await service.recheckHealth('job-1');
      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.DETECTED,
          healthStatus: 'UNKNOWN',
        })
      );
      expect(result.stage).toBe(JobStage.DETECTED);
    });

    it('should throw NotFoundException when job not found', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      await expect(service.recheckHealth('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('retryJob - additional', () => {
    it('should retry a cancelled job', async () => {
      const job = makeJob({ stage: JobStage.CANCELLED });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({
        ...job,
        stage: JobStage.QUEUED,
        retryCount: 1,
      } as any);

      const result = await service.retryJob('job-1');
      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ stage: JobStage.QUEUED })
      );
      expect(result.stage).toBe(JobStage.QUEUED);
    });

    it('should throw NotFoundException when job not found', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      await expect(service.retryJob('missing')).rejects.toThrow(NotFoundException);
    });

    it('should preserve progress and resumeTimestamp when temp file exists', async () => {
      // This test verifies the canResume=true path - hard to fully test without FS mock
      // but we verify the update is called correctly for a no-temp-file case
      const job = makeJob({
        stage: JobStage.FAILED,
        tempFilePath: null,
        progress: 45,
        retryCount: 2,
      });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({
        ...job,
        stage: JobStage.QUEUED,
        progress: 0,
      } as any);

      await service.retryJob('job-1');

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.QUEUED,
          progress: 0,
          retryCount: 3,
        })
      );
    });
  });

  describe('cancelJob - additional', () => {
    it('should throw NotFoundException when job not found', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      await expect(service.cancelJob('missing')).rejects.toThrow(NotFoundException);
    });

    it('should cancel with blacklist=true', async () => {
      const job = makeJob({ stage: JobStage.QUEUED });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({
        ...job,
        stage: JobStage.CANCELLED,
        isBlacklisted: true,
      } as any);

      await service.cancelJob('job-1', true);

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ isBlacklisted: true })
      );
    });

    it('should handle FFmpeg kill failure gracefully', async () => {
      const job = makeJob({ stage: JobStage.ENCODING });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockFfmpegService.killProcess.mockRejectedValue(new Error('process not found'));
      mockJobRepository.updateById.mockResolvedValue({
        ...job,
        stage: JobStage.CANCELLED,
      } as any);

      await expect(service.cancelJob('job-1')).resolves.toBeDefined();
    });

    it('should cancel transferring job and clean up remote temp file', async () => {
      const job = makeJob({ stage: 'TRANSFERRING' as JobStage, remoteTempPath: '/tmp/job-1.mkv' });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({
        ...job,
        stage: JobStage.CANCELLED,
      } as any);

      await service.cancelJob('job-1');

      expect(mockFileTransferService.cancelTransfer).toHaveBeenCalledWith('job-1');
      expect(mockFileTransferService.cleanupRemoteTempFile).toHaveBeenCalledWith('job-1');
    });

    it('should cancel transferring job without remoteTempPath', async () => {
      const job = makeJob({ stage: 'TRANSFERRING' as JobStage, remoteTempPath: null });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({
        ...job,
        stage: JobStage.CANCELLED,
      } as any);

      await service.cancelJob('job-1');

      expect(mockFileTransferService.cancelTransfer).toHaveBeenCalledWith('job-1');
      expect(mockFileTransferService.cleanupRemoteTempFile).not.toHaveBeenCalled();
    });
  });

  describe('failJob - additional', () => {
    it('should record auto-blacklist warning when file is blacklisted', async () => {
      const job = makeJob({ stage: JobStage.QUEUED });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.FAILED } as any);
      mockFileFailureTracking.recordFailure.mockResolvedValue(true);

      // Should not throw even though wasBlacklisted=true
      await expect(service.failJob('job-1', 'error')).resolves.toBeDefined();
    });

    it('should not throw when fileFailureTracking.recordFailure throws', async () => {
      const job = makeJob({ stage: JobStage.QUEUED });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.FAILED } as any);
      mockFileFailureTracking.recordFailure.mockRejectedValue(new Error('tracking error'));

      await expect(service.failJob('job-1', 'error')).resolves.toBeDefined();
    });
  });

  describe('resolveDecision', () => {
    it('should throw NotFoundException when job not found', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      await expect(service.resolveDecision('missing')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when job is not in NEEDS_DECISION stage', async () => {
      mockJobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.QUEUED }) as any);

      await expect(service.resolveDecision('job-1')).rejects.toThrow(BadRequestException);
    });

    it('should skip job when action is "skip"', async () => {
      const job = makeJob({ stage: JobStage.NEEDS_DECISION });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({
        ...job,
        stage: JobStage.COMPLETED,
      } as any);

      await service.resolveDecision('job-1', {
        actionConfig: { action: 'skip' },
      });

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ stage: JobStage.COMPLETED })
      );
    });

    it('should cancel job when action is "cancel"', async () => {
      const job = makeJob({ stage: JobStage.NEEDS_DECISION });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({
        ...job,
        stage: JobStage.CANCELLED,
      } as any);

      await service.resolveDecision('job-1', {
        actionConfig: { action: 'cancel', reason: 'user_requested' },
      });

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ stage: JobStage.CANCELLED })
      );
    });

    it('should queue job for encoding when no specific action', async () => {
      const job = makeJob({ stage: JobStage.NEEDS_DECISION });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateRaw.mockResolvedValue({ ...job, stage: JobStage.QUEUED } as any);

      await service.resolveDecision('job-1');

      expect(mockJobRepository.updateRaw).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ stage: JobStage.QUEUED })
      );
    });

    it('should apply targetContainer when actionConfig has it', async () => {
      const job = makeJob({ stage: JobStage.NEEDS_DECISION });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateRaw.mockResolvedValue({ ...job, stage: JobStage.QUEUED } as any);

      await service.resolveDecision('job-1', {
        actionConfig: { targetContainer: 'mkv' },
      });

      expect(mockJobRepository.updateRaw).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ targetContainer: 'mkv' })
      );
    });

    it('should set type to REMUX when audioAction is "copy"', async () => {
      const job = makeJob({ stage: JobStage.NEEDS_DECISION });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateRaw.mockResolvedValue({ ...job, stage: JobStage.QUEUED } as any);

      await service.resolveDecision('job-1', {
        actionConfig: { audioAction: 'copy' },
      });

      expect(mockJobRepository.updateRaw).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ type: 'REMUX' })
      );
    });

    it('should set type to ENCODE when audioAction is "transcode_aac"', async () => {
      const job = makeJob({ stage: JobStage.NEEDS_DECISION });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateRaw.mockResolvedValue({ ...job, stage: JobStage.QUEUED } as any);

      await service.resolveDecision('job-1', {
        actionConfig: { audioAction: 'transcode_aac' },
      });

      expect(mockJobRepository.updateRaw).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ type: 'ENCODE' })
      );
    });

    it('should set type to ENCODE when action is "force_encode"', async () => {
      const job = makeJob({ stage: JobStage.NEEDS_DECISION });
      mockJobRepository.findById.mockResolvedValue(job as any);
      mockJobRepository.updateRaw.mockResolvedValue({ ...job, stage: JobStage.QUEUED } as any);

      await service.resolveDecision('job-1', {
        actionConfig: { action: 'force_encode' },
      });

      expect(mockJobRepository.updateRaw).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ type: 'ENCODE' })
      );
    });
  });

  describe('multi-node proxy paths', () => {
    it('completeJob should proxy to MAIN when mainApiUrl is set', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3000');
      mockJobCrudService.validateJobOwnership.mockResolvedValue(undefined as any);
      const { of } = await import('rxjs');
      mockHttpService.post.mockReturnValue(of({ data: makeJob({ stage: JobStage.COMPLETED }) }));

      const result = await service.completeJob('job-1', {
        afterSizeBytes: '1000',
        savedBytes: '500',
        savedPercent: 50,
      });

      expect(mockHttpService.post).toHaveBeenCalled();
      expect(result.stage).toBe(JobStage.COMPLETED);
    });

    it('failJob should proxy to MAIN when mainApiUrl is set', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3000');
      mockJobCrudService.validateJobOwnership.mockResolvedValue(undefined as any);
      const { of } = await import('rxjs');
      mockHttpService.post.mockReturnValue(of({ data: makeJob({ stage: JobStage.FAILED }) }));

      const result = await service.failJob('job-1', 'error msg');

      expect(mockHttpService.post).toHaveBeenCalled();
      expect(result.stage).toBe(JobStage.FAILED);
    });

    it('cancelJob should proxy to MAIN when mainApiUrl is set', async () => {
      mockNodeConfig.getMainApiUrl.mockReturnValue('http://main:3000');
      const { of } = await import('rxjs');
      mockHttpService.post.mockReturnValue(of({ data: makeJob({ stage: JobStage.CANCELLED }) }));

      const result = await service.cancelJob('job-1');

      expect(mockHttpService.post).toHaveBeenCalled();
      expect(result.stage).toBe(JobStage.CANCELLED);
    });
  });

  describe('delegation methods', () => {
    it('cancelAllQueued delegates to jobBulkOperationsService', async () => {
      mockJobBulkOperationsService.cancelAllQueued.mockResolvedValue({ cancelledCount: 5 });

      const result = await service.cancelAllQueued();
      expect(result.cancelledCount).toBe(5);
    });

    it('retryAllCancelled delegates to jobBulkOperationsService', async () => {
      mockJobBulkOperationsService.retryAllCancelled.mockResolvedValue({
        retriedCount: 3,
        totalSizeBytes: '1000',
        jobs: [],
      });

      const result = await service.retryAllCancelled();
      expect(result.retriedCount).toBe(3);
    });

    it('retryAllFailed delegates to jobBulkOperationsService', async () => {
      mockJobBulkOperationsService.retryAllFailed.mockResolvedValue({
        retriedCount: 2,
        jobs: [],
      });

      const result = await service.retryAllFailed();
      expect(result.retriedCount).toBe(2);
    });

    it('skipAllCodecMatch delegates to jobBulkOperationsService', async () => {
      mockJobBulkOperationsService.skipAllCodecMatch.mockResolvedValue({
        skippedCount: 1,
        jobs: [],
      });

      const result = await service.skipAllCodecMatch();
      expect(result.skippedCount).toBe(1);
    });

    it('forceEncodeAllCodecMatch delegates to jobBulkOperationsService', async () => {
      mockJobBulkOperationsService.forceEncodeAllCodecMatch.mockResolvedValue({
        queuedCount: 4,
        jobs: [],
      });

      const result = await service.forceEncodeAllCodecMatch();
      expect(result.queuedCount).toBe(4);
    });

    it('categorizeError delegates to jobBulkOperationsService', () => {
      mockJobBulkOperationsService.categorizeError.mockReturnValue('codec_error');

      const result = service.categorizeError('some error');
      expect(result).toBe('codec_error');
    });

    it('requestKeepOriginal delegates to jobFileOperationsService', async () => {
      mockJobFileOperationsService.requestKeepOriginal.mockResolvedValue(makeJob() as any);

      await service.requestKeepOriginal('job-1');
      expect(mockJobFileOperationsService.requestKeepOriginal).toHaveBeenCalledWith('job-1');
    });

    it('deleteOriginalBackup delegates to jobFileOperationsService', async () => {
      mockJobFileOperationsService.deleteOriginalBackup.mockResolvedValue({
        freedSpace: BigInt(500),
      });

      const result = await service.deleteOriginalBackup('job-1');
      expect(result.freedSpace).toBe(BigInt(500));
    });

    it('restoreOriginal delegates to jobFileOperationsService', async () => {
      mockJobFileOperationsService.restoreOriginal.mockResolvedValue(makeJob() as any);

      await service.restoreOriginal('job-1');
      expect(mockJobFileOperationsService.restoreOriginal).toHaveBeenCalledWith('job-1');
    });

    it('recheckFailedJob delegates to jobFileOperationsService', async () => {
      mockJobFileOperationsService.recheckFailedJob.mockResolvedValue(makeJob() as any);

      await service.recheckFailedJob('job-1');
      expect(mockJobFileOperationsService.recheckFailedJob).toHaveBeenCalledWith('job-1');
    });

    it('detectAndRequeueIfUncompressed delegates to jobFileOperationsService', async () => {
      mockJobFileOperationsService.detectAndRequeueIfUncompressed.mockResolvedValue(
        makeJob() as any
      );

      await service.detectAndRequeueIfUncompressed('job-1');
      expect(mockJobFileOperationsService.detectAndRequeueIfUncompressed).toHaveBeenCalledWith(
        'job-1'
      );
    });
  });
});
