import * as fs from 'fs';

jest.mock('fs');

import { HttpService } from '@nestjs/axios';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { FileHealthStatus, JobStage } from '@prisma/client';
import { of, throwError } from 'rxjs';
import { JobRepository } from '../../../../common/repositories/job.repository';
import { NodeConfigService } from '../../../../core/services/node-config.service';
import { FfmpegService } from '../../../../encoding/ffmpeg.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import type { CompleteJobDto } from '../../../dto/complete-job.dto';
import { FileFailureTrackingService } from '../../file-failure-tracking.service';
import { FileTransferService } from '../../file-transfer.service';
import { JobBulkOperationsService } from '../../job-bulk-operations.service';
import { JobFileOperationsService } from '../../job-file-operations.service';
import { JobHistoryService } from '../../job-history.service';
import { JobMetricsService } from '../../job-metrics.service';
import { QueueJobCrudService } from '../../queue-job-crud.service';
import { QueueJobStateService } from '../../queue-job-state.service';

const makeJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  stage: JobStage.QUEUED,
  progress: 0,
  fps: null,
  etaSeconds: null,
  retryCount: 0,
  fileLabel: 'movie.mkv',
  filePath: '/media/movie.mkv',
  libraryId: 'lib-1',
  contentFingerprint: 'fp-abc',
  tempFilePath: null,
  resumeTimestamp: null,
  beforeSizeBytes: BigInt(1000),
  isBlacklisted: false,
  corruptedRequeueCount: 0,
  stuckRecoveryCount: 0,
  originalFilePath: null,
  targetContainer: 'mkv',
  type: 'ENCODE',
  remoteTempPath: null,
  ...overrides,
});

describe('QueueJobStateService', () => {
  let service: QueueJobStateService;
  let jobRepository: jest.Mocked<JobRepository>;
  let nodeConfig: jest.Mocked<NodeConfigService>;
  let ffmpegService: jest.Mocked<FfmpegService>;
  let jobHistoryService: jest.Mocked<JobHistoryService>;
  let fileTransferService: jest.Mocked<FileTransferService>;
  let httpService: jest.Mocked<HttpService>;
  let jobCrudService: jest.Mocked<QueueJobCrudService>;
  let fileFailureTracking: jest.Mocked<FileFailureTrackingService>;
  let jobMetricsService: jest.Mocked<JobMetricsService>;
  let jobBulkOperationsService: jest.Mocked<JobBulkOperationsService>;
  let jobFileOperationsService: jest.Mocked<JobFileOperationsService>;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueJobStateService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JobRepository,
          useValue: {
            findById: jest.fn(),
            updateById: jest.fn(),
            countWhere: jest.fn(),
            updateRaw: jest.fn(),
          },
        },
        {
          provide: FfmpegService,
          useValue: {
            killProcess: jest.fn(),
            pauseEncoding: jest.fn(),
            resumeEncoding: jest.fn(),
            reniceProcess: jest.fn(),
          },
        },
        {
          provide: JobHistoryService,
          useValue: { recordEvent: jest.fn() },
        },
        {
          provide: FileTransferService,
          useValue: {
            cancelTransfer: jest.fn(),
            cleanupRemoteTempFile: jest.fn(),
          },
        },
        {
          provide: NodeConfigService,
          useValue: { getMainApiUrl: jest.fn().mockReturnValue(null) },
        },
        {
          provide: HttpService,
          useValue: { post: jest.fn(), get: jest.fn() },
        },
        {
          provide: QueueJobCrudService,
          useValue: { validateJobOwnership: jest.fn() },
        },
        {
          provide: FileFailureTrackingService,
          useValue: {
            recordFailure: jest.fn(),
            clearBlacklist: jest.fn(),
          },
        },
        {
          provide: JobMetricsService,
          useValue: { updateMetrics: jest.fn() },
        },
        {
          provide: JobBulkOperationsService,
          useValue: {
            cancelAllQueued: jest.fn(),
            retryAllCancelled: jest.fn(),
            categorizeError: jest.fn(),
            retryAllFailed: jest.fn(),
            skipAllCodecMatch: jest.fn(),
            forceEncodeAllCodecMatch: jest.fn(),
          },
        },
        {
          provide: JobFileOperationsService,
          useValue: {
            requestKeepOriginal: jest.fn(),
            deleteOriginalBackup: jest.fn(),
            restoreOriginal: jest.fn(),
            recheckFailedJob: jest.fn(),
            detectAndRequeueIfUncompressed: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(QueueJobStateService);
    jobRepository = module.get(JobRepository);
    nodeConfig = module.get(NodeConfigService);
    ffmpegService = module.get(FfmpegService);
    jobHistoryService = module.get(JobHistoryService);
    fileTransferService = module.get(FileTransferService);
    httpService = module.get(HttpService);
    jobCrudService = module.get(QueueJobCrudService);
    fileFailureTracking = module.get(FileFailureTrackingService);
    jobMetricsService = module.get(JobMetricsService);
    jobBulkOperationsService = module.get(JobBulkOperationsService);
    jobFileOperationsService = module.get(JobFileOperationsService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // ─── completeJob ─────────────────────────────────────────────────────────────

  describe('completeJob', () => {
    const dto: CompleteJobDto = {
      afterSizeBytes: '800',
      savedBytes: '200',
      savedPercent: 20,
    };

    it('should proxy to MAIN node when mainApiUrl is set', async () => {
      nodeConfig.getMainApiUrl.mockReturnValue('http://main:3000');
      jobCrudService.validateJobOwnership.mockResolvedValue(undefined as any);
      httpService.post.mockReturnValue(of({ data: makeJob() }) as any);

      const result = await service.completeJob('job-1', dto);

      expect(httpService.post).toHaveBeenCalledWith(
        'http://main:3000/api/v1/queue/job-1/complete',
        dto,
        { timeout: 30000 }
      );
      expect(result).toMatchObject({ id: 'job-1' });
    });

    it('should throw when MAIN proxy fails', async () => {
      nodeConfig.getMainApiUrl.mockReturnValue('http://main:3000');
      jobCrudService.validateJobOwnership.mockResolvedValue(undefined as any);
      httpService.post.mockReturnValue(throwError(() => new Error('Network error')) as any);

      await expect(service.completeJob('job-1', dto)).rejects.toThrow('Network error');
    });

    it('should skip metrics update when job already COMPLETED', async () => {
      jobCrudService.validateJobOwnership.mockResolvedValue(undefined as any);
      const completedJob = makeJob({ stage: JobStage.COMPLETED });

      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValue(completedJob),
          },
        };
        return fn(tx);
      });

      // The inner findUnique for the return call
      await service.completeJob('job-1', dto);

      expect(jobMetricsService.updateMetrics).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when job not found in transaction', async () => {
      jobCrudService.validateJobOwnership.mockResolvedValue(undefined as any);

      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const tx = {
          job: { findUnique: jest.fn().mockResolvedValue(null) },
        };
        return fn(tx);
      });

      await expect(service.completeJob('job-1', dto)).rejects.toThrow(
        'Failed to mark job as completed'
      );
    });

    it('should skip processedFileRecord upsert when contentFingerprint is null', async () => {
      jobCrudService.validateJobOwnership.mockResolvedValue(undefined as any);
      const jobNoFp = makeJob({ contentFingerprint: null });

      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValue(jobNoFp),
            update: jest.fn().mockResolvedValue({ ...jobNoFp, stage: JobStage.COMPLETED }),
          },
          processedFileRecord: { upsert: jest.fn() },
        };
        await fn(tx);
        expect(tx.processedFileRecord.upsert).not.toHaveBeenCalled();
        return { ...jobNoFp, stage: JobStage.COMPLETED };
      });

      await service.completeJob('job-1', dto);
    });
  });

  // ─── failJob ─────────────────────────────────────────────────────────────────

  describe('failJob', () => {
    it('should proxy to MAIN node when mainApiUrl is set', async () => {
      nodeConfig.getMainApiUrl.mockReturnValue('http://main:3000');
      jobCrudService.validateJobOwnership.mockResolvedValue(undefined as any);
      httpService.post.mockReturnValue(of({ data: makeJob() }) as any);

      await service.failJob('job-1', 'FFmpeg crashed');

      expect(httpService.post).toHaveBeenCalledWith(
        'http://main:3000/api/v1/queue/job-1/fail',
        { error: 'FFmpeg crashed' },
        { timeout: 30000 }
      );
    });

    it('should throw when MAIN proxy fails on failJob', async () => {
      nodeConfig.getMainApiUrl.mockReturnValue('http://main:3000');
      jobCrudService.validateJobOwnership.mockResolvedValue(undefined as any);
      httpService.post.mockReturnValue(throwError(() => new Error('Proxy down')) as any);

      await expect(service.failJob('job-1', 'err')).rejects.toThrow('Proxy down');
    });

    it('should throw NotFoundException when job not found', async () => {
      jobCrudService.validateJobOwnership.mockResolvedValue(undefined as any);
      jobRepository.findById.mockResolvedValue(null);

      await expect(service.failJob('job-1', 'err')).rejects.toThrow(NotFoundException);
    });

    it('should return existing job without update when already FAILED', async () => {
      jobCrudService.validateJobOwnership.mockResolvedValue(undefined as any);
      const failedJob = makeJob({ stage: JobStage.FAILED }) as any;
      jobRepository.findById.mockResolvedValue(failedJob);

      const result = await service.failJob('job-1', 'err');

      expect(jobRepository.updateById).not.toHaveBeenCalled();
      expect(result).toBe(failedJob);
    });

    it('should record failure and log blacklist warning when file is auto-blacklisted', async () => {
      jobCrudService.validateJobOwnership.mockResolvedValue(undefined as any);
      const job = makeJob({ stage: JobStage.ENCODING }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue(job);
      jobHistoryService.recordEvent.mockResolvedValue(undefined);
      fileFailureTracking.recordFailure.mockResolvedValue(true);

      await service.failJob('job-1', 'codec error');

      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('auto-blacklisted')
      );
    });

    it('should not throw when fileFailureTracking.recordFailure rejects', async () => {
      jobCrudService.validateJobOwnership.mockResolvedValue(undefined as any);
      const job = makeJob({ stage: JobStage.ENCODING }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue(job);
      jobHistoryService.recordEvent.mockResolvedValue(undefined);
      fileFailureTracking.recordFailure.mockRejectedValue(new Error('tracking fail'));

      await expect(service.failJob('job-1', 'err')).resolves.not.toBeUndefined();
      expect((service as any).logger.error).toHaveBeenCalledWith(
        'Failed to record file failure tracking',
        expect.anything()
      );
    });
  });

  // ─── cancelJob ───────────────────────────────────────────────────────────────

  describe('cancelJob', () => {
    it('should proxy cancel to MAIN node', async () => {
      nodeConfig.getMainApiUrl.mockReturnValue('http://main:3000');
      httpService.post.mockReturnValue(of({ data: makeJob() }) as any);

      await service.cancelJob('job-1', true);

      expect(httpService.post).toHaveBeenCalledWith(
        'http://main:3000/api/v1/queue/job-1/cancel',
        { blacklist: true },
        { timeout: 30000 }
      );
    });

    it('should throw NotFoundException when job not found', async () => {
      jobRepository.findById.mockResolvedValue(null);

      await expect(service.cancelJob('job-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when cancelling a COMPLETED job', async () => {
      jobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.COMPLETED }) as any);

      await expect(service.cancelJob('job-1')).rejects.toThrow(BadRequestException);
    });

    it('should kill FFmpeg process when job is ENCODING', async () => {
      const job = makeJob({ stage: JobStage.ENCODING }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue(job);
      jobHistoryService.recordEvent.mockResolvedValue(undefined);
      ffmpegService.killProcess.mockResolvedValue(true);

      await service.cancelJob('job-1');

      expect(ffmpegService.killProcess).toHaveBeenCalledWith('job-1');
    });

    it('should warn but not throw when FFmpeg kill fails', async () => {
      const job = makeJob({ stage: JobStage.ENCODING }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue(job);
      jobHistoryService.recordEvent.mockResolvedValue(undefined);
      ffmpegService.killProcess.mockRejectedValue(new Error('kill failed'));

      await expect(service.cancelJob('job-1')).resolves.not.toBeUndefined();
    });

    it('should cancel transfer and cleanup remote temp when TRANSFERRING with remoteTempPath', async () => {
      const job = makeJob({
        stage: 'TRANSFERRING' as JobStage,
        remoteTempPath: '/tmp/remote',
      }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue(job);
      jobHistoryService.recordEvent.mockResolvedValue(undefined);
      fileTransferService.cancelTransfer.mockResolvedValue(undefined);
      fileTransferService.cleanupRemoteTempFile.mockResolvedValue(undefined);

      await service.cancelJob('job-1');

      expect(fileTransferService.cancelTransfer).toHaveBeenCalledWith('job-1');
      expect(fileTransferService.cleanupRemoteTempFile).toHaveBeenCalledWith('job-1');
    });

    it('should cancel transfer but skip cleanup when no remoteTempPath', async () => {
      const job = makeJob({ stage: 'TRANSFERRING' as JobStage, remoteTempPath: null }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue(job);
      jobHistoryService.recordEvent.mockResolvedValue(undefined);
      fileTransferService.cancelTransfer.mockResolvedValue(undefined);

      await service.cancelJob('job-1');

      expect(fileTransferService.cancelTransfer).toHaveBeenCalled();
      expect(fileTransferService.cleanupRemoteTempFile).not.toHaveBeenCalled();
    });

    it('should set isBlacklisted when blacklist=true', async () => {
      const job = makeJob({ stage: JobStage.QUEUED }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue(job);
      jobHistoryService.recordEvent.mockResolvedValue(undefined);

      await service.cancelJob('job-1', true);

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          isBlacklisted: true,
        })
      );
    });
  });

  // ─── unblacklistJob ───────────────────────────────────────────────────────────

  describe('unblacklistJob', () => {
    it('should throw NotFoundException when job not found', async () => {
      jobRepository.findById.mockResolvedValue(null);

      await expect(service.unblacklistJob('job-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when job is not CANCELLED', async () => {
      jobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.QUEUED }) as any);

      await expect(service.unblacklistJob('job-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when job is not blacklisted', async () => {
      jobRepository.findById.mockResolvedValue(
        makeJob({ stage: JobStage.CANCELLED, isBlacklisted: false }) as any
      );

      await expect(service.unblacklistJob('job-1')).rejects.toThrow('Job is not blacklisted');
    });

    it('should clear failure tracking and processedFileRecord on success', async () => {
      const job = makeJob({
        stage: JobStage.CANCELLED,
        isBlacklisted: true,
        contentFingerprint: 'fp-abc',
      }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue(job);
      fileFailureTracking.clearBlacklist.mockResolvedValue(undefined);
      (prisma as any).processedFileRecord = {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      } as any;

      await service.unblacklistJob('job-1');

      expect(fileFailureTracking.clearBlacklist).toHaveBeenCalledWith('/media/movie.mkv', 'lib-1');
      expect((prisma as any).processedFileRecord.deleteMany).toHaveBeenCalled();
    });

    it('should skip processedFileRecord deletion when no contentFingerprint', async () => {
      const job = makeJob({
        stage: JobStage.CANCELLED,
        isBlacklisted: true,
        contentFingerprint: null,
      }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue(job);
      fileFailureTracking.clearBlacklist.mockResolvedValue(undefined);
      (prisma as any).processedFileRecord = { deleteMany: jest.fn() } as any;

      await service.unblacklistJob('job-1');

      expect((prisma as any).processedFileRecord.deleteMany).not.toHaveBeenCalled();
    });

    it('should not throw when clearBlacklist rejects', async () => {
      const job = makeJob({
        stage: JobStage.CANCELLED,
        isBlacklisted: true,
      }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue(job);
      fileFailureTracking.clearBlacklist.mockRejectedValue(new Error('tracking error'));
      (prisma as any).processedFileRecord = {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      } as any;

      await expect(service.unblacklistJob('job-1')).resolves.not.toBeUndefined();
    });
  });

  // ─── pauseJob ─────────────────────────────────────────────────────────────────

  describe('pauseJob', () => {
    it('should throw NotFoundException when job not found', async () => {
      jobRepository.findById.mockResolvedValue(null);

      await expect(service.pauseJob('job-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when job is not ENCODING', async () => {
      jobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.QUEUED }) as any);

      await expect(service.pauseJob('job-1')).rejects.toThrow('Only encoding jobs can be paused');
    });

    it('should throw BadRequestException when ffmpegService.pauseEncoding returns false', async () => {
      jobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.ENCODING }) as any);
      ffmpegService.pauseEncoding.mockResolvedValue(false);

      await expect(service.pauseJob('job-1')).rejects.toThrow('Failed to pause encoding process');
    });

    it('should update stage to PAUSED when pause succeeds', async () => {
      const job = makeJob({ stage: JobStage.ENCODING }) as any;
      jobRepository.findById.mockResolvedValue(job);
      ffmpegService.pauseEncoding.mockResolvedValue(true);
      jobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.PAUSED });

      const result = await service.pauseJob('job-1');

      expect(jobRepository.updateById).toHaveBeenCalledWith('job-1', { stage: JobStage.PAUSED });
      expect(result.stage).toBe(JobStage.PAUSED);
    });
  });

  // ─── resumeJob ────────────────────────────────────────────────────────────────

  describe('resumeJob', () => {
    it('should throw NotFoundException when job not found', async () => {
      jobRepository.findById.mockResolvedValue(null);

      await expect(service.resumeJob('job-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when job is not PAUSED', async () => {
      jobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.QUEUED }) as any);

      await expect(service.resumeJob('job-1')).rejects.toThrow('Only paused jobs can be resumed');
    });

    it('should reset to QUEUED when FFmpeg process is not found', async () => {
      const job = makeJob({ stage: JobStage.PAUSED }) as any;
      jobRepository.findById.mockResolvedValue(job);
      ffmpegService.resumeEncoding.mockResolvedValue(false);
      jobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.QUEUED });

      const result = await service.resumeJob('job-1');

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.QUEUED,
          progress: 0,
        })
      );
      expect(result.stage).toBe(JobStage.QUEUED);
    });

    it('should update stage to ENCODING when resume succeeds', async () => {
      const job = makeJob({ stage: JobStage.PAUSED }) as any;
      jobRepository.findById.mockResolvedValue(job);
      ffmpegService.resumeEncoding.mockResolvedValue(true);
      jobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.ENCODING });

      const result = await service.resumeJob('job-1');

      expect(result.stage).toBe(JobStage.ENCODING);
    });
  });

  // ─── retryJob ─────────────────────────────────────────────────────────────────

  describe('retryJob', () => {
    it('should throw NotFoundException when job not found', async () => {
      jobRepository.findById.mockResolvedValue(null);

      await expect(service.retryJob('job-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when job is not FAILED or CANCELLED', async () => {
      jobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.QUEUED }) as any);

      await expect(service.retryJob('job-1')).rejects.toThrow(
        'Only failed or cancelled jobs can be retried'
      );
    });

    it('should resume from progress when temp file exists and resumeTimestamp is set', async () => {
      const job = makeJob({
        stage: JobStage.FAILED,
        tempFilePath: '/tmp/job-1.mkv',
        resumeTimestamp: 120,
        progress: 45.5,
      }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.QUEUED });
      jobHistoryService.recordEvent.mockResolvedValue(undefined);
      jest.mocked(fs.existsSync).mockReturnValue(true);

      await service.retryJob('job-1');

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.QUEUED,
          progress: 45.5,
          resumeTimestamp: 120,
        })
      );
    });

    it('should start fresh when temp file does not exist', async () => {
      const job = makeJob({
        stage: JobStage.FAILED,
        tempFilePath: '/tmp/gone.mkv',
        resumeTimestamp: null,
        progress: 30,
      }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.QUEUED });
      jobHistoryService.recordEvent.mockResolvedValue(undefined);
      jest.mocked(fs.existsSync).mockReturnValue(false);

      await service.retryJob('job-1');

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          progress: 0,
          resumeTimestamp: null,
          tempFilePath: null,
        })
      );
    });
  });

  // ─── forceStartJob ────────────────────────────────────────────────────────────

  describe('forceStartJob', () => {
    it('should throw NotFoundException when job not found', async () => {
      jobRepository.findById.mockResolvedValue(null);

      await expect(service.forceStartJob('job-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when job is not QUEUED or DETECTED', async () => {
      jobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.ENCODING }) as any);

      await expect(service.forceStartJob('job-1')).rejects.toThrow(BadRequestException);
    });

    it('should move job to DETECTED stage with epoch createdAt', async () => {
      const job = makeJob({ stage: JobStage.QUEUED }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.DETECTED });

      await service.forceStartJob('job-1');

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.DETECTED,
          createdAt: new Date(0),
        })
      );
    });
  });

  // ─── recheckHealth ────────────────────────────────────────────────────────────

  describe('recheckHealth', () => {
    it('should throw NotFoundException when job not found', async () => {
      jobRepository.findById.mockResolvedValue(null);

      await expect(service.recheckHealth('job-1')).rejects.toThrow(NotFoundException);
    });

    it('should reset health fields and stage to DETECTED', async () => {
      const job = makeJob({ stage: JobStage.QUEUED }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.DETECTED });

      await service.recheckHealth('job-1');

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.DETECTED,
          healthStatus: FileHealthStatus.UNKNOWN,
          healthScore: 0,
          healthMessage: null,
          healthCheckedAt: null,
          decisionRequired: false,
        })
      );
    });
  });

  // ─── updateJobPriority ────────────────────────────────────────────────────────

  describe('updateJobPriority', () => {
    it('should throw NotFoundException when job not found', async () => {
      jobRepository.findById.mockResolvedValue(null);

      await expect(service.updateJobPriority('job-1', 1)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when priority is out of range', async () => {
      jobRepository.findById.mockResolvedValue(makeJob() as any);

      await expect(service.updateJobPriority('job-1', 5)).rejects.toThrow(
        'Priority must be between 0 and 2'
      );
    });

    it('should throw BadRequestException when more than 3 jobs have top priority', async () => {
      jobRepository.findById.mockResolvedValue(makeJob() as any);
      jobRepository.countWhere.mockResolvedValue(3);

      await expect(service.updateJobPriority('job-1', 2)).rejects.toThrow(
        'Maximum 3 jobs can have top priority'
      );
    });

    it('should renice FFmpeg process when job is ENCODING', async () => {
      const job = makeJob({ stage: JobStage.ENCODING }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.countWhere.mockResolvedValue(0);
      jobRepository.updateById.mockResolvedValue(job);
      ffmpegService.reniceProcess.mockResolvedValue(undefined as any);

      await service.updateJobPriority('job-1', 2);

      expect(ffmpegService.reniceProcess).toHaveBeenCalledWith('job-1', 2);
    });

    it('should not throw when reniceProcess fails', async () => {
      const job = makeJob({ stage: JobStage.ENCODING }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.countWhere.mockResolvedValue(0);
      jobRepository.updateById.mockResolvedValue(job);
      ffmpegService.reniceProcess.mockRejectedValue(new Error('renice failed'));

      await expect(service.updateJobPriority('job-1', 2)).resolves.not.toBeUndefined();
    });

    it('should not call reniceProcess when job is not ENCODING', async () => {
      const job = makeJob({ stage: JobStage.QUEUED }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue(job);

      await service.updateJobPriority('job-1', 1);

      expect(ffmpegService.reniceProcess).not.toHaveBeenCalled();
    });
  });

  // ─── resolveDecision ─────────────────────────────────────────────────────────

  describe('resolveDecision', () => {
    it('should throw NotFoundException when job not found', async () => {
      jobRepository.findById.mockResolvedValue(null);

      await expect(service.resolveDecision('job-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when job is not in NEEDS_DECISION stage', async () => {
      jobRepository.findById.mockResolvedValue(makeJob({ stage: JobStage.QUEUED }) as any);

      await expect(service.resolveDecision('job-1')).rejects.toThrow(
        'Can only resolve decisions for jobs in NEEDS_DECISION stage'
      );
    });

    it('should mark job COMPLETED when action is skip', async () => {
      const job = makeJob({ stage: JobStage.NEEDS_DECISION }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.COMPLETED });

      const result = await service.resolveDecision('job-1', {
        actionConfig: { action: 'skip' },
      });

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.COMPLETED,
        })
      );
      expect(result.stage).toBe(JobStage.COMPLETED);
    });

    it('should mark job CANCELLED when action is cancel', async () => {
      const job = makeJob({ stage: JobStage.NEEDS_DECISION }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateById.mockResolvedValue({ ...job, stage: JobStage.CANCELLED });

      const result = await service.resolveDecision('job-1', {
        actionConfig: { action: 'cancel', reason: 'user_requested' },
      });

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.CANCELLED,
        })
      );
      expect(result.stage).toBe(JobStage.CANCELLED);
    });

    it('should set type to REMUX when audioAction is copy', async () => {
      const job = makeJob({ stage: JobStage.NEEDS_DECISION }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateRaw.mockResolvedValue({ ...job, stage: JobStage.QUEUED, type: 'REMUX' });

      const result = await service.resolveDecision('job-1', {
        actionConfig: { audioAction: 'copy' },
      });

      expect(jobRepository.updateRaw).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          type: 'REMUX',
        })
      );
      expect(result.type).toBe('REMUX');
    });

    it('should set type to ENCODE when action is force_encode', async () => {
      const job = makeJob({ stage: JobStage.NEEDS_DECISION }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateRaw.mockResolvedValue({ ...job, stage: JobStage.QUEUED, type: 'ENCODE' });

      await service.resolveDecision('job-1', {
        actionConfig: { action: 'force_encode' },
      });

      expect(jobRepository.updateRaw).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          type: 'ENCODE',
        })
      );
    });

    it('should move to QUEUED with no decisionData when called without args', async () => {
      const job = makeJob({ stage: JobStage.NEEDS_DECISION }) as any;
      jobRepository.findById.mockResolvedValue(job);
      jobRepository.updateRaw.mockResolvedValue({ ...job, stage: JobStage.QUEUED });

      await service.resolveDecision('job-1');

      expect(jobRepository.updateRaw).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.QUEUED,
          decisionData: null,
        })
      );
    });
  });

  // ─── Delegation methods ───────────────────────────────────────────────────────

  describe('delegated bulk operations', () => {
    it('should delegate cancelAllQueued to jobBulkOperationsService', async () => {
      jobBulkOperationsService.cancelAllQueued.mockResolvedValue({ cancelledCount: 5 });

      const result = await service.cancelAllQueued();

      expect(jobBulkOperationsService.cancelAllQueued).toHaveBeenCalled();
      expect(result).toEqual({ cancelledCount: 5 });
    });

    it('should delegate categorizeError to jobBulkOperationsService', () => {
      jobBulkOperationsService.categorizeError.mockReturnValue('CODEC_ERROR');

      const result = service.categorizeError('codec not supported');

      expect(result).toBe('CODEC_ERROR');
    });
  });

  describe('delegated file operations', () => {
    it('should delegate requestKeepOriginal to jobFileOperationsService', async () => {
      const job = makeJob() as any;
      jobFileOperationsService.requestKeepOriginal.mockResolvedValue(job);

      const result = await service.requestKeepOriginal('job-1');

      expect(jobFileOperationsService.requestKeepOriginal).toHaveBeenCalledWith('job-1');
      expect(result).toBe(job);
    });

    it('should delegate recheckFailedJob to jobFileOperationsService', async () => {
      const job = makeJob() as any;
      jobFileOperationsService.recheckFailedJob.mockResolvedValue(job);

      const result = await service.recheckFailedJob('job-1');

      expect(jobFileOperationsService.recheckFailedJob).toHaveBeenCalledWith('job-1');
      expect(result).toBe(job);
    });
  });
});
