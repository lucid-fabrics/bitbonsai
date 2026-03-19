import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JobFileOperationsService } from './job-file-operations.service';
import { JobMetricsService } from './job-metrics.service';
import { QueueJobCrudService } from './queue-job-crud.service';

describe('JobFileOperationsService', () => {
  let service: JobFileOperationsService;
  let mockPrisma: { job: { update: jest.Mock }; $transaction: jest.Mock };
  let mockJobRepository: { updateById: jest.Mock; updateByIdWithInclude: jest.Mock };
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

    mockJobRepository = {
      updateById: jest.fn(),
      updateByIdWithInclude: jest.fn(),
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
        { provide: JobRepository, useValue: mockJobRepository },
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
      mockJobRepository.updateById.mockResolvedValue(updatedJob);

      const _result = await service.requestKeepOriginal('job-1');

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ keepOriginalRequested: true })
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
      mockJobRepository.updateById.mockResolvedValue({
        ...job,
        error: 'RECHECK FAILED: File does not exist',
      });

      // File does not exist (fs.stat will throw ENOENT)
      jest
        .spyOn(require('fs/promises'), 'stat')
        .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const _result = await service.recheckFailedJob('job-1');
      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ error: expect.stringContaining('RECHECK FAILED') })
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
      mockJobRepository.updateByIdWithInclude.mockResolvedValue({ ...job, stage: JobStage.QUEUED });

      const _result = await service.detectAndRequeueIfUncompressed('job-1');

      expect(mockJobRepository.updateByIdWithInclude).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ stage: JobStage.QUEUED }),
        expect.anything()
      );
    });
  });

  describe('deleteOriginalBackup - success path', () => {
    it('should delete file and clear backup fields when backup exists', async () => {
      const job = makeJob({
        originalBackupPath: '/media/movie.mkv.orig',
        originalSizeBytes: BigInt(1_000_000),
      });
      mockJobCrudService.findOne.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({ ...job, originalBackupPath: null });

      jest.spyOn(require('fs/promises'), 'unlink').mockResolvedValue(undefined);

      const result = await service.deleteOriginalBackup('job-1');

      expect(result.freedSpace).toBe(BigInt(1_000_000));
      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ originalBackupPath: null, originalSizeBytes: null })
      );
    });

    it('should use BigInt(0) when originalSizeBytes is null', async () => {
      const job = makeJob({
        originalBackupPath: '/media/movie.mkv.orig',
        originalSizeBytes: null,
      });
      mockJobCrudService.findOne.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({ ...job, originalBackupPath: null });
      jest.spyOn(require('fs/promises'), 'unlink').mockResolvedValue(undefined);

      const result = await service.deleteOriginalBackup('job-1');

      expect(result.freedSpace).toBe(BigInt(0));
    });

    it('should throw BadRequestException when file deletion fails', async () => {
      const job = makeJob({ originalBackupPath: '/media/movie.mkv.orig' });
      mockJobCrudService.findOne.mockResolvedValue(job as any);
      jest
        .spyOn(require('fs/promises'), 'unlink')
        .mockRejectedValue(new Error('Permission denied'));

      await expect(service.deleteOriginalBackup('job-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('restoreOriginal - success path', () => {
    it('should rename files and update job when backup exists', async () => {
      const job = makeJob({
        stage: JobStage.COMPLETED,
        filePath: '/media/movie.mkv',
        originalBackupPath: '/media/movie.mkv.orig',
      });
      mockJobCrudService.findOne.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({
        ...job,
        originalBackupPath: '/media/movie.mkv.encoded',
      });
      jest.spyOn(require('fs/promises'), 'rename').mockResolvedValue(undefined);

      const _result = await service.restoreOriginal('job-1');

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ replacementAction: 'KEPT_BOTH' })
      );
    });

    it('should throw BadRequestException when rename fails', async () => {
      const job = makeJob({ originalBackupPath: '/media/movie.mkv.orig' });
      mockJobCrudService.findOne.mockResolvedValue(job as any);
      jest
        .spyOn(require('fs/promises'), 'rename')
        .mockRejectedValue(new Error('ENOENT: no such file'));

      await expect(service.restoreOriginal('job-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('recheckFailedJob - success paths', () => {
    it('should mark job COMPLETED when file is valid and compressed', async () => {
      const job = makeJob({
        stage: JobStage.FAILED,
        filePath: '/media/movie.mkv',
        beforeSizeBytes: BigInt(1_000_000_000),
        error: 'encoding crashed',
      });
      mockJobCrudService.findOne.mockResolvedValue(job as any);
      mockFfmpegService.verifyFile.mockResolvedValue({ isValid: true });

      jest.spyOn(require('fs/promises'), 'stat').mockResolvedValue({
        isFile: () => true,
        size: 700_000_000,
      } as any);

      const completedJob = { ...job, stage: JobStage.COMPLETED, savedPercent: 30 };
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        return cb({
          job: {
            update: jest.fn().mockResolvedValue(completedJob),
          },
        });
      });

      const _result = await service.recheckFailedJob('job-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should update error message when file exists but fails health check', async () => {
      const job = makeJob({ stage: JobStage.FAILED });
      mockJobCrudService.findOne.mockResolvedValue(job as any);
      mockFfmpegService.verifyFile.mockResolvedValue({
        isValid: false,
        error: 'invalid codec data',
      });

      jest.spyOn(require('fs/promises'), 'stat').mockResolvedValue({
        isFile: () => true,
        size: 500_000_000,
      } as any);

      mockJobRepository.updateById.mockResolvedValue({
        ...job,
        error: 'RECHECK FAILED: File exists but failed health check',
      });

      const _result = await service.recheckFailedJob('job-1');

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ error: expect.stringContaining('failed health check') })
      );
    });

    it('should update error when file exists but is not compressed (savedBytes <= 0)', async () => {
      const job = makeJob({
        stage: JobStage.FAILED,
        beforeSizeBytes: BigInt(1_000_000_000),
      });
      mockJobCrudService.findOne.mockResolvedValue(job as any);
      mockFfmpegService.verifyFile.mockResolvedValue({ isValid: true });

      // File is larger than original (no compression or grew)
      jest.spyOn(require('fs/promises'), 'stat').mockResolvedValue({
        isFile: () => true,
        size: 1_500_000_000, // bigger than before
      } as any);

      mockJobRepository.updateById.mockResolvedValue({
        ...job,
        error: 'RECHECK FAILED: Encoding did not compress the file.',
      });

      const _result = await service.recheckFailedJob('job-1');

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          error: expect.stringContaining('RECHECK FAILED: Encoding did not compress'),
        })
      );
    });
  });

  describe('requestKeepOriginal - originalSizeBytes', () => {
    it('should set originalSizeBytes from job.beforeSizeBytes', async () => {
      const job = makeJob({ stage: JobStage.ENCODING, beforeSizeBytes: BigInt(2_000_000_000) });
      mockJobCrudService.findOne.mockResolvedValue(job as any);
      mockJobRepository.updateById.mockResolvedValue({
        ...job,
        keepOriginalRequested: true,
        originalSizeBytes: BigInt(2_000_000_000),
      });

      await service.requestKeepOriginal('job-1');

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ originalSizeBytes: BigInt(2_000_000_000) })
      );
    });
  });
});
