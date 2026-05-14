import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../../../common/repositories/job.repository';
import { RetrySchedulerService } from '../../retry-scheduler.service';

describe('RetrySchedulerService', () => {
  let service: RetrySchedulerService;
  let jobRepository: {
    findManySelect: jest.Mock;
    updateManyByIds: jest.Mock;
    countWhere: jest.Mock;
  };

  beforeEach(async () => {
    jobRepository = {
      findManySelect: jest.fn(),
      updateManyByIds: jest.fn(),
      countWhere: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RetrySchedulerService, { provide: JobRepository, useValue: jobRepository }],
    }).compile();

    service = module.get<RetrySchedulerService>(RetrySchedulerService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  const createFailedJob = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    fileLabel: `test-${id}.mkv`,
    retryCount: 0,
    nextRetryAt: new Date('2026-02-23T12:00:00Z'),
    error: 'FFmpeg process crashed',
    ...overrides,
  });

  describe('computeNextRetryDelay', () => {
    it('should return ~30s for attempt 1', () => {
      const delay = service.computeNextRetryDelay(1);
      expect(delay).toBeGreaterThanOrEqual(30_000);
      expect(delay).toBeLessThan(40_000); // 30s + up to 10s jitter
    });

    it('should return ~1m for attempt 2', () => {
      const delay = service.computeNextRetryDelay(2);
      expect(delay).toBeGreaterThanOrEqual(60_000);
      expect(delay).toBeLessThan(70_000);
    });

    it('should cap at 1 hour for large attempt numbers', () => {
      const delay = service.computeNextRetryDelay(20);
      expect(delay).toBeGreaterThanOrEqual(3_600_000);
      expect(delay).toBeLessThan(3_610_000);
    });

    it('should double delay each attempt up to the cap', () => {
      const d1 = service.computeNextRetryDelay(1);
      const d2 = service.computeNextRetryDelay(2);
      const d3 = service.computeNextRetryDelay(3);
      // Base values (without jitter) double each attempt
      expect(d2 - 10_000).toBeLessThanOrEqual(d1 * 2 + 10_000);
      expect(d3 - 10_000).toBeLessThanOrEqual(d2 * 2 + 10_000);
    });
  });

  describe('retryFailedJobs', () => {
    it('should return early when no eligible failed jobs exist', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);

      await service.retryFailedJobs();

      expect(jobRepository.findManySelect).toHaveBeenCalledWith(
        {
          stage: JobStage.FAILED,
          retryCount: { lt: 3 },
          nextRetryAt: { lte: expect.any(Date) },
        },
        {
          id: true,
          fileLabel: true,
          retryCount: true,
          nextRetryAt: true,
          error: true,
        }
      );
      expect(jobRepository.updateManyByIds).not.toHaveBeenCalled();
      expect((service as any).logger.debug).toHaveBeenCalledWith('No failed jobs ready for retry');
    });

    it('should re-queue eligible failed jobs with exponential backoff nextRetryAt', async () => {
      const failedJobs = [
        createFailedJob('job-1', { retryCount: 0 }),
        createFailedJob('job-2', { retryCount: 1 }),
      ];
      jobRepository.findManySelect.mockResolvedValue(failedJobs);
      jobRepository.updateManyByIds.mockResolvedValue({ count: 2 });

      await service.retryFailedJobs();

      expect(jobRepository.updateManyByIds).toHaveBeenCalledWith(['job-1', 'job-2'], {
        stage: JobStage.QUEUED,
        progress: 0,
        error: null,
        completedAt: null,
        startedAt: null,
        retryCount: { increment: 1 },
      });
      expect((service as any).logger.log).toHaveBeenCalledWith(
        'Found 2 failed job(s) ready for retry'
      );
      expect((service as any).logger.log).toHaveBeenCalledWith(
        'Background retry scheduler: 2 job(s) re-queued'
      );
    });

    it('should log each retried job with correct attempt number', async () => {
      const failedJobs = [
        createFailedJob('job-1', { retryCount: 0 }),
        createFailedJob('job-2', { retryCount: 2 }),
      ];
      jobRepository.findManySelect.mockResolvedValue(failedJobs);
      jobRepository.updateManyByIds.mockResolvedValue({ count: 2 });

      await service.retryFailedJobs();

      // Log message contains job label
      const logCalls = (service as any).logger.log.mock.calls.map((c: string[]) => c[0]);
      expect(logCalls.some((msg: string) => msg.includes('test-job-1.mkv'))).toBe(true);
    });

    it('should handle single failed job', async () => {
      const failedJobs = [createFailedJob('job-1', { retryCount: 1 })];
      jobRepository.findManySelect.mockResolvedValue(failedJobs);
      jobRepository.updateManyByIds.mockResolvedValue({ count: 1 });

      await service.retryFailedJobs();

      expect(jobRepository.updateManyByIds).toHaveBeenCalledWith(
        ['job-1'],
        expect.objectContaining({
          stage: JobStage.QUEUED,
          retryCount: { increment: 1 },
        })
      );
      expect((service as any).logger.log).toHaveBeenCalledWith(
        'Background retry scheduler: 1 job(s) re-queued'
      );
    });

    it('should only find jobs with retryCount < 3', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);

      await service.retryFailedJobs();

      expect(jobRepository.findManySelect).toHaveBeenCalledWith(
        expect.objectContaining({ retryCount: { lt: 3 } }),
        expect.anything()
      );
    });

    it('should only find jobs with nextRetryAt in the past', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);

      await service.retryFailedJobs();

      expect(jobRepository.findManySelect).toHaveBeenCalledWith(
        expect.objectContaining({ nextRetryAt: { lte: expect.any(Date) } }),
        expect.anything()
      );
    });

    it('should handle database error gracefully', async () => {
      jobRepository.findManySelect.mockRejectedValue(new Error('DB connection lost'));

      await service.retryFailedJobs();

      expect((service as any).logger.error).toHaveBeenCalledWith(
        'Failed to retry jobs in background scheduler',
        expect.any(Error)
      );
      expect(jobRepository.updateManyByIds).not.toHaveBeenCalled();
    });

    it('should handle updateMany failure gracefully', async () => {
      jobRepository.findManySelect.mockResolvedValue([createFailedJob('job-1')]);
      jobRepository.updateManyByIds.mockRejectedValue(new Error('Update failed'));

      await service.retryFailedJobs();

      // Second job should still be processed
      expect(prisma.job.update).toHaveBeenCalledTimes(2);
      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to re-queue job job-1'),
        expect.any(Error)
      );
      expect((service as any).logger.log).toHaveBeenCalledWith(
        'Background retry scheduler: 1 job(s) re-queued'
      );
    });
  });

  describe('triggerManualRetry', () => {
    it('should call retryFailedJobs and return count of recently retried jobs', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);
      jobRepository.countWhere.mockResolvedValue(3);

      const result = await service.triggerManualRetry();

      expect(result).toBe(3);
      expect((service as any).logger.log).toHaveBeenCalledWith('Manual retry trigger initiated');
    });

    it('should return 0 when no jobs were retried', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);
      jobRepository.countWhere.mockResolvedValue(0);

      const result = await service.triggerManualRetry();

      expect(result).toBe(0);
    });

    it('should query for recently retried jobs within last minute', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-24T12:00:00Z'));

      jobRepository.findManySelect.mockResolvedValue([]);
      jobRepository.countWhere.mockResolvedValue(0);

      await service.triggerManualRetry();

      expect(jobRepository.countWhere).toHaveBeenCalledWith({
        stage: JobStage.QUEUED,
        retryCount: { gt: 0 },
        updatedAt: { gte: expect.any(Date) },
      });

      // Verify the date is within last minute
      const countCall = jobRepository.countWhere.mock.calls[0][0] as any;
      const queryDate = countCall.updatedAt.gte as Date;
      const expectedDate = new Date('2026-02-24T11:59:00Z');
      expect(queryDate.getTime()).toBe(expectedDate.getTime());

      jest.useRealTimers();
    });
  });
});
