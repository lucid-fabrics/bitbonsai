import { Test, type TestingModule } from '@nestjs/testing';
import { FileHealthStatus, JobStage } from '@prisma/client';
import { FileRelocatorService } from '../../../core/services/file-relocator.service';
import { ContainerCompatibilityService } from '../../../encoding/container-compatibility.service';
import { FfmpegService } from '../../../encoding/ffmpeg.service';
import { FileHealthService } from '../../../encoding/file-health.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { HealthCheckWorker } from '../../health-check.worker';
import { FileFailureTrackingService } from '../../services/file-failure-tracking.service';

describe('HealthCheckWorker', () => {
  let worker: HealthCheckWorker;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let fileHealthService: Record<string, jest.Mock>;
  let containerCompatibilityService: Record<string, jest.Mock>;
  let ffmpegService: Record<string, jest.Mock>;
  let fileRelocatorService: Record<string, jest.Mock>;
  let fileFailureTrackingService: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = {
      job: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $executeRaw: jest.fn() as any,
    };

    fileHealthService = {
      analyzeFile: jest.fn(),
    };

    containerCompatibilityService = {
      checkCompatibility: jest.fn(),
    };

    ffmpegService = {
      normalizeCodec: jest.fn((codec: string) => codec.toLowerCase()),
    };

    fileRelocatorService = {
      relocateFile: jest.fn(),
    };

    fileFailureTrackingService = {
      recordFailure: jest.fn(),
      isBlacklisted: jest.fn(),
      clearBlacklist: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthCheckWorker,
        { provide: PrismaService, useValue: prisma },
        { provide: FileHealthService, useValue: fileHealthService },
        { provide: ContainerCompatibilityService, useValue: containerCompatibilityService },
        { provide: FfmpegService, useValue: ffmpegService },
        { provide: FileRelocatorService, useValue: fileRelocatorService },
        { provide: FileFailureTrackingService, useValue: fileFailureTrackingService },
      ],
    }).compile();

    worker = module.get<HealthCheckWorker>(HealthCheckWorker);

    // Prevent the worker loop from starting during tests
    jest.spyOn(worker as any, 'start').mockImplementation(() => {});

    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Stop the worker if running
    (worker as any).isRunning = false;
  });

  it('should be defined', () => {
    expect(worker).toBeDefined();
  });

  // ─── autoRequeueCorruptedJobs ─────────────────────────────────────

  describe('autoRequeueCorruptedJobs', () => {
    it('should reset CORRUPTED jobs to DETECTED for re-validation', async () => {
      const corruptedJobs = [
        {
          id: 'j1',
          fileLabel: 'file1.mkv',
          healthMessage: 'corrupt',
          healthCheckedAt: new Date(),
          corruptedRequeueCount: 0,
          filePath: '/path/file1.mkv',
          libraryId: 'lib1',
        },
        {
          id: 'j2',
          fileLabel: 'file2.mkv',
          healthMessage: 'corrupt',
          healthCheckedAt: new Date(),
          corruptedRequeueCount: 1,
          filePath: '/path/file2.mkv',
          libraryId: 'lib1',
        },
      ];

      // First findMany: eligible jobs, second findMany: exhausted jobs
      prisma.job.findMany.mockResolvedValueOnce(corruptedJobs).mockResolvedValueOnce([]);
      prisma.job.update.mockResolvedValue({});

      await worker.autoRequeueCorruptedJobs();

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            healthStatus: FileHealthStatus.CORRUPTED,
          }),
        })
      );

      // Now uses individual update calls per job with corruptedRequeueCount increment
      expect(prisma.job.update).toHaveBeenCalledTimes(2);
      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'j1' },
          data: expect.objectContaining({
            stage: JobStage.DETECTED,
            healthStatus: FileHealthStatus.UNKNOWN,
            corruptedRequeueCount: { increment: 1 },
          }),
        })
      );
    });

    it('should skip when no CORRUPTED jobs found', async () => {
      // First findMany: eligible jobs, second findMany: exhausted jobs
      prisma.job.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await worker.autoRequeueCorruptedJobs();

      expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('should prevent overlapping executions', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      // Simulate running state
      (worker as any).cronRunning = true;
      (worker as any).cronLockExpiry = Date.now();

      await worker.autoRequeueCorruptedJobs();

      // Should not call findMany because lock is held
      expect(prisma.job.findMany).not.toHaveBeenCalled();
    });

    it('should force reset stale lock (>2h old)', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      // Simulate stale lock (3 hours old)
      (worker as any).cronRunning = true;
      (worker as any).cronLockExpiry = Date.now() - 3 * 60 * 60 * 1000;

      await worker.autoRequeueCorruptedJobs();

      // Should proceed despite lock being held (stale)
      expect(prisma.job.findMany).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      prisma.job.findMany.mockRejectedValue(new Error('DB connection failed'));

      // Should not throw
      await expect(worker.autoRequeueCorruptedJobs()).resolves.not.toThrow();

      // Lock should be released
      expect((worker as any).cronRunning).toBe(false);
    });
  });

  // ─── timeoutStuckHealthChecks ─────────────────────────────────────

  describe('timeoutStuckHealthChecks', () => {
    it('should fail jobs that exceeded max retries', async () => {
      const stuckJob = {
        id: 'stuck-1',
        fileLabel: 'stuck.mkv',
        healthCheckStartedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 min ago
        retryCount: 3, // MAX_RETRY_ATTEMPTS
      };

      prisma.job.findMany.mockResolvedValue([stuckJob]);
      prisma.job.update.mockResolvedValue({});

      await (worker as any).timeoutStuckHealthChecks();

      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'stuck-1' },
          data: expect.objectContaining({
            stage: JobStage.FAILED,
            healthStatus: FileHealthStatus.CORRUPTED,
          }),
        })
      );
    });

    it('should retry jobs that have retries remaining', async () => {
      const stuckJob = {
        id: 'stuck-1',
        fileLabel: 'stuck.mkv',
        healthCheckStartedAt: new Date(Date.now() - 15 * 60 * 1000),
        retryCount: 1,
      };

      prisma.job.findMany.mockResolvedValue([stuckJob]);
      prisma.job.update.mockResolvedValue({});

      await (worker as any).timeoutStuckHealthChecks();

      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'stuck-1' },
          data: expect.objectContaining({
            stage: JobStage.DETECTED,
            retryCount: 2,
            healthCheckStartedAt: null,
          }),
        })
      );
    });

    it('should remove stuck jobs from currentlyChecking set', async () => {
      (worker as any).currentlyChecking.add('stuck-1');

      const stuckJob = {
        id: 'stuck-1',
        fileLabel: 'stuck.mkv',
        healthCheckStartedAt: new Date(Date.now() - 15 * 60 * 1000),
        retryCount: 3,
      };

      prisma.job.findMany.mockResolvedValue([stuckJob]);
      prisma.job.update.mockResolvedValue({});

      await (worker as any).timeoutStuckHealthChecks();

      expect((worker as any).currentlyChecking.has('stuck-1')).toBe(false);
    });

    it('should handle no stuck jobs gracefully', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      await (worker as any).timeoutStuckHealthChecks();

      expect(prisma.job.update).not.toHaveBeenCalled();
    });
  });

  // ─── processHealthChecks ──────────────────────────────────────────

  describe('processHealthChecks', () => {
    it('should skip when all concurrency slots are busy', async () => {
      // Fill up all slots
      for (let i = 0; i < 5; i++) {
        (worker as any).currentlyChecking.add(`job-${i}`);
      }

      await (worker as any).processHealthChecks();

      expect(prisma.job.findMany).not.toHaveBeenCalled();
    });

    it('should apply backpressure when at 80% capacity', async () => {
      // 4 out of 5 slots = 80%
      for (let i = 0; i < 4; i++) {
        (worker as any).currentlyChecking.add(`job-${i}`);
      }

      await (worker as any).processHealthChecks();

      expect(prisma.job.findMany).not.toHaveBeenCalled();
    });

    it('should skip when no jobs need health checking', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      await (worker as any).processHealthChecks();

      // findMany called but no further processing
      expect(prisma.job.findMany).toHaveBeenCalled();
    });
  });

  // ─── calculateHealthCheckTimeout ──────────────────────────────────

  describe('calculateHealthCheckTimeout', () => {
    it('should return 1-minute timeout for zero-byte files', () => {
      const timeout = (worker as any).calculateHealthCheckTimeout(0n);
      const expectedMinAgo = Date.now() - 1 * 60 * 1000;

      expect(timeout.getTime()).toBeCloseTo(expectedMinAgo, -3); // within ~1s
    });

    it('should cap timeout at 60 minutes for files > 100GB', () => {
      const sizeBytes = BigInt(200 * 1024 * 1024 * 1024); // 200GB
      const timeout = (worker as any).calculateHealthCheckTimeout(sizeBytes);
      const expectedMinAgo = Date.now() - 60 * 60 * 1000;

      expect(timeout.getTime()).toBeCloseTo(expectedMinAgo, -3);
    });

    it('should scale timeout with file size', () => {
      const size10GB = BigInt(10 * 1024 * 1024 * 1024);
      const size50GB = BigInt(50 * 1024 * 1024 * 1024);

      const timeout10 = (worker as any).calculateHealthCheckTimeout(size10GB);
      const timeout50 = (worker as any).calculateHealthCheckTimeout(size50GB);

      // Larger files should get more time (older threshold)
      expect(timeout50.getTime()).toBeLessThan(timeout10.getTime());
    });

    it('should handle negative size as corrupted', () => {
      const timeout = (worker as any).calculateHealthCheckTimeout(-1n);
      const expectedMinAgo = Date.now() - 1 * 60 * 1000;

      expect(timeout.getTime()).toBeCloseTo(expectedMinAgo, -3);
    });
  });

  // ─── stop ─────────────────────────────────────────────────────────

  describe('stop', () => {
    it('should set isRunning to false', async () => {
      (worker as any).isRunning = true;

      await worker.stop();

      expect((worker as any).isRunning).toBe(false);
    });

    it('should await loop promise if it exists', async () => {
      const mockPromise = Promise.resolve();
      (worker as any).loopPromise = mockPromise;
      (worker as any).isRunning = true;

      await worker.stop();

      expect((worker as any).isRunning).toBe(false);
    });
  });

  // ─── buildHealthMessage ───────────────────────────────────────────

  describe('buildHealthMessage', () => {
    it('should format healthy result with score', () => {
      const result = {
        status: FileHealthStatus.HEALTHY,
        score: 95,
        issues: [],
        warnings: [],
      };

      const message = (worker as any).buildHealthMessage(result);

      expect(message).toContain('95/100');
    });

    it('should include issues in message', () => {
      const result = {
        status: FileHealthStatus.CORRUPTED,
        score: 20,
        issues: ['Missing audio stream', 'Truncated data'],
        warnings: [],
      };

      const message = (worker as any).buildHealthMessage(result);

      expect(message).toContain('Missing audio stream');
      expect(message).toContain('Truncated data');
    });

    it('should include warnings in message', () => {
      const result = {
        status: FileHealthStatus.WARNING,
        score: 70,
        issues: [],
        warnings: ['Low bitrate detected'],
      };

      const message = (worker as any).buildHealthMessage(result);

      expect(message).toContain('Low bitrate detected');
    });
  });
});
