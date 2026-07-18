import { Test, type TestingModule } from '@nestjs/testing';
import { JobEventType, JobStage } from '@prisma/client';
import { JobRepository } from '../../../../common/repositories/job.repository';
import { JobHistoryRepository } from '../../../../common/repositories/job-history.repository';
import { SettingsRepository } from '../../../../common/repositories/settings.repository';
import { NodeConfigService } from '../../../../core/services/node-config.service';
import { AutoHealingService } from '../../auto-healing.service';
import { CircuitBreakerService } from '../../circuit-breaker.service';
import { RetrySchedulerService } from '../../retry-scheduler.service';

describe('AutoHealingService', () => {
  let service: AutoHealingService;
  let jobHistoryRepository: { createEntry: jest.Mock };
  let jobRepository: { findManySelect: jest.Mock; updateById: jest.Mock };
  let settingsRepository: { findFirst: jest.Mock };
  let nodeConfig: { getNodeId: jest.Mock; isMainNode: jest.Mock };

  beforeEach(async () => {
    jobHistoryRepository = {
      createEntry: jest.fn(),
    };
    jobRepository = {
      findManySelect: jest.fn(),
      updateById: jest.fn(),
    };
    settingsRepository = {
      findFirst: jest.fn(),
    };
    nodeConfig = {
      getNodeId: jest.fn().mockReturnValue(null),
      isMainNode: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoHealingService,
        { provide: JobHistoryRepository, useValue: jobHistoryRepository },
        { provide: JobRepository, useValue: jobRepository },
        { provide: SettingsRepository, useValue: settingsRepository },
        { provide: NodeConfigService, useValue: nodeConfig },
        {
          provide: CircuitBreakerService,
          useValue: {
            checkAndBreak: jest.fn().mockResolvedValue(false),
            isCircuitBroken: jest.fn().mockResolvedValue(false),
            recordSuccess: jest.fn(),
            recordFailure: jest.fn(),
          },
        },
        {
          provide: RetrySchedulerService,
          useValue: {
            scheduleRetry: jest.fn().mockResolvedValue(undefined),
            computeNextRetryDelay: jest.fn().mockReturnValue(30000),
          },
        },
      ],
    }).compile();

    // Get service WITHOUT calling onModuleInit
    service = module.get<AutoHealingService>(AutoHealingService);

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
    nextRetryAt: null,
    progress: 0,
    ...overrides,
  });

  describe('healFailedJobs', () => {
    it('should return 0 when no eligible failed jobs', async () => {
      settingsRepository.findFirst.mockResolvedValue({
        maxAutoHealRetries: 15,
      });
      jobRepository.findManySelect.mockResolvedValue([]);

      const result = await service.healFailedJobs();

      expect(result).toBe(0);
      expect((service as any).logger.log).toHaveBeenCalledWith(
        'No failed jobs eligible for auto-healing'
      );
    });

    it('should query only non-circuit-broken retriable jobs under the retry limit', async () => {
      settingsRepository.findFirst.mockResolvedValue({
        maxAutoHealRetries: 15,
      });
      jobRepository.findManySelect.mockResolvedValue([]);

      await service.healFailedJobs();

      expect(jobRepository.findManySelect).toHaveBeenCalledWith(
        {
          stage: JobStage.FAILED,
          circuitBroken: false,
          retryCount: { lt: 15 },
          AND: [
            { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: expect.any(Date) } }] },
            { OR: [{ error: null }, { NOT: { error: { startsWith: 'Non-retriable' } } }] },
          ],
        },
        {
          id: true,
          fileLabel: true,
          retryCount: true,
          nextRetryAt: true,
          progress: true,
        }
      );
    });

    it('should heal failed jobs by resetting to QUEUED', async () => {
      settingsRepository.findFirst.mockResolvedValue({
        maxAutoHealRetries: 15,
      });
      jobRepository.findManySelect.mockResolvedValue([
        createFailedJob('job-1', { retryCount: 2, progress: 30 }),
        createFailedJob('job-2', { retryCount: 0, progress: 0 }),
      ]);
      jobRepository.updateById.mockResolvedValue({});
      jobHistoryRepository.createEntry.mockResolvedValue({});

      const result = await service.healFailedJobs();

      expect(result).toBe(2);
      expect(jobRepository.updateById).toHaveBeenCalledTimes(2);

      // Verify first job reset - full update payload
      expect(jobRepository.updateById).toHaveBeenCalledWith('job-1', {
        stage: JobStage.QUEUED,
        progress: 0,
        error: null,
        completedAt: null,
        startedAt: null,
        retryCount: 3, // Incremented from 2
        nextRetryAt: expect.any(Date),
        autoHealedAt: expect.any(Date),
        autoHealedProgress: 30,
        resumeTimestamp: null,
        tempFilePath: null,
      });
    });

    it('should always restart from 0% and clear resume state (input-seek resume removed)', async () => {
      settingsRepository.findFirst.mockResolvedValue({
        maxAutoHealRetries: 15,
      });
      jobRepository.findManySelect.mockResolvedValue([
        createFailedJob('job-1', { retryCount: 1, progress: 65 }),
      ]);
      jobRepository.updateById.mockResolvedValue({});
      jobHistoryRepository.createEntry.mockResolvedValue({});

      const result = await service.healFailedJobs();

      expect(result).toBe(1);
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.QUEUED,
          progress: 0, // Never resumes mid-file
          retryCount: 2,
          nextRetryAt: expect.any(Date),
          resumeTimestamp: null,
          tempFilePath: null,
          autoHealedProgress: 65, // Original progress recorded for history
        })
      );
    });

    it('should create audit trail history entry', async () => {
      settingsRepository.findFirst.mockResolvedValue({
        maxAutoHealRetries: 15,
      });
      jobRepository.findManySelect.mockResolvedValue([
        createFailedJob('job-1', { retryCount: 0, progress: 20 }),
      ]);
      jobRepository.updateById.mockResolvedValue({});
      jobHistoryRepository.createEntry.mockResolvedValue({});

      await service.healFailedJobs();

      expect(jobHistoryRepository.createEntry).toHaveBeenCalledWith({
        jobId: 'job-1',
        eventType: JobEventType.AUTO_HEALED,
        stage: JobStage.FAILED,
        progress: 20,
        wasAutoHealed: true,
        tempFileExists: false,
        retryNumber: 1,
        triggeredBy: 'BACKEND_RESTART',
        systemMessage: 'Auto-healed: restarting encode from 0% (was at 20.0%)',
      });
    });

    it('should continue processing if one job fails to heal', async () => {
      settingsRepository.findFirst.mockResolvedValue({
        maxAutoHealRetries: 15,
      });
      jobRepository.findManySelect.mockResolvedValue([
        createFailedJob('job-1'),
        createFailedJob('job-2'),
        createFailedJob('job-3'),
      ]);
      jobHistoryRepository.createEntry.mockResolvedValue({});

      jobRepository.updateById
        .mockResolvedValueOnce({}) // job-1 succeeds
        .mockRejectedValueOnce(new Error('DB error')) // job-2 fails
        .mockResolvedValueOnce({}); // job-3 succeeds

      const result = await service.healFailedJobs();

      expect(result).toBe(2); // 2 out of 3 healed
      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to heal job job-2'),
        expect.any(Error)
      );
    });

    it('should use default max retries (15) when settings not found', async () => {
      settingsRepository.findFirst.mockResolvedValue(null);
      jobRepository.findManySelect.mockResolvedValue([]);

      await service.healFailedJobs();

      expect((service as any).logger.log).toHaveBeenCalledWith('Auto-heal max retry limit: 15');
    });

    it('should handle database error gracefully', async () => {
      settingsRepository.findFirst.mockResolvedValue({
        maxAutoHealRetries: 15,
      });
      jobRepository.findManySelect.mockRejectedValue(new Error('DB connection lost'));

      const result = await service.healFailedJobs();

      expect(result).toBe(0);
      expect((service as any).logger.error).toHaveBeenCalledWith(
        'Failed to heal failed jobs',
        expect.any(Error)
      );
    });
  });

  describe('onModuleInit', () => {
    it('should call healFailedJobs on startup', async () => {
      const healSpy = jest.spyOn(service, 'healFailedJobs').mockResolvedValue(5);

      await service.onModuleInit();

      expect(healSpy).toHaveBeenCalledTimes(1);
    });

    it('should skip healing on LINKED node', async () => {
      nodeConfig.isMainNode.mockReturnValue(false);
      const healSpy = jest.spyOn(service, 'healFailedJobs').mockResolvedValue(0);

      await service.onModuleInit();

      expect(healSpy).not.toHaveBeenCalled();
    });
  });

  describe('healFailedJobsCron', () => {
    it('should run healFailedJobs and release the overlap lock', async () => {
      const healSpy = jest.spyOn(service, 'healFailedJobs').mockResolvedValue(1);

      await service.healFailedJobsCron();

      expect(healSpy).toHaveBeenCalledTimes(1);
      expect((service as any).cronRunning).toBe(false);
    });

    it('should release the lock even when healFailedJobs throws', async () => {
      jest.spyOn(service, 'healFailedJobs').mockRejectedValue(new Error('boom'));

      await expect(service.healFailedJobsCron()).rejects.toThrow('boom');
      expect((service as any).cronRunning).toBe(false);
    });

    it('should skip on LINKED node', async () => {
      nodeConfig.isMainNode.mockReturnValue(false);
      const healSpy = jest.spyOn(service, 'healFailedJobs').mockResolvedValue(0);

      await service.healFailedJobsCron();

      expect(healSpy).not.toHaveBeenCalled();
    });

    it('should skip when a previous run still holds a fresh lock', async () => {
      const healSpy = jest.spyOn(service, 'healFailedJobs').mockResolvedValue(0);
      (service as any).cronRunning = true;
      (service as any).cronLockExpiry = Date.now();

      await service.healFailedJobsCron();

      expect(healSpy).not.toHaveBeenCalled();
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        'Auto-heal cron already running, skipping this tick'
      );
    });

    it('should proceed when the held lock is stale (older than 2 hours)', async () => {
      const healSpy = jest.spyOn(service, 'healFailedJobs').mockResolvedValue(0);
      (service as any).cronRunning = true;
      (service as any).cronLockExpiry = Date.now() - (2 * 60 * 60 * 1000 + 1000);

      await service.healFailedJobsCron();

      expect(healSpy).toHaveBeenCalledTimes(1);
      expect((service as any).cronRunning).toBe(false);
    });
  });

  describe('settings cache', () => {
    it('should cache maxRetries for 1 minute', async () => {
      settingsRepository.findFirst.mockResolvedValue({
        maxAutoHealRetries: 10,
      });
      jobRepository.findManySelect.mockResolvedValue([]);

      await service.healFailedJobs();
      await service.healFailedJobs();

      // Settings queried only once due to cache
      expect(settingsRepository.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should refresh cache after TTL expires', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-21T12:00:00Z'));

      settingsRepository.findFirst.mockResolvedValue({
        maxAutoHealRetries: 10,
      });
      jobRepository.findManySelect.mockResolvedValue([]);

      await service.healFailedJobs();

      // Advance past cache TTL (60 seconds)
      jest.advanceTimersByTime(61000);

      settingsRepository.findFirst.mockResolvedValue({
        maxAutoHealRetries: 20,
      });

      await service.healFailedJobs();

      expect(settingsRepository.findFirst).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });
});
