import { Test, type TestingModule } from '@nestjs/testing';
import { type Job, JobStage } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { JobCleanupService } from '../../job-cleanup.service';

describe('JobCleanupService', () => {
  let service: JobCleanupService;
  let prisma: PrismaService;

  const now = new Date('2025-10-05T12:00:00Z');
  const fiveMinutesAgo = new Date('2025-10-05T11:55:00Z');
  const tenMinutesAgo = new Date('2025-10-05T11:50:00Z');
  const twoHoursAgo = new Date('2025-10-05T10:00:00Z');
  const threeHoursAgo = new Date('2025-10-05T09:00:00Z');

  const createMockJob = (
    id: string,
    stage: JobStage,
    updatedAt: Date,
    options: {
      startedAt?: Date | null;
      progress?: number;
    } = {}
  ) => ({
    id,
    filePath: `/media/test-${id}.mkv`,
    fileLabel: `Test File ${id}.mkv`,
    sourceCodec: 'H.264',
    targetCodec: 'HEVC',
    stage,
    progress: options.progress ?? 0,
    etaSeconds: null,
    beforeSizeBytes: BigInt(1000000),
    afterSizeBytes: null,
    savedBytes: null,
    savedPercent: null,
    startedAt: options.startedAt ?? null,
    completedAt: null,
    error: null,
    nodeId: 'node-1',
    libraryId: 'lib-1',
    policyId: 'policy-1',
    createdAt: new Date('2025-10-05T11:00:00Z'),
    updatedAt,
  });

  beforeEach(async () => {
    // Mock Date.now() to return consistent time
    jest.useFakeTimers();
    jest.setSystemTime(now);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobCleanupService,
        {
          provide: PrismaService,
          useValue: {
            job: {
              findMany: jest.fn(),
              updateMany: jest.fn(),
              update: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<JobCleanupService>(JobCleanupService);
    prisma = module.get<PrismaService>(PrismaService);

    // Suppress logger output during tests
    // Access private logger via bracket notation
    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should call cleanupStuckJobs on initialization', async () => {
      const cleanupSpy = jest.spyOn(service, 'cleanupStuckJobs').mockResolvedValue(0);

      await service.onModuleInit();

      expect(cleanupSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('cleanupStuckJobs', () => {
    it('should reset stuck ENCODING jobs to QUEUED', async () => {
      const stuckJobs = [
        createMockJob('job-1', JobStage.ENCODING, tenMinutesAgo, {
          startedAt: tenMinutesAgo,
          progress: 25,
        }),
        createMockJob('job-2', JobStage.ENCODING, tenMinutesAgo, {
          startedAt: tenMinutesAgo,
          progress: 50,
        }),
      ];

      jest.spyOn(prisma.job, 'findMany').mockResolvedValue(stuckJobs as any);
      jest.spyOn(prisma.job, 'updateMany').mockResolvedValue({ count: 2 } as any);

      const result = await service.cleanupStuckJobs();

      expect(result).toBe(2);
      expect(prisma.job.findMany).toHaveBeenCalledWith({
        where: {
          stage: JobStage.ENCODING,
          updatedAt: expect.objectContaining({
            lt: expect.any(Date),
          }),
        },
        select: {
          id: true,
          fileLabel: true,
          nodeId: true,
          updatedAt: true,
          progress: true,
          retryCount: true,
        },
      });
      expect(prisma.job.update).toHaveBeenCalledTimes(2);
    });

    it('should not reset recent ENCODING jobs', async () => {
      const _recentJobs = [
        createMockJob('job-1', JobStage.ENCODING, fiveMinutesAgo, {
          startedAt: fiveMinutesAgo,
          progress: 30,
        }),
      ];

      // Mock findMany to return empty array (recent jobs are filtered by DB query)
      jest.spyOn(prisma.job, 'findMany').mockResolvedValue([]);

      const result = await service.cleanupStuckJobs();

      expect(result).toBe(0);
      expect(prisma.job.updateMany).not.toHaveBeenCalled();
    });

    it('should return 0 when no stuck jobs found', async () => {
      jest.spyOn(prisma.job, 'findMany').mockResolvedValue([]);

      const result = await service.cleanupStuckJobs();

      expect(result).toBe(0);
      expect(prisma.job.updateMany).not.toHaveBeenCalled();
      expect((service as any).logger.log).toHaveBeenCalledWith(
        'No stuck jobs found during cleanup'
      );
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('Database error');
      jest.spyOn(prisma.job, 'findMany').mockRejectedValue(error);

      await expect(service.cleanupStuckJobs()).rejects.toThrow('Database error');
      expect((service as any).logger.error).toHaveBeenCalledWith(
        'Failed to cleanup stuck jobs',
        error
      );
    });

    it('should only affect ENCODING jobs, not other stages', async () => {
      // This test ensures the query filters correctly
      jest.spyOn(prisma.job, 'findMany').mockResolvedValue([]);

      await service.cleanupStuckJobs();

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            stage: JobStage.ENCODING,
          }),
        })
      );
    });
  });

  describe('detectTimedOutJobs', () => {
    it('should mark timed-out ENCODING jobs as FAILED', async () => {
      const timedOutJobs = [
        createMockJob('job-1', JobStage.ENCODING, threeHoursAgo, {
          startedAt: threeHoursAgo,
          progress: 45,
        }),
      ];

      jest.spyOn(prisma.job, 'findMany').mockResolvedValue(timedOutJobs as any);
      jest.spyOn(prisma.job, 'update').mockResolvedValue({
        ...timedOutJobs[0],
        stage: JobStage.FAILED,
        completedAt: now,
        error:
          'Encoding timeout - exceeded maximum duration of 2 hours (was encoding for 3 hours as any)',
      } as any);

      const result = await service.detectTimedOutJobs();

      expect(result).toBe(1);
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          stage: JobStage.FAILED,
          completedAt: expect.any(Date),
          error: expect.stringContaining('Encoding timeout'),
        },
      });
    });

    it('should not mark jobs that are still within timeout threshold', async () => {
      // Mock findMany to return empty (jobs within 2 hours are filtered by query)
      jest.spyOn(prisma.job, 'findMany').mockResolvedValue([]);

      const result = await service.detectTimedOutJobs();

      expect(result).toBe(0);
      expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('should return 0 when no timed-out jobs found', async () => {
      jest.spyOn(prisma.job, 'findMany').mockResolvedValue([]);

      const result = await service.detectTimedOutJobs();

      expect(result).toBe(0);
      expect(prisma.job.update).not.toHaveBeenCalled();
      expect((service as any).logger.debug).toHaveBeenCalledWith('No timed-out jobs found');
    });

    it('should handle multiple timed-out jobs', async () => {
      const timedOutJobs = [
        createMockJob('job-1', JobStage.ENCODING, threeHoursAgo, { startedAt: threeHoursAgo }),
        createMockJob('job-2', JobStage.ENCODING, threeHoursAgo, { startedAt: threeHoursAgo }),
        createMockJob('job-3', JobStage.ENCODING, twoHoursAgo, { startedAt: twoHoursAgo }),
      ];

      jest.spyOn(prisma.job, 'findMany').mockResolvedValue(timedOutJobs as any);
      jest.spyOn(prisma.job, 'update').mockResolvedValue({
        ...timedOutJobs[0],
        stage: JobStage.FAILED,
        completedAt: now,
        error: 'Encoding timeout',
      } as Job as any);

      const result = await service.detectTimedOutJobs();

      expect(result).toBe(3);
      expect(prisma.job.update).toHaveBeenCalledTimes(3);
    });

    it('should continue processing if one job update fails', async () => {
      const timedOutJobs = [
        createMockJob('job-1', JobStage.ENCODING, threeHoursAgo, { startedAt: threeHoursAgo }),
        createMockJob('job-2', JobStage.ENCODING, threeHoursAgo, { startedAt: threeHoursAgo }),
      ];

      jest.spyOn(prisma.job, 'findMany').mockResolvedValue(timedOutJobs as any);
      jest
        .spyOn(prisma.job, 'update')
        .mockRejectedValueOnce(new Error('Update failed'))
        .mockResolvedValueOnce({
          ...timedOutJobs[1],
          stage: JobStage.FAILED,
          completedAt: now,
          error: 'Encoding timeout',
        } as any);

      const result = await service.detectTimedOutJobs();

      expect(result).toBe(1); // Only one succeeded
      expect(prisma.job.update).toHaveBeenCalledTimes(2);
      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to mark job'),
        expect.any(Error)
      );
    });

    it('should handle findMany errors gracefully', async () => {
      const error = new Error('Database error');
      jest.spyOn(prisma.job, 'findMany').mockRejectedValue(error);

      await expect(service.detectTimedOutJobs()).rejects.toThrow('Database error');
      expect((service as any).logger.error).toHaveBeenCalledWith(
        'Failed to detect timed-out jobs',
        error
      );
    });
  });

  describe('handleTimedOutJobsCron', () => {
    it('should call detectTimedOutJobs when cron runs', async () => {
      const detectSpy = jest.spyOn(service, 'detectTimedOutJobs').mockResolvedValue(0);

      await service.handleTimedOutJobsCron();

      expect(detectSpy).toHaveBeenCalledTimes(1);
      expect((service as any).logger.debug).toHaveBeenCalledWith('Running scheduled timeout check');
    });

    it('should handle errors from detectTimedOutJobs', async () => {
      const error = new Error('Timeout detection error');
      jest.spyOn(service, 'detectTimedOutJobs').mockRejectedValue(error);

      await expect(service.handleTimedOutJobsCron()).rejects.toThrow('Timeout detection error');
    });
  });

  describe('Configuration', () => {
    it('should use default configuration values', () => {
      expect((service as any).STUCK_THRESHOLD_MINUTES).toBe(5);
      expect((service as any).TIMEOUT_HOURS).toBe(2);
    });

    it('should respect environment variable overrides', async () => {
      const originalStuck = process.env.JOB_STUCK_THRESHOLD_MINUTES;
      const originalTimeout = process.env.JOB_ENCODING_TIMEOUT_HOURS;

      process.env.JOB_STUCK_THRESHOLD_MINUTES = '10';
      process.env.JOB_ENCODING_TIMEOUT_HOURS = '4';

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          JobCleanupService,
          {
            provide: PrismaService,
            useValue: {
              job: {
                findMany: jest.fn(),
                updateMany: jest.fn(),
                update: jest.fn(),
              },
            },
          },
        ],
      }).compile();

      const customService = module.get<JobCleanupService>(JobCleanupService);

      expect((customService as any).STUCK_THRESHOLD_MINUTES).toBe(10);
      expect((customService as any).TIMEOUT_HOURS).toBe(4);

      // Restore original values
      if (originalStuck) {
        process.env.JOB_STUCK_THRESHOLD_MINUTES = originalStuck;
      } else {
        process.env.JOB_STUCK_THRESHOLD_MINUTES = undefined;
      }
      if (originalTimeout) {
        process.env.JOB_ENCODING_TIMEOUT_HOURS = originalTimeout;
      } else {
        process.env.JOB_ENCODING_TIMEOUT_HOURS = undefined;
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle jobs with null startedAt correctly', async () => {
      const stuckJobs = [
        createMockJob('job-1', JobStage.ENCODING, tenMinutesAgo, {
          startedAt: null,
          progress: 0,
        }),
      ];

      jest.spyOn(prisma.job, 'findMany').mockResolvedValue(stuckJobs as any);
      jest.spyOn(prisma.job, 'update').mockResolvedValue({} as any);

      const result = await service.cleanupStuckJobs();

      expect(result).toBe(1);
      expect(prisma.job.update).toHaveBeenCalled();
    });

    it('should calculate correct time differences for logging', async () => {
      const stuckJobs = [
        createMockJob('job-1', JobStage.ENCODING, tenMinutesAgo, {
          startedAt: tenMinutesAgo,
        }),
      ];

      jest.spyOn(prisma.job, 'findMany').mockResolvedValue(stuckJobs as any);
      jest.spyOn(prisma.job, 'update').mockResolvedValue({} as any);

      await service.cleanupStuckJobs();

      expect((service as any).logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('stuck for 10 minutes')
      );
    });
  });
});
