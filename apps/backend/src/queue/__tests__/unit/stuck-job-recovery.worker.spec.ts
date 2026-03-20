import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../../common/repositories/job.repository';
import { FfmpegService } from '../../../encoding/ffmpeg.service';
import { FileFailureTrackingService } from '../../services/file-failure-tracking.service';
import { StuckJobRecoveryWorker } from '../../stuck-job-recovery.worker';

const mockJobRepository = {
  findManySelect: jest.fn(),
  updateById: jest.fn(),
};

const mockFfmpegService = {
  hasActiveProcess: jest.fn(),
  isProcessTrulyStuck: jest.fn(),
  getLastOutputTime: jest.fn(),
  killProcess: jest.fn(),
};

const mockFileFailureTracking = {
  recordFailure: jest.fn(),
};

describe('StuckJobRecoveryWorker', () => {
  let worker: StuckJobRecoveryWorker;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StuckJobRecoveryWorker,
        { provide: JobRepository, useValue: mockJobRepository },
        { provide: FfmpegService, useValue: mockFfmpegService },
        { provide: FileFailureTrackingService, useValue: mockFileFailureTracking },
      ],
    }).compile();

    worker = module.get<StuckJobRecoveryWorker>(StuckJobRecoveryWorker);

    // Prevent the actual worker loop from running during tests
    (worker as unknown as { isRunning: boolean }).isRunning = false;
  });

  it('should be defined', () => {
    expect(worker).toBeInstanceOf(StuckJobRecoveryWorker);
  });

  describe('onModuleInit', () => {
    it('should start the worker on module init', async () => {
      const startSpy = jest.spyOn(worker as unknown as { start: () => void }, 'start');

      await worker.onModuleInit();

      expect(startSpy).toHaveBeenCalled();

      // Stop to prevent loop
      (worker as unknown as { isRunning: boolean }).isRunning = false;
    });
  });

  describe('stop', () => {
    it('should set isRunning to false', async () => {
      (worker as unknown as { isRunning: boolean }).isRunning = true;

      await worker.stop();

      expect((worker as unknown as { isRunning: boolean }).isRunning).toBe(false);
    });

    it('should await loop promise if set', async () => {
      let resolveLoop!: () => void;
      const loopPromise = new Promise<void>((resolve) => {
        resolveLoop = resolve;
      });
      (worker as unknown as { loopPromise?: Promise<void> }).loopPromise = loopPromise;
      (worker as unknown as { isRunning: boolean }).isRunning = true;

      const stopPromise = worker.stop();
      resolveLoop();
      await stopPromise;

      expect((worker as unknown as { isRunning: boolean }).isRunning).toBe(false);
    });
  });

  describe('recoverStuckJobs - HEALTH_CHECK scenario', () => {
    it('should reset stuck HEALTH_CHECK jobs to DETECTED', async () => {
      const stuckJob = {
        id: 'job-1',
        fileLabel: 'movie.mkv',
        updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
      };

      // Return stuck health_check job on first call, empty for all others
      mockJobRepository.findManySelect
        .mockResolvedValueOnce([stuckJob]) // HEALTH_CHECK
        .mockResolvedValueOnce([]) // ENCODING
        .mockResolvedValueOnce([]) // VERIFYING
        .mockResolvedValueOnce([]); // TRANSFERRING
      mockJobRepository.updateById.mockResolvedValue({});

      await (worker as unknown as { recoverStuckJobs: () => Promise<void> }).recoverStuckJobs();

      expect(mockJobRepository.updateById).toHaveBeenCalledWith('job-1', {
        stage: JobStage.DETECTED,
        healthCheckRetries: { increment: 1 },
      });
    });

    it('should not update jobs when no HEALTH_CHECK jobs are stuck', async () => {
      mockJobRepository.findManySelect.mockResolvedValue([]);

      await (worker as unknown as { recoverStuckJobs: () => Promise<void> }).recoverStuckJobs();

      expect(mockJobRepository.updateById).not.toHaveBeenCalled();
    });
  });

  describe('recoverStuckJobs - ENCODING scenario', () => {
    it('should reset stuck ENCODING job to QUEUED when no active ffmpeg process', async () => {
      const stuckJob = {
        id: 'job-2',
        fileLabel: 'show.mkv',
        filePath: '/mnt/shows/show.mkv',
        libraryId: 'lib-1',
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
        lastProgressUpdate: null,
        progress: 30,
        stuckRecoveryCount: 0,
        contentFingerprint: null,
      };

      mockJobRepository.findManySelect
        .mockResolvedValueOnce([]) // HEALTH_CHECK
        .mockResolvedValueOnce([stuckJob]) // ENCODING
        .mockResolvedValueOnce([]) // VERIFYING
        .mockResolvedValueOnce([]); // TRANSFERRING

      mockFfmpegService.hasActiveProcess.mockReturnValue(false);
      mockJobRepository.updateById.mockResolvedValue({});

      await (worker as unknown as { recoverStuckJobs: () => Promise<void> }).recoverStuckJobs();

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-2',
        expect.objectContaining({
          stage: JobStage.QUEUED,
          stuckRecoveryCount: { increment: 1 },
        })
      );
    });

    it('should fail job permanently when stuckRecoveryCount reaches max', async () => {
      const stuckJob = {
        id: 'job-3',
        fileLabel: 'bad.mkv',
        filePath: '/mnt/bad.mkv',
        libraryId: 'lib-1',
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
        lastProgressUpdate: null,
        progress: 0,
        stuckRecoveryCount: 5, // MAX_STUCK_RECOVERY is 5
        contentFingerprint: null,
      };

      mockJobRepository.findManySelect
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckJob])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mockFfmpegService.hasActiveProcess.mockReturnValue(false);
      mockJobRepository.updateById.mockResolvedValue({});
      mockFileFailureTracking.recordFailure.mockResolvedValue(undefined);

      await (worker as unknown as { recoverStuckJobs: () => Promise<void> }).recoverStuckJobs();

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-3',
        expect.objectContaining({
          stage: JobStage.FAILED,
          failedAt: expect.any(Date),
        })
      );
      expect(mockFileFailureTracking.recordFailure).toHaveBeenCalledWith(
        '/mnt/bad.mkv',
        'lib-1',
        expect.any(String),
        undefined
      );
    });

    it('should kill frozen ffmpeg process before resetting to QUEUED', async () => {
      const stuckJob = {
        id: 'job-4',
        fileLabel: 'frozen.mkv',
        filePath: '/mnt/frozen.mkv',
        libraryId: 'lib-1',
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
        lastProgressUpdate: null,
        progress: 60,
        stuckRecoveryCount: 1,
        contentFingerprint: 'fp-abc',
      };

      mockJobRepository.findManySelect
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckJob])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mockFfmpegService.hasActiveProcess.mockReturnValue(true);
      mockFfmpegService.isProcessTrulyStuck.mockReturnValue(true);
      mockFfmpegService.killProcess.mockResolvedValue(true);
      mockJobRepository.updateById.mockResolvedValue({});

      await (worker as unknown as { recoverStuckJobs: () => Promise<void> }).recoverStuckJobs();

      expect(mockFfmpegService.killProcess).toHaveBeenCalledWith('job-4');
      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-4',
        expect.objectContaining({
          stage: JobStage.QUEUED,
        })
      );
    });

    it('should skip job if active ffmpeg process is not truly stuck', async () => {
      const stuckJob = {
        id: 'job-5',
        fileLabel: 'slow.mkv',
        filePath: '/mnt/slow.mkv',
        libraryId: 'lib-1',
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
        lastProgressUpdate: null,
        progress: 20,
        stuckRecoveryCount: 0,
        contentFingerprint: null,
      };

      mockJobRepository.findManySelect
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckJob])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mockFfmpegService.hasActiveProcess.mockReturnValue(true);
      mockFfmpegService.isProcessTrulyStuck.mockReturnValue(false);
      mockFfmpegService.getLastOutputTime.mockReturnValue(new Date());

      await (worker as unknown as { recoverStuckJobs: () => Promise<void> }).recoverStuckJobs();

      expect(mockJobRepository.updateById).not.toHaveBeenCalled();
    });

    it('should skip job if ffmpeg kill fails', async () => {
      const stuckJob = {
        id: 'job-6',
        fileLabel: 'unkillable.mkv',
        filePath: '/mnt/unkillable.mkv',
        libraryId: 'lib-1',
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
        lastProgressUpdate: null,
        progress: 10,
        stuckRecoveryCount: 0,
        contentFingerprint: null,
      };

      mockJobRepository.findManySelect
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckJob])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mockFfmpegService.hasActiveProcess.mockReturnValue(true);
      mockFfmpegService.isProcessTrulyStuck.mockReturnValue(true);
      mockFfmpegService.killProcess.mockResolvedValue(false);

      await (worker as unknown as { recoverStuckJobs: () => Promise<void> }).recoverStuckJobs();

      expect(mockJobRepository.updateById).not.toHaveBeenCalled();
    });
  });

  describe('recoverStuckJobs - VERIFYING scenario', () => {
    it('should reset stuck VERIFYING job to QUEUED', async () => {
      const stuckJob = {
        id: 'job-7',
        fileLabel: 'verify.mkv',
        updatedAt: new Date(Date.now() - 35 * 60 * 1000), // 35 minutes ago
      };

      mockJobRepository.findManySelect
        .mockResolvedValueOnce([]) // HEALTH_CHECK
        .mockResolvedValueOnce([]) // ENCODING
        .mockResolvedValueOnce([stuckJob]) // VERIFYING
        .mockResolvedValueOnce([]); // TRANSFERRING

      mockJobRepository.updateById.mockResolvedValue({});

      await (worker as unknown as { recoverStuckJobs: () => Promise<void> }).recoverStuckJobs();

      expect(mockJobRepository.updateById).toHaveBeenCalledWith('job-7', {
        stage: JobStage.QUEUED,
        progress: 0,
        startedAt: null,
        error: expect.stringContaining('Verification timed out'),
      });
    });
  });

  describe('recoverStuckJobs - TRANSFERRING scenario', () => {
    it('should reset stuck TRANSFERRING job to DETECTED for retry', async () => {
      const stuckJob = {
        id: 'job-8',
        fileLabel: 'transfer.mkv',
        transferStartedAt: new Date(Date.now() - 20 * 60 * 1000),
        transferLastProgressAt: null,
        transferProgress: 45,
        transferRetryCount: 0,
      };

      mockJobRepository.findManySelect
        .mockResolvedValueOnce([]) // HEALTH_CHECK
        .mockResolvedValueOnce([]) // ENCODING
        .mockResolvedValueOnce([]) // VERIFYING
        .mockResolvedValueOnce([stuckJob]); // TRANSFERRING

      mockJobRepository.updateById.mockResolvedValue({});

      await (worker as unknown as { recoverStuckJobs: () => Promise<void> }).recoverStuckJobs();

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-8',
        expect.objectContaining({
          stage: JobStage.DETECTED,
          transferRetryCount: 1,
          transferProgress: 0,
          transferStartedAt: null,
          transferLastProgressAt: null,
        })
      );
    });

    it('should fail TRANSFERRING job when max retries reached', async () => {
      const stuckJob = {
        id: 'job-9',
        fileLabel: 'fail-transfer.mkv',
        transferStartedAt: new Date(Date.now() - 20 * 60 * 1000),
        transferLastProgressAt: null,
        transferProgress: 80,
        transferRetryCount: 2, // next retry would be 3 = MAX_TRANSFER_RETRIES
      };

      mockJobRepository.findManySelect
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckJob]);

      mockJobRepository.updateById.mockResolvedValue({});

      await (worker as unknown as { recoverStuckJobs: () => Promise<void> }).recoverStuckJobs();

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-9',
        expect.objectContaining({
          stage: JobStage.FAILED,
          failedAt: expect.any(Date),
        })
      );
    });
  });

  describe('recoverStuckJobs - error handling', () => {
    it('should continue gracefully when fileFailureTracking.recordFailure throws', async () => {
      const stuckJob = {
        id: 'job-10',
        fileLabel: 'track-fail.mkv',
        filePath: '/mnt/track-fail.mkv',
        libraryId: 'lib-1',
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
        lastProgressUpdate: null,
        progress: 0,
        stuckRecoveryCount: 5,
        contentFingerprint: null,
      };

      mockJobRepository.findManySelect
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckJob])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mockFfmpegService.hasActiveProcess.mockReturnValue(false);
      mockJobRepository.updateById.mockResolvedValue({});
      mockFileFailureTracking.recordFailure.mockRejectedValue(new Error('Tracking error'));

      await expect(
        (worker as unknown as { recoverStuckJobs: () => Promise<void> }).recoverStuckJobs()
      ).resolves.not.toThrow();

      expect(mockJobRepository.updateById).toHaveBeenCalledWith(
        'job-10',
        expect.objectContaining({
          stage: JobStage.FAILED,
        })
      );
    });
  });
});
