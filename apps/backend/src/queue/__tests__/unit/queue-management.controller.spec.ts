import { Test, type TestingModule } from '@nestjs/testing';
import { QueueManagementController } from '../../controllers/queue-management.controller';
import { QueueService } from '../../queue.service';

describe('QueueManagementController', () => {
  let controller: QueueManagementController;

  const mockQueueService = {
    cancelAllQueued: jest.fn(),
    retryAllCancelled: jest.fn(),
    retryAllFailed: jest.fn(),
    skipAllCodecMatch: jest.fn(),
    forceEncodeAllCodecMatch: jest.fn(),
    clearJobs: jest.fn(),
    rebalanceJobs: jest.fn(),
    fixStuckTransfers: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QueueManagementController],
      providers: [{ provide: QueueService, useValue: mockQueueService }],
    }).compile();

    controller = module.get<QueueManagementController>(QueueManagementController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // cancelAll
  // ---------------------------------------------------------------------------
  describe('cancelAll', () => {
    it('should cancel all queued jobs and return count', async () => {
      mockQueueService.cancelAllQueued.mockResolvedValue({ cancelledCount: 5 });

      const result = await controller.cancelAll();

      expect(mockQueueService.cancelAllQueued).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ cancelledCount: 5 });
    });

    it('should return zero when no queued jobs exist', async () => {
      mockQueueService.cancelAllQueued.mockResolvedValue({ cancelledCount: 0 });

      const result = await controller.cancelAll();

      expect(result).toEqual({ cancelledCount: 0 });
    });

    it('should propagate service errors', async () => {
      mockQueueService.cancelAllQueued.mockRejectedValue(new Error('db error'));
      await expect(controller.cancelAll()).rejects.toThrow('db error');
    });
  });

  // ---------------------------------------------------------------------------
  // retryAllCancelled
  // ---------------------------------------------------------------------------
  describe('retryAllCancelled', () => {
    it('should retry all cancelled jobs and return summary', async () => {
      const response = {
        retriedCount: 3,
        totalSizeBytes: '1073741824',
        jobs: [
          { id: 'job-1', fileLabel: 'movie.mkv', beforeSizeBytes: BigInt(536870912) },
          { id: 'job-2', fileLabel: 'show.mp4', beforeSizeBytes: BigInt(268435456) },
        ],
      };
      mockQueueService.retryAllCancelled.mockResolvedValue(response);

      const result = await controller.retryAllCancelled();

      expect(mockQueueService.retryAllCancelled).toHaveBeenCalledTimes(1);
      expect(result).toEqual(response);
      expect(result.retriedCount).toBe(3);
    });

    it('should return empty jobs list when no cancelled jobs', async () => {
      mockQueueService.retryAllCancelled.mockResolvedValue({
        retriedCount: 0,
        totalSizeBytes: '0',
        jobs: [],
      });

      const result = await controller.retryAllCancelled();

      expect(result.retriedCount).toBe(0);
      expect(result.jobs).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // retryAllFailed
  // ---------------------------------------------------------------------------
  describe('retryAllFailed', () => {
    it('should retry all failed jobs when no error filter provided', async () => {
      const response = {
        retriedCount: 4,
        jobs: [{ id: 'job-1', fileLabel: 'movie.mkv', error: 'FFmpeg exit code 1' }],
      };
      mockQueueService.retryAllFailed.mockResolvedValue(response);

      const result = await controller.retryAllFailed();

      expect(mockQueueService.retryAllFailed).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(response);
    });

    it('should pass errorFilter to service when provided', async () => {
      const response = {
        retriedCount: 2,
        jobs: [{ id: 'job-2', fileLabel: 'clip.mp4', error: 'FFmpeg failed with exit code 255' }],
      };
      mockQueueService.retryAllFailed.mockResolvedValue(response);

      const result = await controller.retryAllFailed('FFmpeg Error Code 255');

      expect(mockQueueService.retryAllFailed).toHaveBeenCalledWith('FFmpeg Error Code 255');
      expect(result).toEqual(response);
    });

    it('should return empty list when no jobs match the filter', async () => {
      mockQueueService.retryAllFailed.mockResolvedValue({ retriedCount: 0, jobs: [] });

      const result = await controller.retryAllFailed('File Not Found');

      expect(result.retriedCount).toBe(0);
      expect(result.jobs).toHaveLength(0);
    });

    it('should propagate service errors', async () => {
      mockQueueService.retryAllFailed.mockRejectedValue(new Error('db error'));
      await expect(controller.retryAllFailed()).rejects.toThrow('db error');
    });
  });

  // ---------------------------------------------------------------------------
  // skipAllCodecMatch
  // ---------------------------------------------------------------------------
  describe('skipAllCodecMatch', () => {
    it('should skip all codec-match jobs and return summary', async () => {
      const response = {
        skippedCount: 3,
        jobs: [
          { id: 'job-1', fileLabel: 'movie.mkv', sourceCodec: 'hevc', targetCodec: 'hevc' },
          { id: 'job-2', fileLabel: 'show.mkv', sourceCodec: 'hevc', targetCodec: 'hevc' },
        ],
      };
      mockQueueService.skipAllCodecMatch.mockResolvedValue(response);

      const result = await controller.skipAllCodecMatch();

      expect(mockQueueService.skipAllCodecMatch).toHaveBeenCalledTimes(1);
      expect(result).toEqual(response);
      expect(result.skippedCount).toBe(3);
    });

    it('should return empty list when no codec-match jobs', async () => {
      mockQueueService.skipAllCodecMatch.mockResolvedValue({ skippedCount: 0, jobs: [] });

      const result = await controller.skipAllCodecMatch();

      expect(result.skippedCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // forceEncodeAllCodecMatch
  // ---------------------------------------------------------------------------
  describe('forceEncodeAllCodecMatch', () => {
    it('should queue codec-match jobs for force encoding', async () => {
      const response = {
        queuedCount: 2,
        jobs: [{ id: 'job-1', fileLabel: 'movie.mkv', sourceCodec: 'hevc', targetCodec: 'hevc' }],
      };
      mockQueueService.forceEncodeAllCodecMatch.mockResolvedValue(response);

      const result = await controller.forceEncodeAllCodecMatch();

      expect(mockQueueService.forceEncodeAllCodecMatch).toHaveBeenCalledTimes(1);
      expect(result).toEqual(response);
    });

    it('should propagate service errors', async () => {
      mockQueueService.forceEncodeAllCodecMatch.mockRejectedValue(new Error('db error'));
      await expect(controller.forceEncodeAllCodecMatch()).rejects.toThrow('db error');
    });
  });

  // ---------------------------------------------------------------------------
  // clearJobs
  // ---------------------------------------------------------------------------
  describe('clearJobs', () => {
    it('should delete all jobs when no stages filter provided', async () => {
      mockQueueService.clearJobs.mockResolvedValue(42);

      const result = await controller.clearJobs();

      expect(mockQueueService.clearJobs).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ deleted: 42 });
    });

    it('should filter by parsed stages when stagesParam is provided', async () => {
      mockQueueService.clearJobs.mockResolvedValue(10);

      const result = await controller.clearJobs('COMPLETED,FAILED');

      expect(mockQueueService.clearJobs).toHaveBeenCalledWith(['COMPLETED', 'FAILED']);
      expect(result).toEqual({ deleted: 10 });
    });

    it('should trim whitespace from stage names', async () => {
      mockQueueService.clearJobs.mockResolvedValue(5);

      await controller.clearJobs('COMPLETED, FAILED , CANCELLED');

      expect(mockQueueService.clearJobs).toHaveBeenCalledWith(['COMPLETED', 'FAILED', 'CANCELLED']);
    });

    it('should return deleted count of zero when no matching jobs', async () => {
      mockQueueService.clearJobs.mockResolvedValue(0);

      const result = await controller.clearJobs('COMPLETED');

      expect(result).toEqual({ deleted: 0 });
    });

    it('should propagate service errors', async () => {
      mockQueueService.clearJobs.mockRejectedValue(new Error('db error'));
      await expect(controller.clearJobs()).rejects.toThrow('db error');
    });
  });

  // ---------------------------------------------------------------------------
  // rebalanceJobs
  // ---------------------------------------------------------------------------
  describe('rebalanceJobs', () => {
    it('should return rebalanced count with message when jobs were moved', async () => {
      mockQueueService.rebalanceJobs.mockResolvedValue(7);

      const result = await controller.rebalanceJobs();

      expect(mockQueueService.rebalanceJobs).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        jobsRebalanced: 7,
        message: 'Redistributed 7 job(s) across nodes',
      });
    });

    it('should return no-op message when no rebalancing needed', async () => {
      mockQueueService.rebalanceJobs.mockResolvedValue(0);

      const result = await controller.rebalanceJobs();

      expect(result).toEqual({
        jobsRebalanced: 0,
        message: 'No rebalancing needed - jobs are already well distributed',
      });
    });

    it('should propagate service errors', async () => {
      mockQueueService.rebalanceJobs.mockRejectedValue(new Error('rebalance failed'));
      await expect(controller.rebalanceJobs()).rejects.toThrow('rebalance failed');
    });
  });

  // ---------------------------------------------------------------------------
  // fixStuckTransfers
  // ---------------------------------------------------------------------------
  describe('fixStuckTransfers', () => {
    it('should return fixed count with message when stuck transfers were reset', async () => {
      mockQueueService.fixStuckTransfers.mockResolvedValue(5);

      const result = await controller.fixStuckTransfers();

      expect(mockQueueService.fixStuckTransfers).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        fixed: 5,
        message: 'Reset 5 stuck transfer(s) back to QUEUED',
      });
    });

    it('should return no-op message when no stuck transfers found', async () => {
      mockQueueService.fixStuckTransfers.mockResolvedValue(0);

      const result = await controller.fixStuckTransfers();

      expect(result).toEqual({
        fixed: 0,
        message: 'No stuck transfers found',
      });
    });

    it('should propagate service errors', async () => {
      mockQueueService.fixStuckTransfers.mockRejectedValue(new Error('db error'));
      await expect(controller.fixStuckTransfers()).rejects.toThrow('db error');
    });
  });
});
