import { Test, type TestingModule } from '@nestjs/testing';
import { JobEventType, JobStage } from '@prisma/client';
import * as fs from 'fs';
import { JobRepository } from '../../../../common/repositories/job.repository';
import { SettingsRepository } from '../../../../common/repositories/settings.repository';
import { PrismaService } from '../../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../../testing/mock-providers';
import { AutoHealingService } from '../../auto-healing.service';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
}));

describe('AutoHealingService', () => {
  let service: AutoHealingService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let jobRepository: { findManySelect: jest.Mock; updateById: jest.Mock };
  let settingsRepository: { findFirst: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    jobRepository = {
      findManySelect: jest.fn(),
      updateById: jest.fn(),
    };
    settingsRepository = {
      findFirst: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoHealingService,
        { provide: PrismaService, useValue: prisma },
        { provide: JobRepository, useValue: jobRepository },
        { provide: SettingsRepository, useValue: settingsRepository },
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
    tempFilePath: null,
    resumeTimestamp: null,
    ...overrides,
  });

  describe('healFailedJobs', () => {
    it('should return 0 when no eligible failed jobs', async () => {
      settingsRepository.findFirst.mockResolvedValue({ maxAutoHealRetries: 15 });
      jobRepository.findManySelect.mockResolvedValue([]);

      const result = await service.healFailedJobs();

      expect(result).toBe(0);
      expect((service as any).logger.log).toHaveBeenCalledWith(
        'No failed jobs eligible for auto-healing'
      );
    });

    it('should heal failed jobs by resetting to QUEUED', async () => {
      settingsRepository.findFirst.mockResolvedValue({ maxAutoHealRetries: 15 });
      jobRepository.findManySelect.mockResolvedValue([
        createFailedJob('job-1', { retryCount: 2, progress: 30 }),
        createFailedJob('job-2', { retryCount: 0, progress: 0 }),
      ]);
      jobRepository.updateById.mockResolvedValue({});
      prisma.jobHistory.create.mockResolvedValue({});
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await service.healFailedJobs();

      expect(result).toBe(2);
      expect(jobRepository.updateById).toHaveBeenCalledTimes(2);

      // Verify first job reset
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.QUEUED,
          progress: 0, // Reset since no temp file
          error: null,
          completedAt: null,
          startedAt: null,
          retryCount: 3, // Incremented from 2
          autoHealedAt: expect.any(Date),
          autoHealedProgress: 30,
          resumeTimestamp: null,
          tempFilePath: null,
        })
      );
    });

    it('should preserve progress when temp file exists for resume', async () => {
      settingsRepository.findFirst.mockResolvedValue({ maxAutoHealRetries: 15 });
      jobRepository.findManySelect.mockResolvedValue([
        createFailedJob('job-1', {
          retryCount: 1,
          progress: 65,
          tempFilePath: '/tmp/encode-job-1.mkv',
          resumeTimestamp: '00:45:30',
        }),
      ]);
      jobRepository.updateById.mockResolvedValue({});
      prisma.jobHistory.create.mockResolvedValue({});
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = await service.healFailedJobs();

      expect(result).toBe(1);
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.QUEUED,
          progress: 65, // Preserved for resume
          resumeTimestamp: '00:45:30',
          tempFilePath: '/tmp/encode-job-1.mkv',
          autoHealedProgress: 65,
        })
      );
    });

    it('should clear resume state when temp file is missing', async () => {
      settingsRepository.findFirst.mockResolvedValue({ maxAutoHealRetries: 15 });
      jobRepository.findManySelect.mockResolvedValue([
        createFailedJob('job-1', {
          retryCount: 1,
          progress: 40,
          tempFilePath: '/tmp/deleted-file.mkv',
          resumeTimestamp: '00:20:00',
        }),
      ]);
      jobRepository.updateById.mockResolvedValue({});
      prisma.jobHistory.create.mockResolvedValue({});
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await service.healFailedJobs();

      expect(result).toBe(1);
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          progress: 0, // Reset since temp file gone
          resumeTimestamp: null,
          tempFilePath: null,
        })
      );
    });

    it('should create audit trail history entry', async () => {
      settingsRepository.findFirst.mockResolvedValue({ maxAutoHealRetries: 15 });
      jobRepository.findManySelect.mockResolvedValue([
        createFailedJob('job-1', { retryCount: 0, progress: 20 }),
      ]);
      jobRepository.updateById.mockResolvedValue({});
      prisma.jobHistory.create.mockResolvedValue({});
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await service.healFailedJobs();

      expect(prisma.jobHistory.create).toHaveBeenCalledWith({
        data: {
          jobId: 'job-1',
          eventType: JobEventType.AUTO_HEALED,
          stage: JobStage.FAILED,
          progress: 20,
          wasAutoHealed: true,
          tempFileExists: false,
          retryNumber: 1,
          triggeredBy: 'BACKEND_RESTART',
          systemMessage: expect.stringContaining('starting encoding from scratch'),
        },
      });
    });

    it('should continue processing if one job fails to heal', async () => {
      settingsRepository.findFirst.mockResolvedValue({ maxAutoHealRetries: 15 });
      jobRepository.findManySelect.mockResolvedValue([
        createFailedJob('job-1'),
        createFailedJob('job-2'),
        createFailedJob('job-3'),
      ]);
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      prisma.jobHistory.create.mockResolvedValue({});

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
      settingsRepository.findFirst.mockResolvedValue({ maxAutoHealRetries: 15 });
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
  });

  describe('settings cache', () => {
    it('should cache maxRetries for 1 minute', async () => {
      settingsRepository.findFirst.mockResolvedValue({ maxAutoHealRetries: 10 });
      jobRepository.findManySelect.mockResolvedValue([]);

      await service.healFailedJobs();
      await service.healFailedJobs();

      // Settings queried only once due to cache
      expect(settingsRepository.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should refresh cache after TTL expires', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-21T12:00:00Z'));

      settingsRepository.findFirst.mockResolvedValue({ maxAutoHealRetries: 10 });
      jobRepository.findManySelect.mockResolvedValue([]);

      await service.healFailedJobs();

      // Advance past cache TTL (60 seconds)
      jest.advanceTimersByTime(61000);

      settingsRepository.findFirst.mockResolvedValue({ maxAutoHealRetries: 20 });

      await service.healFailedJobs();

      expect(settingsRepository.findFirst).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });
});
