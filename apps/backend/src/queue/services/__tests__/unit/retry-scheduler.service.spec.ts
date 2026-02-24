import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { RetrySchedulerService } from '../../retry-scheduler.service';

describe('RetrySchedulerService', () => {
  let service: RetrySchedulerService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [RetrySchedulerService, { provide: PrismaService, useValue: prisma }],
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

  describe('retryFailedJobs', () => {
    it('should return early when no eligible failed jobs exist', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      await service.retryFailedJobs();

      expect(prisma.job.findMany).toHaveBeenCalledWith({
        where: {
          stage: JobStage.FAILED,
          retryCount: { lt: 3 },
          nextRetryAt: { lte: expect.any(Date) },
        },
        select: {
          id: true,
          fileLabel: true,
          retryCount: true,
          nextRetryAt: true,
          error: true,
        },
      });
      expect(prisma.job.updateMany).not.toHaveBeenCalled();
      expect((service as any).logger.debug).toHaveBeenCalledWith('No failed jobs ready for retry');
    });

    it('should re-queue eligible failed jobs', async () => {
      const failedJobs = [
        createFailedJob('job-1', { retryCount: 0 }),
        createFailedJob('job-2', { retryCount: 1 }),
      ];
      prisma.job.findMany.mockResolvedValue(failedJobs);
      prisma.job.updateMany.mockResolvedValue({ count: 2 });

      await service.retryFailedJobs();

      expect(prisma.job.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['job-1', 'job-2'] },
        },
        data: {
          stage: JobStage.QUEUED,
          progress: 0,
          error: null,
          completedAt: null,
          startedAt: null,
          retryCount: { increment: 1 },
        },
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
      prisma.job.findMany.mockResolvedValue(failedJobs);
      prisma.job.updateMany.mockResolvedValue({ count: 2 });

      await service.retryFailedJobs();

      expect((service as any).logger.log).toHaveBeenCalledWith(
        'Retrying job: test-job-1.mkv (attempt 2/4)'
      );
      expect((service as any).logger.log).toHaveBeenCalledWith(
        'Retrying job: test-job-2.mkv (attempt 4/4)'
      );
    });

    it('should handle single failed job', async () => {
      const failedJobs = [createFailedJob('job-1', { retryCount: 1 })];
      prisma.job.findMany.mockResolvedValue(failedJobs);
      prisma.job.updateMany.mockResolvedValue({ count: 1 });

      await service.retryFailedJobs();

      expect(prisma.job.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['job-1'] },
        },
        data: expect.objectContaining({
          stage: JobStage.QUEUED,
          retryCount: { increment: 1 },
        }),
      });
      expect((service as any).logger.log).toHaveBeenCalledWith(
        'Background retry scheduler: 1 job(s) re-queued'
      );
    });

    it('should only find jobs with retryCount < 3', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      await service.retryFailedJobs();

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            retryCount: { lt: 3 },
          }),
        })
      );
    });

    it('should only find jobs with nextRetryAt in the past', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      await service.retryFailedJobs();

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            nextRetryAt: { lte: expect.any(Date) },
          }),
        })
      );
    });

    it('should handle database error gracefully', async () => {
      prisma.job.findMany.mockRejectedValue(new Error('DB connection lost'));

      await service.retryFailedJobs();

      expect((service as any).logger.error).toHaveBeenCalledWith(
        'Failed to retry jobs in background scheduler',
        expect.any(Error)
      );
      expect(prisma.job.updateMany).not.toHaveBeenCalled();
    });

    it('should handle updateMany failure gracefully', async () => {
      prisma.job.findMany.mockResolvedValue([createFailedJob('job-1')]);
      prisma.job.updateMany.mockRejectedValue(new Error('Update failed'));

      await service.retryFailedJobs();

      expect((service as any).logger.error).toHaveBeenCalledWith(
        'Failed to retry jobs in background scheduler',
        expect.any(Error)
      );
    });
  });

  describe('triggerManualRetry', () => {
    it('should call retryFailedJobs and return count of recently retried jobs', async () => {
      prisma.job.findMany.mockResolvedValue([]);
      prisma.job.count.mockResolvedValue(3);

      const result = await service.triggerManualRetry();

      expect(result).toBe(3);
      expect((service as any).logger.log).toHaveBeenCalledWith('Manual retry trigger initiated');
    });

    it('should return 0 when no jobs were retried', async () => {
      prisma.job.findMany.mockResolvedValue([]);
      prisma.job.count.mockResolvedValue(0);

      const result = await service.triggerManualRetry();

      expect(result).toBe(0);
    });

    it('should query for recently retried jobs within last minute', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-24T12:00:00Z'));

      prisma.job.findMany.mockResolvedValue([]);
      prisma.job.count.mockResolvedValue(0);

      await service.triggerManualRetry();

      expect(prisma.job.count).toHaveBeenCalledWith({
        where: {
          stage: JobStage.QUEUED,
          retryCount: { gt: 0 },
          updatedAt: { gte: expect.any(Date) },
        },
      });

      // Verify the date is within last minute
      const countCall = prisma.job.count.mock.calls[0][0] as any;
      const queryDate = countCall.where.updatedAt.gte as Date;
      const expectedDate = new Date('2026-02-24T11:59:00Z');
      expect(queryDate.getTime()).toBe(expectedDate.getTime());

      jest.useRealTimers();
    });
  });
});
