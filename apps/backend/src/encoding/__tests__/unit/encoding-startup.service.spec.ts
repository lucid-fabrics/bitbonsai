import * as fs from 'node:fs';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../../common/repositories/job.repository';
import { LibrariesService } from '../../../libraries/libraries.service';
import { QueueService } from '../../../queue/queue.service';
import { EncodingStartupService } from '../../encoding-startup.service';

jest.mock('node:fs');

const mockFs = fs as jest.Mocked<typeof fs>;

const makeOrphanedJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  fileLabel: 'movie.mkv',
  stage: JobStage.ENCODING,
  progress: 50,
  updatedAt: new Date(),
  tempFilePath: '/tmp/movie.mkv.tmp',
  retryCount: 0,
  error: null,
  ...overrides,
});

describe('EncodingStartupService', () => {
  let service: EncodingStartupService;
  let jobRepository: jest.Mocked<JobRepository>;
  let queueService: jest.Mocked<QueueService>;
  let librariesService: jest.Mocked<LibrariesService>;

  beforeEach(async () => {
    jobRepository = {
      findManyWithInclude: jest.fn(),
      atomicUpdateMany: jest.fn(),
      findUniqueSelect: jest.fn(),
    } as unknown as jest.Mocked<JobRepository>;

    queueService = {
      update: jest.fn(),
    } as unknown as jest.Mocked<QueueService>;

    librariesService = {
      getAllLibraryPaths: jest.fn(),
    } as unknown as jest.Mocked<LibrariesService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncodingStartupService,
        { provide: JobRepository, useValue: jobRepository },
        { provide: QueueService, useValue: queueService },
        { provide: LibrariesService, useValue: librariesService },
      ],
    }).compile();

    service = module.get<EncodingStartupService>(EncodingStartupService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('waitForVolumeMounts', () => {
    it('returns early when no libraries configured', async () => {
      librariesService.getAllLibraryPaths.mockResolvedValue([]);
      await expect(service.waitForVolumeMounts()).resolves.toBeUndefined();
    });

    it('returns when a media path exists', async () => {
      librariesService.getAllLibraryPaths.mockResolvedValue(['/media/movies']);
      mockFs.existsSync.mockReturnValue(true);
      await expect(service.waitForVolumeMounts()).resolves.toBeUndefined();
    });

    it('warns and proceeds after max retries when paths do not exist', async () => {
      librariesService.getAllLibraryPaths.mockResolvedValue(['/media/movies']);
      mockFs.existsSync.mockReturnValue(false);
      // Stub setTimeout to resolve immediately
      jest.spyOn(global, 'setTimeout').mockImplementation((cb: () => void) => {
        cb();
        return 0 as unknown as NodeJS.Timeout;
      });
      await expect(service.waitForVolumeMounts()).resolves.toBeUndefined();
    });
  });

  describe('autoHealOrphanedJobs', () => {
    const nodeId = 'node-1';

    it('logs healthy when no orphaned jobs found', async () => {
      jobRepository.findManyWithInclude
        .mockResolvedValueOnce([]) // orphaned jobs
        .mockResolvedValueOnce([]); // manually paused jobs
      await expect(service.autoHealOrphanedJobs(nodeId)).resolves.toBeUndefined();
    });

    it('resets orphaned ENCODING job to QUEUED restarting from 0%', async () => {
      const job = makeOrphanedJob();
      jobRepository.findManyWithInclude
        .mockResolvedValueOnce([job]) // orphaned jobs
        .mockResolvedValueOnce([]); // manually paused
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 1 });
      queueService.update.mockResolvedValue(undefined as never);

      await service.autoHealOrphanedJobs(nodeId);

      expect(queueService.update).toHaveBeenCalledWith(
        job.id,
        expect.objectContaining({
          stage: JobStage.QUEUED,
          progress: 0,
          tempFilePath: null,
          resumeTimestamp: null,
          startedAt: null,
          retryCount: 1,
          error: expect.stringContaining('restarting from 0%'),
        })
      );
    });

    it('increments retryCount and clears resume state on every heal', async () => {
      const job = makeOrphanedJob({ retryCount: 2, progress: 87.5 });
      jobRepository.findManyWithInclude.mockResolvedValueOnce([job]).mockResolvedValueOnce([]);
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 1 });
      queueService.update.mockResolvedValue(undefined as never);

      await service.autoHealOrphanedJobs(nodeId);

      expect(queueService.update).toHaveBeenCalledWith(
        job.id,
        expect.objectContaining({
          progress: 0,
          retryCount: 3,
          tempFilePath: null,
          resumeTimestamp: null,
        })
      );
    });

    it('skips job already claimed by another node', async () => {
      const job = makeOrphanedJob();
      jobRepository.findManyWithInclude.mockResolvedValueOnce([job]).mockResolvedValueOnce([]);
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 0 });

      await service.autoHealOrphanedJobs(nodeId);

      expect(queueService.update).not.toHaveBeenCalled();
    });

    it('resets PAUSED job with schedule error message', async () => {
      const job = makeOrphanedJob({
        stage: JobStage.PAUSED,
        error: 'Outside scheduled encoding window',
      });
      jobRepository.findManyWithInclude.mockResolvedValueOnce([job]).mockResolvedValueOnce([]);
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 1 });
      queueService.update.mockResolvedValue(undefined as never);

      await service.autoHealOrphanedJobs(nodeId);

      expect(queueService.update).toHaveBeenCalledWith(
        job.id,
        expect.objectContaining({ stage: JobStage.QUEUED })
      );
    });

    it('handles errors during individual job reset gracefully', async () => {
      const job = makeOrphanedJob();
      jobRepository.findManyWithInclude.mockResolvedValueOnce([job]).mockResolvedValueOnce([]);
      jobRepository.atomicUpdateMany.mockResolvedValue({ count: 1 });
      queueService.update.mockRejectedValue(new Error('db error'));

      await expect(service.autoHealOrphanedJobs(nodeId)).resolves.toBeUndefined();
    });

    it('handles top-level repository errors gracefully', async () => {
      jobRepository.findManyWithInclude.mockRejectedValue(new Error('db down'));
      await expect(service.autoHealOrphanedJobs(nodeId)).resolves.toBeUndefined();
    });

    it('logs preserved manually paused jobs', async () => {
      const pausedJob = { id: 'job-manual', fileLabel: 'manual.mkv' };
      jobRepository.findManyWithInclude
        .mockResolvedValueOnce([]) // orphaned
        .mockResolvedValueOnce([pausedJob]); // manually paused
      await service.autoHealOrphanedJobs(nodeId);
      // No error thrown, manual paused jobs are just logged
    });
  });
});
