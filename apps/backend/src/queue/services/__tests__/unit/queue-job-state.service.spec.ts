import { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { FileHealthStatus, JobStage } from '@prisma/client';
import { NodeConfigService } from '../../../../core/services/node-config.service';
import { FfmpegService } from '../../../../encoding/ffmpeg.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockJob, createMockNode } from '../../../../testing/mock-factories';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { FileFailureTrackingService } from '../../file-failure-tracking.service';
import { FileTransferService } from '../../file-transfer.service';
import { JobHistoryService } from '../../job-history.service';
import { QueueJobCrudService } from '../../queue-job-crud.service';
import { QueueJobStateService } from '../../queue-job-state.service';

describe('QueueJobStateService', () => {
  let service: QueueJobStateService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  const mockFfmpegService = {
    killProcess: jest.fn().mockResolvedValue(true),
    pauseEncoding: jest.fn().mockResolvedValue(true),
    resumeEncoding: jest.fn().mockResolvedValue(true),
    verifyFile: jest.fn().mockResolvedValue({ isValid: true }),
    reniceProcess: jest.fn().mockResolvedValue(true),
  };

  const mockJobHistoryService = {
    recordEvent: jest.fn().mockResolvedValue({}),
  };

  const mockFileTransferService = {
    cancelTransfer: jest.fn().mockResolvedValue({}),
    cleanupRemoteTempFile: jest.fn().mockResolvedValue({}),
  };

  const mockNodeConfig = {
    getMainApiUrl: jest.fn().mockReturnValue(null),
  };

  const mockHttpService = {
    post: jest.fn(),
  };

  const mockJobCrudService = {
    validateJobOwnership: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn(),
  };

  const mockFileFailureTracking = {
    recordFailure: jest.fn().mockResolvedValue(false),
    clearBlacklist: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueJobStateService,
        { provide: PrismaService, useValue: prisma },
        { provide: FfmpegService, useValue: mockFfmpegService },
        { provide: JobHistoryService, useValue: mockJobHistoryService },
        { provide: FileTransferService, useValue: mockFileTransferService },
        { provide: NodeConfigService, useValue: mockNodeConfig },
        { provide: HttpService, useValue: mockHttpService },
        { provide: QueueJobCrudService, useValue: mockJobCrudService },
        { provide: FileFailureTrackingService, useValue: mockFileFailureTracking },
      ],
    }).compile();

    service = module.get<QueueJobStateService>(QueueJobStateService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('completeJob', () => {
    it('should complete a job and update metrics', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.ENCODING,
        progress: 50,
        beforeSizeBytes: BigInt(1000000000),
        nodeId: 'node-1',
      });

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValue({ stage: JobStage.ENCODING }),
            update: jest.fn().mockResolvedValue({
              ...mockJob,
              stage: JobStage.COMPLETED,
              progress: 100,
              afterSizeBytes: BigInt(500000000),
              savedBytes: BigInt(500000000),
              savedPercent: 50,
              node: { licenseId: 'license-1' },
            }),
          },
          metric: { upsert: jest.fn().mockResolvedValue({}) },
          node: {
            findUnique: jest.fn().mockResolvedValue({ avgEncodingSpeed: 100 }),
            update: jest.fn().mockResolvedValue({}),
          },
          metricsProcessedJob: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
        };
        return callback(tx);
      });

      const result = await service.completeJob('job-1', {
        afterSizeBytes: '500000000',
        savedBytes: '500000000',
        savedPercent: 50,
      });

      expect(result.stage).toBe(JobStage.COMPLETED);
    });

    it('should skip already completed jobs', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.COMPLETED,
      });

      prisma.job.findUnique.mockResolvedValue({ stage: JobStage.COMPLETED });
      prisma.$transaction.mockImplementation(async (callback) => {
        // Mock transaction to return completed job with node for the early-return path
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValue({
              ...mockJob,
              stage: JobStage.COMPLETED,
              node: { licenseId: 'license-1' },
            }),
          },
        };
        return callback(tx);
      });

      const result = await service.completeJob('job-1', {
        afterSizeBytes: '500000000',
        savedBytes: '500000000',
        savedPercent: 50,
      });

      // Should return the existing completed job
      expect(result.stage).toBe(JobStage.COMPLETED);
      expect(prisma.job.update).not.toHaveBeenCalled();
    });
  });

  describe('failJob', () => {
    it('should mark a job as failed', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.ENCODING,
        filePath: '/storage/test.mp4',
        libraryId: 'lib-1',
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        stage: JobStage.FAILED,
        error: 'FFmpeg error: exit code 1',
      });

      const result = await service.failJob('job-1', 'FFmpeg error: exit code 1');

      expect(result.stage).toBe(JobStage.FAILED);
    });

    it('should skip duplicate failure events', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.FAILED,
        error: 'Previous error',
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);

      const result = await service.failJob('job-1', 'New error');

      // Should return the existing failed job without updating
      expect(result.error).toBe('Previous error');
      expect(prisma.job.update).not.toHaveBeenCalled();
    });
  });

  describe('cancelJob', () => {
    it('should cancel a queued job', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.QUEUED,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        stage: JobStage.CANCELLED,
        isBlacklisted: false,
      });

      const result = await service.cancelJob('job-1');

      expect(result.stage).toBe(JobStage.CANCELLED);
    });

    it('should cancel an encoding job and kill FFmpeg', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.ENCODING,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        stage: JobStage.CANCELLED,
      });

      await service.cancelJob('job-1');

      expect(mockFfmpegService.killProcess).toHaveBeenCalledWith('job-1');
    });

    it('should reject cancelling completed jobs', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.COMPLETED,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);

      await expect(service.cancelJob('job-1')).rejects.toThrow('Cannot cancel a completed job');
    });
  });

  describe('unblacklistJob', () => {
    it('should unblacklist a cancelled job', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.CANCELLED,
        isBlacklisted: true,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        isBlacklisted: false,
        corruptedRequeueCount: 0,
        stuckRecoveryCount: 0,
      });

      const result = await service.unblacklistJob('job-1');

      expect(result.isBlacklisted).toBe(false);
    });

    it('should reject unblacklisting non-cancelled jobs', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.QUEUED,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);

      await expect(service.unblacklistJob('job-1')).rejects.toThrow(
        'Only cancelled jobs can be unblacklisted'
      );
    });

    it('should reject unblacklisting non-blacklisted jobs', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.CANCELLED,
        isBlacklisted: false,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);

      await expect(service.unblacklistJob('job-1')).rejects.toThrow('Job is not blacklisted');
    });
  });

  describe('cancelAllQueued', () => {
    it('should cancel all jobs in relevant stages', async () => {
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', fileLabel: 'video1.mp4', stage: JobStage.ENCODING },
        { id: 'job-2', fileLabel: 'video2.mp4', stage: JobStage.QUEUED },
      ]);
      prisma.job.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.cancelAllQueued();

      expect(result.cancelledCount).toBe(2);
    });
  });

  describe('pauseJob', () => {
    it('should pause an encoding job', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.ENCODING,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        stage: JobStage.PAUSED,
      });

      const result = await service.pauseJob('job-1');

      expect(result.stage).toBe(JobStage.PAUSED);
    });

    it('should reject pausing non-encoding jobs', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.QUEUED,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);

      await expect(service.pauseJob('job-1')).rejects.toThrow('Only encoding jobs can be paused');
    });
  });

  describe('resumeJob', () => {
    it('should resume a paused job', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.PAUSED,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        stage: JobStage.ENCODING,
      });

      const result = await service.resumeJob('job-1');

      expect(result.stage).toBe(JobStage.ENCODING);
    });

    it('should reset to queued if FFmpeg process not found', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.PAUSED,
        progress: 30,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);
      mockFfmpegService.resumeEncoding.mockResolvedValue(false);
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        stage: JobStage.QUEUED,
        progress: 0,
        error: 'Restarted from paused state (process was lost)',
      });

      const result = await service.resumeJob('job-1');

      expect(result.stage).toBe(JobStage.QUEUED);
    });
  });

  describe('retryJob', () => {
    it('should retry a failed job', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.FAILED,
        progress: 30,
        retryCount: 1,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        stage: JobStage.QUEUED,
        progress: 0,
        retryCount: 2,
      });

      const result = await service.retryJob('job-1');

      expect(result.stage).toBe(JobStage.QUEUED);
      expect(result.retryCount).toBe(2);
    });

    it('should reject retrying non-failed/cancelled jobs', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.ENCODING,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);

      await expect(service.retryJob('job-1')).rejects.toThrow(
        'Only failed or cancelled jobs can be retried'
      );
    });
  });

  describe('forceStartJob', () => {
    it('should force start a queued job', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.QUEUED,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        stage: JobStage.DETECTED,
      });

      const result = await service.forceStartJob('job-1');

      expect(result.stage).toBe(JobStage.DETECTED);
    });

    it('should reject force start for non-queued/detected jobs', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.ENCODING,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);

      await expect(service.forceStartJob('job-1')).rejects.toThrow(
        'Only queued or detected jobs can be force-started'
      );
    });
  });

  describe('recheckHealth', () => {
    it('should reset health status for rechecking', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.QUEUED,
        healthStatus: FileHealthStatus.CORRUPTED,
        healthScore: 20,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        healthStatus: FileHealthStatus.UNKNOWN,
        healthScore: 0,
      });

      const result = await service.recheckHealth('job-1');

      expect(result.healthStatus).toBe(FileHealthStatus.UNKNOWN);
    });
  });

  describe('retryAllCancelled', () => {
    it('should retry all cancelled jobs', async () => {
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', fileLabel: 'video1.mp4', beforeSizeBytes: BigInt(1000) },
        { id: 'job-2', fileLabel: 'video2.mp4', beforeSizeBytes: BigInt(2000) },
      ]);
      prisma.job.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.retryAllCancelled();

      expect(result.retriedCount).toBe(2);
    });
  });

  describe('retryAllFailed', () => {
    it('should retry all failed jobs', async () => {
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', fileLabel: 'video1.mp4', error: 'FFmpeg error: exit code 1' },
        { id: 'job-2', fileLabel: 'video2.mp4', error: 'File not found' },
      ]);
      prisma.job.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.retryAllFailed();

      expect(result.retriedCount).toBe(2);
    });

    it('should filter by error category', async () => {
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', fileLabel: 'video1.mp4', error: 'FFmpeg error: exit code 1' },
        { id: 'job-2', fileLabel: 'video2.mp4', error: 'File not found' },
      ]);
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.retryAllFailed('FFmpeg Error Code 1');

      expect(result.retriedCount).toBe(1);
    });
  });

  describe('skipAllCodecMatch', () => {
    it('should skip jobs where source matches target codec', async () => {
      prisma.job.findMany.mockResolvedValue([
        {
          id: 'job-1',
          fileLabel: 'video1.mp4',
          sourceCodec: 'h264',
          targetCodec: 'h265',
          beforeSizeBytes: BigInt(1000),
        },
        {
          id: 'job-2',
          fileLabel: 'video2.mp4',
          sourceCodec: 'h264',
          targetCodec: 'h264',
          beforeSizeBytes: BigInt(2000),
        },
        {
          id: 'job-3',
          fileLabel: 'video3.mp4',
          sourceCodec: 'hevc',
          targetCodec: 'hevc',
          beforeSizeBytes: BigInt(3000),
        },
      ]);
      prisma.job.updateMany.mockResolvedValue({ count: 2 });
      prisma.job.update.mockResolvedValue({});

      const result = await service.skipAllCodecMatch();

      expect(result.skippedCount).toBe(2);
    });
  });

  describe('forceEncodeAllCodecMatch', () => {
    it('should force encode jobs where codec already matches', async () => {
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', fileLabel: 'video1.mp4', sourceCodec: 'h264', targetCodec: 'h264' },
        { id: 'job-2', fileLabel: 'video2.mp4', sourceCodec: 'h264', targetCodec: 'h265' },
      ]);
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.forceEncodeAllCodecMatch();

      expect(result.queuedCount).toBe(1);
    });
  });

  describe('updateJobPriority', () => {
    it('should update job priority', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.QUEUED,
        priority: 0,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        priority: 2,
        prioritySetAt: new Date(),
      });

      const result = await service.updateJobPriority('job-1', 2);

      expect(result.priority).toBe(2);
    });

    it('should limit top priority jobs to 3', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.QUEUED,
        priority: 0,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);
      prisma.job.count.mockResolvedValue(3);

      await expect(service.updateJobPriority('job-1', 2)).rejects.toThrow(
        'Maximum 3 jobs can have top priority at once'
      );
    });

    it('should reject invalid priority values', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.QUEUED,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);

      await expect(service.updateJobPriority('job-1', 5)).rejects.toThrow(
        'Priority must be between 0 and 2'
      );
    });
  });

  describe('requestKeepOriginal', () => {
    it('should request to keep original file', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.ENCODING,
        beforeSizeBytes: BigInt(1000000000),
      });

      mockJobCrudService.findOne.mockResolvedValue(mockJob);
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        keepOriginalRequested: true,
      });

      const result = await service.requestKeepOriginal('job-1');

      expect(result.keepOriginalRequested).toBe(true);
    });
  });

  describe('recheckFailedJob', () => {
    it('should throw for non-failed jobs', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.COMPLETED,
      });

      mockJobCrudService.findOne.mockResolvedValue(mockJob);

      await expect(service.recheckFailedJob('job-1')).rejects.toThrow(
        'Can only recheck FAILED jobs'
      );
    });
  });

  describe('categorizeError', () => {
    it('should categorize FFmpeg exit codes', () => {
      const result = service.categorizeError('FFmpeg exited with code 137');
      expect(result).toBe('FFmpeg Error Code 137');
    });

    it('should categorize file not found errors', () => {
      const result = service.categorizeError('ENOENT: no such file or directory');
      expect(result).toBe('File Not Found');
    });

    it('should categorize network errors', () => {
      const result = service.categorizeError('ECONNREFUSED: connection refused');
      expect(result).toBe('Network Error');
    });

    it('should categorize disk space errors', () => {
      const result = service.categorizeError('ENOSPC: no space left on device');
      expect(result).toBe('Disk Space Error');
    });

    it('should categorize permission errors', () => {
      const result = service.categorizeError('EACCES: permission denied');
      expect(result).toBe('Permission Error');
    });

    it('should categorize memory errors', () => {
      const result = service.categorizeError('Out of memory');
      expect(result).toBe('Memory Error');
    });

    it('should categorize timeout errors', () => {
      const result = service.categorizeError('Encoding stuck - no progress for 5 minutes');
      expect(result).toBe('Job Timeout/Stuck');
    });

    it('should categorize codec errors', () => {
      const result = service.categorizeError('Unsupported codec: eac3');
      expect(result).toBe('Codec Error');
    });

    it('should return Unknown error for unrecognized patterns', () => {
      const result = service.categorizeError('Some random error');
      expect(result).toBe('Unknown error');
    });
  });

  describe('detectAndRequeueIfUncompressed', () => {
    it('should throw if job saved bytes', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.COMPLETED,
        savedBytes: BigInt(500000000),
        savedPercent: 50,
      });

      mockJobCrudService.findOne.mockResolvedValue(mockJob);

      await expect(service.detectAndRequeueIfUncompressed('job-1')).rejects.toThrow(
        'successfully compressed'
      );
    });
  });

  describe('resolveDecision', () => {
    it('should resolve skip decision', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.NEEDS_DECISION,
        beforeSizeBytes: BigInt(1000000000),
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);
      prisma.job.update.mockResolvedValue({
        ...mockJob,
        stage: JobStage.COMPLETED,
        decisionRequired: false,
      });

      const result = await service.resolveDecision('job-1', {
        actionConfig: { action: 'skip', reason: 'codec_already_matches' },
      });

      expect(result.stage).toBe(JobStage.COMPLETED);
    });

    it('should reject resolving decision for non-NEEDS_DECISION jobs', async () => {
      const mockJob = createMockJob({
        id: 'job-1',
        stage: JobStage.QUEUED,
      });

      prisma.job.findUnique.mockResolvedValue(mockJob);

      await expect(service.resolveDecision('job-1')).rejects.toThrow(
        'Can only resolve decisions for jobs in NEEDS_DECISION stage'
      );
    });
  });
});
