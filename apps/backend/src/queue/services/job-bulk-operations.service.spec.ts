import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../common/repositories/job.repository';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import { JobBulkOperationsService } from './job-bulk-operations.service';

describe('JobBulkOperationsService', () => {
  let service: JobBulkOperationsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jobRepository: any;
  let ffmpegService: jest.Mocked<FfmpegService>;

  beforeEach(async () => {
    const jobRepositoryMock = {
      findManySelect: jest.fn(),
      updateManyWhere: jest.fn(),
      updateManyByIds: jest.fn(),
      updateById: jest.fn(),
    };

    const ffmpegMock = {
      killProcess: jest.fn(),
    } as unknown as jest.Mocked<FfmpegService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobBulkOperationsService,
        { provide: JobRepository, useValue: jobRepositoryMock },
        { provide: FfmpegService, useValue: ffmpegMock },
      ],
    }).compile();

    service = module.get<JobBulkOperationsService>(JobBulkOperationsService);
    jobRepository = module.get(JobRepository);
    ffmpegService = module.get(FfmpegService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('cancelAllQueued', () => {
    it('should kill ffmpeg processes for encoding jobs then cancel all active stages', async () => {
      const encodingJobs = [
        { id: 'job-1', fileLabel: 'movie1.mkv' },
        { id: 'job-2', fileLabel: 'movie2.mkv' },
      ];
      jobRepository.findManySelect.mockResolvedValue(encodingJobs as never);
      jobRepository.updateManyWhere.mockResolvedValue({ count: 5 } as never);
      ffmpegService.killProcess.mockResolvedValue(true);

      const result = await service.cancelAllQueued();

      expect(ffmpegService.killProcess).toHaveBeenCalledWith('job-1');
      expect(ffmpegService.killProcess).toHaveBeenCalledWith('job-2');
      expect(jobRepository.updateManyWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: expect.objectContaining({ in: expect.arrayContaining([JobStage.ENCODING]) }),
        }),
        expect.objectContaining({ stage: JobStage.CANCELLED })
      );
      expect(result.cancelledCount).toBe(5);
    });

    it('should still cancel jobs even if no encoding jobs are running', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);
      jobRepository.updateManyWhere.mockResolvedValue({ count: 3 } as never);

      const result = await service.cancelAllQueued();

      expect(ffmpegService.killProcess).not.toHaveBeenCalled();
      expect(result.cancelledCount).toBe(3);
    });

    it('should propagate errors from repository', async () => {
      jobRepository.findManySelect.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.cancelAllQueued()).rejects.toThrow('DB connection lost');
    });
  });

  describe('retryAllCancelled', () => {
    it('should requeue all cancelled jobs and return count and size', async () => {
      const cancelledJobs = [
        { id: 'job-1', fileLabel: 'a.mkv', beforeSizeBytes: BigInt(500000000) },
        { id: 'job-2', fileLabel: 'b.mkv', beforeSizeBytes: BigInt(300000000) },
      ];
      jobRepository.findManySelect.mockResolvedValue(cancelledJobs as never);
      jobRepository.updateManyWhere.mockResolvedValue({ count: 2 } as never);

      const result = await service.retryAllCancelled();

      expect(jobRepository.updateManyWhere).toHaveBeenCalledWith(
        { stage: JobStage.CANCELLED },
        expect.objectContaining({ stage: JobStage.QUEUED, progress: 0 })
      );
      expect(result.retriedCount).toBe(2);
      expect(result.totalSizeBytes).toBe('800000000');
      expect(result.jobs).toHaveLength(2);
    });

    it('should return zero count when no cancelled jobs exist', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);
      jobRepository.updateManyWhere.mockResolvedValue({ count: 0 } as never);

      const result = await service.retryAllCancelled();

      expect(result.retriedCount).toBe(0);
      expect(result.totalSizeBytes).toBe('0');
    });
  });

  describe('retryAllFailed', () => {
    it('should requeue all failed jobs when no filter is provided', async () => {
      const failedJobs = [
        { id: 'job-1', fileLabel: 'a.mkv', error: 'FFmpeg exit code 1' },
        { id: 'job-2', fileLabel: 'b.mkv', error: 'File not found' },
      ];
      jobRepository.findManySelect.mockResolvedValue(failedJobs as never);
      jobRepository.updateManyByIds.mockResolvedValue({ count: 2 } as never);

      const result = await service.retryAllFailed();

      expect(result.retriedCount).toBe(2);
      expect(result.jobs).toHaveLength(2);
    });

    it('should filter by error category when errorFilter is provided', async () => {
      const failedJobs = [
        { id: 'job-1', fileLabel: 'a.mkv', error: 'FFmpeg exit code 1' },
        { id: 'job-2', fileLabel: 'b.mkv', error: 'No such file or directory (ENOENT)' },
      ];
      jobRepository.findManySelect.mockResolvedValue(failedJobs as never);
      jobRepository.updateManyByIds.mockResolvedValue({ count: 1 } as never);

      const result = await service.retryAllFailed('File Not Found');

      // Only the ENOENT job should be retried
      const retryIds = jobRepository.updateManyByIds.mock.calls[0][0] as string[];
      expect(retryIds).toEqual(['job-2']);
      expect(result.jobs).toHaveLength(1);
    });
  });

  describe('categorizeError', () => {
    it('should categorize FFmpeg exit code errors', () => {
      expect(service.categorizeError('FFmpeg exit code 1')).toBe('FFmpeg Error Code 1');
      expect(service.categorizeError('ffmpeg process exit code 255')).toBe('FFmpeg Error Code 255');
    });

    it('should categorize timeout errors', () => {
      expect(service.categorizeError('Job timeout after 30 minutes')).toBe('Job Timeout/Stuck');
      expect(service.categorizeError('Process stuck with no progress')).toBe('Job Timeout/Stuck');
    });

    it('should categorize file not found errors', () => {
      expect(service.categorizeError('No such file or directory (ENOENT)')).toBe('File Not Found');
      expect(service.categorizeError('File not found: movie.mkv')).toBe('File Not Found');
    });

    it('should categorize network errors', () => {
      expect(service.categorizeError('ECONNREFUSED 127.0.0.1:3100')).toBe('Network Error');
      expect(service.categorizeError('Network connection reset')).toBe('Network Error');
    });

    it('should categorize disk space errors', () => {
      expect(service.categorizeError('ENOSPC: no space left on device')).toBe('Disk Space Error');
      expect(service.categorizeError('disk full, cannot write')).toBe('Disk Space Error');
    });

    it('should categorize permission errors', () => {
      expect(service.categorizeError('EACCES permission denied')).toBe('Permission Error');
      expect(service.categorizeError('EPERM: operation not permitted')).toBe('Permission Error');
    });

    it('should categorize memory errors', () => {
      expect(service.categorizeError('out of memory')).toBe('Memory Error');
      expect(service.categorizeError('ENOMEM')).toBe('Memory Error');
    });

    it('should return the raw error for unrecognized errors', () => {
      const unknownError = 'Some completely unknown error XYZ';
      expect(service.categorizeError(unknownError)).toBe(unknownError);
    });

    it('should return "Unknown error" for empty string', () => {
      expect(service.categorizeError('')).toBe('Unknown error');
    });
  });

  describe('skipAllCodecMatch', () => {
    it('should skip NEEDS_DECISION jobs where source codec matches target', async () => {
      const needsDecisionJobs = [
        {
          id: 'job-1',
          fileLabel: 'hevc-file.mkv',
          sourceCodec: 'hevc',
          targetCodec: 'hevc',
          beforeSizeBytes: BigInt(1000),
          decisionIssues: null,
        },
        {
          id: 'job-2',
          fileLabel: 'h264-file.mkv',
          sourceCodec: 'h264',
          targetCodec: 'hevc',
          beforeSizeBytes: BigInt(2000),
          decisionIssues: null,
        },
      ];
      jobRepository.findManySelect.mockResolvedValue(needsDecisionJobs as never);
      jobRepository.updateManyByIds.mockResolvedValue({ count: 1 } as never);
      jobRepository.updateById.mockResolvedValue({} as never);

      const result = await service.skipAllCodecMatch();

      // Only job-1 (hevc→hevc) should be skipped
      const updatedIds = jobRepository.updateManyByIds.mock.calls[0][0] as string[];
      expect(updatedIds).toEqual(['job-1']);
      expect(result.skippedCount).toBe(1);
      expect(result.jobs[0].fileLabel).toBe('hevc-file.mkv');
    });

    it('should return zero count when no codec-match jobs exist', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);

      const result = await service.skipAllCodecMatch();

      expect(result.skippedCount).toBe(0);
      expect(result.jobs).toEqual([]);
      expect(jobRepository.updateManyByIds).not.toHaveBeenCalled();
    });

    it('should mark skipped jobs as COMPLETED', async () => {
      const needsDecisionJobs = [
        {
          id: 'job-1',
          fileLabel: 'file.mkv',
          sourceCodec: 'hevc',
          targetCodec: 'hevc',
          beforeSizeBytes: BigInt(1000),
          decisionIssues: null,
        },
      ];
      jobRepository.findManySelect.mockResolvedValue(needsDecisionJobs as never);
      jobRepository.updateManyByIds.mockResolvedValue({ count: 1 } as never);
      jobRepository.updateById.mockResolvedValue({} as never);

      await service.skipAllCodecMatch();

      const updateData = jobRepository.updateManyByIds.mock.calls[0][1] as { stage: string };
      expect(updateData.stage).toBe(JobStage.COMPLETED);
    });
  });

  describe('forceEncodeAllCodecMatch', () => {
    it('should queue codec-match jobs for force encoding', async () => {
      const needsDecisionJobs = [
        {
          id: 'job-1',
          fileLabel: 'hevc-file.mkv',
          sourceCodec: 'hevc',
          targetCodec: 'hevc',
          decisionIssues: null,
        },
      ];
      jobRepository.findManySelect.mockResolvedValue(needsDecisionJobs as never);
      jobRepository.updateManyByIds.mockResolvedValue({ count: 1 } as never);

      const result = await service.forceEncodeAllCodecMatch();

      const updateData = jobRepository.updateManyByIds.mock.calls[0][1] as { stage: string };
      expect(updateData.stage).toBe(JobStage.QUEUED);
      expect(result.queuedCount).toBe(1);
    });

    it('should return zero count when no codec-match jobs exist', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);

      const result = await service.forceEncodeAllCodecMatch();

      expect(result.queuedCount).toBe(0);
      expect(jobRepository.updateManyByIds).not.toHaveBeenCalled();
    });
  });
});
