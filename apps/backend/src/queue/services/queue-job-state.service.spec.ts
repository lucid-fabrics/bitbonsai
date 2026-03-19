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

    it('should throw BadRequestException when max top-priority jobs reached', async () => {
      mockJobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.QUEUED }) as any);
      mockJobRepository.countWhere.mockResolvedValue(3);

      await expect(service.updateJobPriority('job-1', 2)).rejects.toThrow(BadRequestException);
    });
  });
});
