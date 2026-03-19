import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JobFileOperationsService } from './job-file-operations.service';
import { JobMetricsService } from './job-metrics.service';
import { QueueJobCrudService } from './queue-job-crud.service';

describe('JobFileOperationsService', () => {
  let service: JobFileOperationsService;
  let mockPrisma: any;
  let mockJobCrudService: jest.Mocked<QueueJobCrudService>;
  let mockFfmpegService: jest.Mocked<FfmpegService>;
  let mockJobMetricsService: jest.Mocked<JobMetricsService>;

  const makeJob = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    stage: JobStage.ENCODING,
    filePath: '/media/movie.mkv',
    fileLabel: 'movie.mkv',
    beforeSizeBytes: BigInt(1_000_000_000),
    afterSizeBytes: BigInt(500_000_000),
    savedBytes: BigInt(0),
    savedPercent: 0,
    originalBackupPath: null,
    originalSizeBytes: null,
    contentFingerprint: null,
    error: 'original error',
    progress: 0,
    ...overrides,
  });

  beforeEach(async () => {
    mockPrisma = {
      job: { update: jest.fn() },
      $transaction: jest.fn(),
    };

    mockJobCrudService = {
      findOne: jest.fn(),
    } as any;

    mockFfmpegService = {
      verifyFile: jest.fn(),
    } as any;

    mockJobMetricsService = {
      updateMetrics: jest.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobFileOperationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QueueJobCrudService, useValue: mockJobCrudService },
        { provide: FfmpegService, useValue: mockFfmpegService },
        { provide: JobMetricsService, useValue: mockJobMetricsService },
      ],
    }).compile();

    service = module.get<JobFileOperationsService>(JobFileOperationsService);
  });

  describe('requestKeepOriginal', () => {
    it('should set keepOriginalRequested for encoding job', async () => {
      const job = makeJob({ stage: JobStage.ENCODING });
      mockJobCrudService.findOne.mockResolvedValue(job as any);
      const updatedJob = { ...job, keepOriginalRequested: true };
      mockPrisma.job.update.mockResolvedValue(updatedJob);

      const _result = await service.requestKeepOriginal('job-1');

      expect(mockPrisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ keepOriginalRequested: true }),
        })
      );
    });

    it('should throw BadRequestException when job is not encoding', async () => {
      mockJobCrudService.findOne.mockResolvedValue(makeJob({ stage: JobStage.COMPLETED }) as any);

      await expect(service.requestKeepOriginal('job-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteOriginalBackup', () => {
    it('should throw BadRequestException when no backup exists', async () => {
      mockJobCrudService.findOne.mockResolvedValue(makeJob({ originalBackupPath: null }) as any);

      await expect(service.deleteOriginalBackup('job-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('restoreOriginal', () => {
    it('should throw BadRequestException when no backup to restore', async () => {
      mockJobCrudService.findOne.mockResolvedValue(makeJob({ originalBackupPath: null }) as any);

      await expect(service.restoreOriginal('job-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('recheckFailedJob', () => {
    it('should throw BadRequestException when job is not FAILED', async () => {
      mockJobCrudService.findOne.mockResolvedValue(makeJob({ stage: JobStage.ENCODING }) as any);

      await expect(service.recheckFailedJob('job-1')).rejects.toThrow(BadRequestException);
    });

    it('should update error message when file does not exist', async () => {
      const job = makeJob({ stage: JobStage.FAILED });
      mockJobCrudService.findOne.mockResolvedValue(job as any);
      mockPrisma.job.update.mockResolvedValue({
        ...job,
        error: 'RECHECK FAILED: File does not exist',
      });

      // File does not exist (fs.stat will throw ENOENT)
      jest
        .spyOn(require('fs/promises'), 'stat')
        .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const _result = await service.recheckFailedJob('job-1');
      expect(mockPrisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ error: expect.stringContaining('RECHECK FAILED') }),
        })
      );
    });
  });

  describe('detectAndRequeueIfUncompressed', () => {
    it('should throw BadRequestException when job is not COMPLETED', async () => {
      mockJobCrudService.findOne.mockResolvedValue(makeJob({ stage: JobStage.FAILED }) as any);

      await expect(service.detectAndRequeueIfUncompressed('job-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException when file was compressed', async () => {
      const job = makeJob({ stage: JobStage.COMPLETED, savedBytes: BigInt(100_000) });
      mockJobCrudService.findOne.mockResolvedValue(job as any);

      await expect(service.detectAndRequeueIfUncompressed('job-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('should requeue job when no compression detected', async () => {
      const job = makeJob({ stage: JobStage.COMPLETED, savedBytes: BigInt(0) });
      mockJobCrudService.findOne.mockResolvedValue(job as any);
      mockPrisma.job.update.mockResolvedValue({ ...job, stage: JobStage.QUEUED });

      const _result = await service.detectAndRequeueIfUncompressed('job-1');

      expect(mockPrisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stage: JobStage.QUEUED }),
        })
      );
    });
  });
});
