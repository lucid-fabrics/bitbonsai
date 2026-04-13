import { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Job, JobStage } from '@prisma/client';
import { NodeConfigService } from '../../../../core/services/node-config.service';
import { FfmpegService } from '../../../../encoding/ffmpeg.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { FileFailureTrackingService } from '../../file-failure-tracking.service';
import { FileTransferService } from '../../file-transfer.service';
import { JobHistoryService } from '../../job-history.service';
import { QueueJobCrudService } from '../../queue-job-crud.service';
import { QueueJobStateService } from '../../queue-job-state.service';

describe('QueueJobStateService', () => {
  let service: QueueJobStateService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let ffmpegService: jest.Mocked<FfmpegService>;
  let _jobHistoryService: jest.Mocked<JobHistoryService>;

  const mockJob: Job & { node: { licenseId: string } } = {
    id: 'job-123',
    filePath: '/mnt/media movie.mkv',
    fileLabel: 'movie.mkv',
    libraryId: 'lib-1',
    nodeId: 'node-1',
    stage: JobStage.QUEUED,
    progress: 0,
    priority: 0,
    retryCount: 0,
    beforeSizeBytes: BigInt(10_000_000_000),
    afterSizeBytes: null,
    savedBytes: null,
    savedPercent: 0,
    targetCodec: 'hevc',
    sourceCodec: 'h264',
    targetContainer: 'mkv',
    sourceContainer: 'mkv',
    type: 'ENCODE',
    error: null,
    isBlacklisted: false,
    keepOriginalRequested: false,
    originalBackupPath: null,
    originalSizeBytes: null,
    contentFingerprint: null,
    tempFilePath: null,
    resumeTimestamp: null,
    corruptedRequeueCount: 0,
    stuckRecoveryCount: 0,
    healthStatus: 'UNKNOWN' as never,
    healthScore: 0,
    healthMessage: null,
    healthCheckedAt: null,
    healthCheckStartedAt: null,
    healthCheckRetries: 0,
    decisionRequired: false,
    decisionIssues: null,
    decisionMadeAt: null,
    decisionData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: null,
    completedAt: null,
    failedAt: null,
    prioritySetAt: null,
    fps: null,
    etaSeconds: null,
    completedAt2: null,
    node: {
      licenseId: 'lic-1',
    },
  } as never;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const mockFfmpeg = {
      killProcess: jest.fn(),
      pauseEncoding: jest.fn(),
      resumeEncoding: jest.fn(),
      reniceProcess: jest.fn(),
      verifyFile: jest.fn().mockResolvedValue({ isValid: true, error: null }),
    };

    const mockHistory = {
      recordEvent: jest.fn(),
    };

    const mockFileTransfer = {
      cancelTransfer: jest.fn(),
      cleanupRemoteTempFile: jest.fn(),
    };

    const mockNodeConfig = {
      getMainApiUrl: jest.fn().mockReturnValue(null),
    };

    const mockHttp = {
      post: jest.fn(),
    };

    const mockJobCrud = {
      validateJobOwnership: jest
        .fn()
        .mockResolvedValue({ nodeId: 'node-1', updatedAt: new Date() }),
      findOne: jest.fn().mockResolvedValue(mockJob),
    };

    const mockFileFailure = {
      recordFailure: jest.fn().mockResolvedValue(false),
      clearBlacklist: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueJobStateService,
        { provide: PrismaService, useValue: prisma },
        { provide: FfmpegService, useValue: mockFfmpeg },
        { provide: JobHistoryService, useValue: mockHistory },
        { provide: FileTransferService, useValue: mockFileTransfer },
        { provide: NodeConfigService, useValue: mockNodeConfig },
        { provide: HttpService, useValue: mockHttp },
        { provide: QueueJobCrudService, useValue: mockJobCrud },
        { provide: FileFailureTrackingService, useValue: mockFileFailure },
      ],
    }).compile();

    service = module.get<QueueJobStateService>(QueueJobStateService);
    ffmpegService = module.get(FfmpegService);
    _jobHistoryService = module.get(JobHistoryService);

    jest
      .spyOn(
        (service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } })
          .logger,
        'log'
      )
      .mockImplementation(() => void 0);
    jest
      .spyOn(
        (service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } })
          .logger,
        'warn'
      )
      .mockImplementation(() => void 0);
    jest
      .spyOn(
        (service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } })
          .logger,
        'error'
      )
      .mockImplementation(() => void 0);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('completeJob', () => {
    it('should complete a job successfully', async () => {
      prisma.job.findUnique.mockResolvedValue({ stage: JobStage.QUEUED });
      prisma.job.update.mockResolvedValue(mockJob as never);

      const result = await service.completeJob('job-123', {
        afterSizeBytes: '4000000000',
        savedBytes: '6000000000',
        savedPercent: 60,
      });

      expect(prisma.job.update).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException for non-existent job', async () => {
      prisma.job.findUnique.mockResolvedValue(null);

      await expect(
        service.completeJob('non-existent', {
          afterSizeBytes: '4000000000',
          savedBytes: '6000000000',
          savedPercent: 60,
        })
      ).rejects.toThrow();
    });

    it('should skip if job already completed', async () => {
      prisma.job.findUnique.mockResolvedValue({ stage: JobStage.COMPLETED });
      prisma.job.update.mockResolvedValue(mockJob as never);

      const result = await service.completeJob('job-123', {
        afterSizeBytes: '4000000000',
        savedBytes: '6000000000',
        savedPercent: 60,
      });

      expect(prisma.job.update).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('failJob', () => {
    it('should mark job as failed', async () => {
      prisma.job.findUnique.mockResolvedValue({ stage: JobStage.ENCODING });
      prisma.job.update.mockResolvedValue({ ...mockJob, stage: JobStage.FAILED } as never);

      const result = await service.failJob('job-123', 'FFmpeg encode failed');

      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-123' },
          data: expect.objectContaining({
            stage: JobStage.FAILED,
            error: 'FFmpeg encode failed',
          }),
        })
      );
      expect(result.stage).toBe(JobStage.FAILED);
    });

    it('should skip if already failed', async () => {
      prisma.job.findUnique.mockResolvedValue({ stage: JobStage.FAILED });

      const result = await service.failJob('job-123', 'Another error');

      expect(prisma.job.update).not.toHaveBeenCalled();
      expect(result.stage).toBe(JobStage.FAILED);
    });
  });

  describe('cancelJob', () => {
    it('should cancel a queued job', async () => {
      prisma.job.findUnique.mockResolvedValue({ stage: JobStage.QUEUED });
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        stage: JobStage.CANCELLED,
      } as never);

      const result = await service.cancelJob('job-123');

      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-123' },
          data: expect.objectContaining({
            stage: JobStage.CANCELLED,
          }),
        })
      );
      expect(result.stage).toBe(JobStage.CANCELLED);
    });

    it('should kill FFmpeg if job is encoding', async () => {
      prisma.job.findUnique.mockResolvedValue({ stage: JobStage.ENCODING, id: 'job-123' });
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        stage: JobStage.CANCELLED,
      } as never);
      ffmpegService.killProcess.mockResolvedValue(true);

      await service.cancelJob('job-123');

      expect(ffmpegService.killProcess).toHaveBeenCalledWith('job-123');
    });

    it('should not allow cancelling completed jobs', async () => {
      prisma.job.findUnique.mockResolvedValue({ stage: JobStage.COMPLETED });

      await expect(service.cancelJob('job-123')).rejects.toThrow();
    });
  });

  describe('retryJob', () => {
    it('should retry a failed job', async () => {
      prisma.job.findUnique.mockResolvedValue({
        stage: JobStage.FAILED,
        progress: 0,
        retryCount: 0,
      });
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        stage: JobStage.QUEUED,
        retryCount: 1,
      } as never);

      const result = await service.retryJob('job-123');

      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-123' },
          data: expect.objectContaining({
            stage: JobStage.QUEUED,
            retryCount: 1,
            error: null,
          }),
        })
      );
      expect(result.stage).toBe(JobStage.QUEUED);
    });

    it('should only retry failed or cancelled jobs', async () => {
      prisma.job.findUnique.mockResolvedValue({ stage: JobStage.ENCODING });

      await expect(service.retryJob('job-123')).rejects.toThrow();
    });
  });

  describe('unblacklistJob', () => {
    it('should unblacklist a cancelled job', async () => {
      prisma.job.findUnique.mockResolvedValue({
        stage: JobStage.CANCELLED,
        isBlacklisted: true,
      });
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        stage: JobStage.CANCELLED,
        isBlacklisted: false,
      } as never);

      const result = await service.unblacklistJob('job-123');

      expect(result.isBlacklisted).toBe(false);
    });

    it('should throw if job is not blacklisted', async () => {
      prisma.job.findUnique.mockResolvedValue({
        stage: JobStage.CANCELLED,
        isBlacklisted: false,
      });

      await expect(service.unblacklistJob('job-123')).rejects.toThrow();
    });
  });

  describe('categorizeError', () => {
    it('should categorize FFmpeg exit code errors', () => {
      const result = service.categorizeError('FFmpeg exited with code 1');
      expect(result).toBe('FFmpeg Error Code 1');
    });

    it('should categorize file not found errors', () => {
      const result = service.categorizeError('File not found /mnt/media/movie.mkv');
      expect(result).toBe('File Not Found');
    });

    it('should categorize timeout errors', () => {
      const result = service.categorizeError('Encoding timeout after 3600s');
      expect(result).toBe('Job Timeout/Stuck');
    });

    it('should categorize network errors', () => {
      const result = service.categorizeError('Connection refused to remote node');
      expect(result).toBe('Network Error');
    });

    it('should categorize disk space errors', () => {
      const result = service.categorizeError('No space left on device');
      expect(result).toBe('Disk Space Error');
    });

    it('should categorize permission errors', () => {
      const result = service.categorizeError('Permission denied accessing file');
      expect(result).toBe('Permission Error');
    });
  });
});
