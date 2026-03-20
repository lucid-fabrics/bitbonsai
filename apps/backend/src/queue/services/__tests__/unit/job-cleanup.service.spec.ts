import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../../../common/repositories/job.repository';
import { JobCleanupService } from '../../job-cleanup.service';

describe('JobCleanupService', () => {
  let service: JobCleanupService;
  let jobRepository: { findManySelect: jest.Mock; updateById: jest.Mock };

  const now = new Date('2025-10-05T12:00:00Z');
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

    jobRepository = {
      findManySelect: jest.fn(),
      updateById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [JobCleanupService, { provide: JobRepository, useValue: jobRepository }],
    }).compile();

    service = module.get<JobCleanupService>(JobCleanupService);

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

      jobRepository.findManySelect.mockResolvedValue(stuckJobs);
      jobRepository.updateById.mockResolvedValue({});

      const result = await service.cleanupStuckJobs();

      expect(result).toBe(2);
      expect(jobRepository.findManySelect).toHaveBeenCalledWith(
        {
          stage: JobStage.ENCODING,
          updatedAt: expect.objectContaining({ lt: expect.any(Date) }),
        },
        {
          id: true,
          fileLabel: true,
          nodeId: true,
          updatedAt: true,
          progress: true,
          retryCount: true,
        }
      );
      expect(jobRepository.updateById).toHaveBeenCalledTimes(2);
    });

    it('should not reset recent ENCODING jobs', async () => {
      // Mock findManySelect to return empty array (recent jobs are filtered by DB query)
      jobRepository.findManySelect.mockResolvedValue([]);

      const result = await service.cleanupStuckJobs();

      expect(result).toBe(0);
      expect(jobRepository.updateById).not.toHaveBeenCalled();
    });

    it('should return 0 when no stuck jobs found', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);

      const result = await service.cleanupStuckJobs();

      expect(result).toBe(0);
      expect(jobRepository.updateById).not.toHaveBeenCalled();
      expect((service as any).logger.log).toHaveBeenCalledWith(
        'No stuck jobs found during cleanup'
      );
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('Database error');
      jobRepository.findManySelect.mockRejectedValue(error);

      await expect(service.cleanupStuckJobs()).rejects.toThrow('Database error');
      expect((service as any).logger.error).toHaveBeenCalledWith(
        'Failed to cleanup stuck jobs',
        error
      );
    });

    it('should only affect ENCODING jobs, not other stages', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);

      await service.cleanupStuckJobs();

      expect(jobRepository.findManySelect).toHaveBeenCalledWith(
        expect.objectContaining({ stage: JobStage.ENCODING }),
        expect.anything()
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

      jobRepository.findManySelect.mockResolvedValue(timedOutJobs);
      jobRepository.updateById.mockResolvedValue({});

      const result = await service.detectTimedOutJobs();

      expect(result).toBe(1);
      expect(jobRepository.updateById).toHaveBeenCalledWith('job-1', {
        stage: JobStage.FAILED,
        completedAt: expect.any(Date),
        error: expect.stringContaining('Encoding timeout'),
      });
    });

    it('should not mark jobs that are still within timeout threshold', async () => {
      // Mock findManySelect to return empty (jobs within 2 hours are filtered by query)
      jobRepository.findManySelect.mockResolvedValue([]);

      const result = await service.detectTimedOutJobs();

      expect(result).toBe(0);
      expect(jobRepository.updateById).not.toHaveBeenCalled();
    });

    it('should return 0 when no timed-out jobs found', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);

      const result = await service.detectTimedOutJobs();

      expect(result).toBe(0);
      expect(jobRepository.updateById).not.toHaveBeenCalled();
      expect((service as any).logger.debug).toHaveBeenCalledWith('No timed-out jobs found');
    });

    it('should handle multiple timed-out jobs', async () => {
      const timedOutJobs = [
        createMockJob('job-1', JobStage.ENCODING, threeHoursAgo, { startedAt: threeHoursAgo }),
        createMockJob('job-2', JobStage.ENCODING, threeHoursAgo, { startedAt: threeHoursAgo }),
        createMockJob('job-3', JobStage.ENCODING, twoHoursAgo, { startedAt: twoHoursAgo }),
      ];

      jobRepository.findManySelect.mockResolvedValue(timedOutJobs);
      jobRepository.updateById.mockResolvedValue({});

      const result = await service.detectTimedOutJobs();

      expect(result).toBe(3);
      expect(jobRepository.updateById).toHaveBeenCalledTimes(3);
    });

    it('should continue processing if one job update fails', async () => {
      const timedOutJobs = [
        createMockJob('job-1', JobStage.ENCODING, threeHoursAgo, { startedAt: threeHoursAgo }),
        createMockJob('job-2', JobStage.ENCODING, threeHoursAgo, { startedAt: threeHoursAgo }),
      ];

      jobRepository.findManySelect.mockResolvedValue(timedOutJobs);
      jobRepository.updateById
        .mockRejectedValueOnce(new Error('Update failed'))
        .mockResolvedValueOnce({});

      const result = await service.detectTimedOutJobs();

      expect(result).toBe(1); // Only one succeeded
      expect(jobRepository.updateById).toHaveBeenCalledTimes(2);
      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to mark job'),
        expect.any(Error)
      );
    });

    it('should handle findMany errors gracefully', async () => {
      const error = new Error('Database error');
      jobRepository.findManySelect.mockRejectedValue(error);

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
            provide: JobRepository,
            useValue: { findManySelect: jest.fn(), updateById: jest.fn() },
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
        process.env.JOB_STUCK_THRESHOLD_MINUTES = '';
      }
      if (originalTimeout) {
        process.env.JOB_ENCODING_TIMEOUT_HOURS = originalTimeout;
      } else {
        process.env.JOB_ENCODING_TIMEOUT_HOURS = '';
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

      jobRepository.findManySelect.mockResolvedValue(stuckJobs);
      jobRepository.updateById.mockResolvedValue({});

      const result = await service.cleanupStuckJobs();

      expect(result).toBe(1);
      expect(jobRepository.updateById).toHaveBeenCalled();
    });

    it('should calculate correct time differences for logging', async () => {
      const stuckJobs = [
        createMockJob('job-1', JobStage.ENCODING, tenMinutesAgo, {
          startedAt: tenMinutesAgo,
        }),
      ];

      jobRepository.findManySelect.mockResolvedValue(stuckJobs);
      jobRepository.updateById.mockResolvedValue({});

      await service.cleanupStuckJobs();

      expect((service as any).logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('stuck for 10 minutes')
      );
    });
  });
});
