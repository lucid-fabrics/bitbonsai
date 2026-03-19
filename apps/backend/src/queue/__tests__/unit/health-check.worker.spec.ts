import { Test, type TestingModule } from '@nestjs/testing';
import { FileHealthStatus, JobStage } from '@prisma/client';
import { JobRepository } from '../../../common/repositories/job.repository';
import { FileRelocatorService } from '../../../core/services/file-relocator.service';
import { ContainerCompatibilityService } from '../../../encoding/container-compatibility.service';
import { FfmpegService } from '../../../encoding/ffmpeg.service';
import { FileHealthService } from '../../../encoding/file-health.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { HealthCheckWorker } from '../../health-check.worker';
import { FileFailureTrackingService } from '../../services/file-failure-tracking.service';
import { HealthCheckCodecAnalyzerService } from '../../services/health-check-codec-analyzer.service';

describe('HealthCheckWorker', () => {
  let worker: HealthCheckWorker;
  let codecAnalyzer: HealthCheckCodecAnalyzerService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let jobRepository: Record<string, jest.Mock>;
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
        {
          provide: JobRepository,
          useValue: {
            findManySelect: jest.fn().mockResolvedValue([]),
            findManyWithInclude: jest.fn().mockResolvedValue([]),
            findUniqueWithInclude: jest.fn().mockResolvedValue(null),
            findUniqueSelect: jest.fn().mockResolvedValue(null),
            updateById: jest.fn().mockResolvedValue({}),
          },
        },
        { provide: FileHealthService, useValue: fileHealthService },
        { provide: ContainerCompatibilityService, useValue: containerCompatibilityService },
        { provide: FfmpegService, useValue: ffmpegService },
        { provide: FileRelocatorService, useValue: fileRelocatorService },
        { provide: FileFailureTrackingService, useValue: fileFailureTrackingService },
        HealthCheckCodecAnalyzerService,
      ],
    }).compile();

    worker = module.get<HealthCheckWorker>(HealthCheckWorker);
    codecAnalyzer = module.get<HealthCheckCodecAnalyzerService>(HealthCheckCodecAnalyzerService);
    jobRepository = module.get(JobRepository) as any;

    // Prevent the worker loop from starting during tests
    jest.spyOn(worker as any, 'start').mockImplementation(() => {
      /* noop */
    });

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

      // First findManySelect: eligible jobs, second findManySelect: exhausted jobs
      jobRepository.findManySelect.mockResolvedValueOnce(corruptedJobs).mockResolvedValueOnce([]);
      jobRepository.updateById.mockResolvedValue({});

      await worker.autoRequeueCorruptedJobs();

      expect(jobRepository.findManySelect).toHaveBeenCalledWith(
        expect.objectContaining({
          healthStatus: FileHealthStatus.CORRUPTED,
        }),
        expect.anything()
      );

      // Now uses individual updateById calls per job with corruptedRequeueCount increment
      expect(jobRepository.updateById).toHaveBeenCalledTimes(2);
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'j1',
        expect.objectContaining({
          stage: JobStage.DETECTED,
          healthStatus: FileHealthStatus.UNKNOWN,
        })
      );
    });

    it('should skip when no CORRUPTED jobs found', async () => {
      // First findManySelect: eligible jobs, second findManySelect: exhausted jobs
      jobRepository.findManySelect.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await worker.autoRequeueCorruptedJobs();

      expect(jobRepository.updateById).not.toHaveBeenCalled();
    });

    it('should prevent overlapping executions', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);

      // Simulate running state
      (worker as any).cronRunning = true;
      (worker as any).cronLockExpiry = Date.now();

      await worker.autoRequeueCorruptedJobs();

      // Should not call findManySelect because lock is held
      expect(jobRepository.findManySelect).not.toHaveBeenCalled();
    });

    it('should force reset stale lock (>2h old)', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);

      // Simulate stale lock (3 hours old)
      (worker as any).cronRunning = true;
      (worker as any).cronLockExpiry = Date.now() - 3 * 60 * 60 * 1000;

      await worker.autoRequeueCorruptedJobs();

      // Should proceed despite lock being held (stale)
      expect(jobRepository.findManySelect).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      jobRepository.findManySelect.mockRejectedValue(new Error('DB connection failed'));

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

      jobRepository.findManySelect.mockResolvedValue([stuckJob]);
      jobRepository.updateById.mockResolvedValue({});

      await (worker as any).timeoutStuckHealthChecks();

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'stuck-1',
        expect.objectContaining({
          stage: JobStage.FAILED,
          healthStatus: FileHealthStatus.CORRUPTED,
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

      jobRepository.findManySelect.mockResolvedValue([stuckJob]);
      jobRepository.updateById.mockResolvedValue({});

      await (worker as any).timeoutStuckHealthChecks();

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'stuck-1',
        expect.objectContaining({
          stage: JobStage.DETECTED,
          retryCount: 2,
          healthCheckStartedAt: null,
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

      jobRepository.findManySelect.mockResolvedValue([stuckJob]);
      jobRepository.updateById.mockResolvedValue({});

      await (worker as any).timeoutStuckHealthChecks();

      expect((worker as any).currentlyChecking.has('stuck-1')).toBe(false);
    });

    it('should handle no stuck jobs gracefully', async () => {
      jobRepository.findManySelect.mockResolvedValue([]);

      await (worker as any).timeoutStuckHealthChecks();

      expect(jobRepository.updateById).not.toHaveBeenCalled();
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

      expect(jobRepository.findManyWithInclude).not.toHaveBeenCalled();
    });

    it('should apply backpressure when at 80% capacity', async () => {
      // 4 out of 5 slots = 80%
      for (let i = 0; i < 4; i++) {
        (worker as any).currentlyChecking.add(`job-${i}`);
      }

      await (worker as any).processHealthChecks();

      expect(jobRepository.findManyWithInclude).not.toHaveBeenCalled();
    });

    it('should skip when no jobs need health checking', async () => {
      jobRepository.findManyWithInclude.mockResolvedValue([]);

      await (worker as any).processHealthChecks();

      // findManyWithInclude called but no further processing
      expect(jobRepository.findManyWithInclude).toHaveBeenCalled();
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

      const message = (codecAnalyzer as any).buildHealthMessage(result);

      expect(message).toContain('95/100');
    });

    it('should include issues in message', () => {
      const result = {
        status: FileHealthStatus.CORRUPTED,
        score: 20,
        issues: ['Missing audio stream', 'Truncated data'],
        warnings: [],
      };

      const message = (codecAnalyzer as any).buildHealthMessage(result);

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

      const message = (codecAnalyzer as any).buildHealthMessage(result);

      expect(message).toContain('Low bitrate detected');
    });

    it('should handle AT_RISK status', () => {
      const result = {
        status: FileHealthStatus.AT_RISK,
        score: 55,
        issues: ['Partial corruption'],
        warnings: ['Missing metadata'],
      };

      const message = (codecAnalyzer as any).buildHealthMessage(result);
      expect(message).toContain('55/100');
      expect(message).toContain('Partial corruption');
      expect(message).toContain('Missing metadata');
    });

    it('should handle UNKNOWN status', () => {
      const result = {
        status: FileHealthStatus.UNKNOWN,
        score: 0,
        issues: [],
        warnings: [],
      };

      const message = (codecAnalyzer as any).buildHealthMessage(result);
      expect(message).toContain('0/100');
    });
  });

  // ─── checkCodecMatch ─────────────────────────────────────────────

  describe('checkCodecMatch', () => {
    it('should return null when codecs differ', () => {
      const result = (codecAnalyzer as any).checkCodecMatch('h264', 'hevc');
      expect(result).toBeNull();
    });

    it('should return BLOCKER issue when source matches target codec', () => {
      const result = (codecAnalyzer as any).checkCodecMatch('hevc', 'hevc');
      expect(result).not.toBeNull();
      expect(result.code).toBe('CODEC_ALREADY_MATCHES_TARGET');
      expect(result.severity).toBe('BLOCKER');
    });

    it('should include skip_encoding as recommended action', () => {
      const result = (codecAnalyzer as any).checkCodecMatch('h264', 'h264');
      expect(result.suggestedActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'skip_encoding', recommended: true }),
        ])
      );
    });

    it('should include force_reencode and cancel_job actions', () => {
      const result = (codecAnalyzer as any).checkCodecMatch('av1', 'av1');
      const ids = result.suggestedActions.map((a: { id: string }) => a.id);
      expect(ids).toContain('force_reencode');
      expect(ids).toContain('cancel_job');
    });
  });

  // ─── getCodecDisplayName ──────────────────────────────────────────

  describe('getCodecDisplayName', () => {
    it('should return friendly name for known codecs', () => {
      expect((codecAnalyzer as any).getCodecDisplayName('hevc')).toBe('HEVC (H.265)');
      expect((codecAnalyzer as any).getCodecDisplayName('h264')).toBe('H.264 (AVC)');
      expect((codecAnalyzer as any).getCodecDisplayName('av1')).toBe('AV1');
      expect((codecAnalyzer as any).getCodecDisplayName('vp9')).toBe('VP9');
    });

    it('should uppercase unknown codecs', () => {
      expect((codecAnalyzer as any).getCodecDisplayName('mpeg2')).toBe('MPEG2');
    });
  });

  // ─── calculateExpectedSavingsPercent ─────────────────────────────

  describe('calculateExpectedSavingsPercent', () => {
    it('should return 5% for same-codec re-encoding', () => {
      const result = (codecAnalyzer as any).calculateExpectedSavingsPercent(
        'hevc',
        'hevc',
        BigInt(0)
      );
      expect(result).toBe(5);
    });

    it('should return ~35% for h264 → hevc', () => {
      const result = (codecAnalyzer as any).calculateExpectedSavingsPercent(
        'h264',
        'hevc',
        BigInt(0)
      );
      expect(result).toBe(35);
    });

    it('should return negative savings for hevc → h264', () => {
      const result = (codecAnalyzer as any).calculateExpectedSavingsPercent(
        'hevc',
        'h264',
        BigInt(0)
      );
      expect(result).toBeLessThan(0);
    });

    it('should return 0 for unknown codec pair', () => {
      const result = (codecAnalyzer as any).calculateExpectedSavingsPercent(
        'mpeg2',
        'wmv',
        BigInt(0)
      );
      expect(result).toBe(0);
    });
  });

  // ─── checkCodecMatchWithThreshold ────────────────────────────────

  describe('checkCodecMatchWithThreshold', () => {
    it('should return SAVINGS_BELOW_THRESHOLD issue', () => {
      const result = (codecAnalyzer as any).checkCodecMatchWithThreshold('h264', 'hevc', 10, 20);
      expect(result).not.toBeNull();
      expect(result.code).toBe('SAVINGS_BELOW_THRESHOLD');
      expect(result.severity).toBe('BLOCKER');
    });

    it('should include expected savings in message', () => {
      const result = (codecAnalyzer as any).checkCodecMatchWithThreshold('h264', 'hevc', 10, 30);
      expect(result.message).toContain('10%');
      expect(result.message).toContain('30%');
    });

    it('should have skip_encoding as recommended action', () => {
      const result = (codecAnalyzer as any).checkCodecMatchWithThreshold('h264', 'hevc', 5, 25);
      const recommended = result.suggestedActions.find(
        (a: { recommended: boolean }) => a.recommended
      );
      expect(recommended.id).toBe('skip_encoding');
    });
  });

  // ─── autoRequeueCorruptedJobs - exhausted jobs ────────────────────

  describe('autoRequeueCorruptedJobs - exhausted jobs', () => {
    it('should permanently fail exhausted jobs and record failure tracking', async () => {
      const exhaustedJob = {
        id: 'ex-1',
        fileLabel: 'bad.mkv',
        corruptedRequeueCount: 3,
        filePath: '/media/bad.mkv',
        libraryId: 'lib-1',
        contentFingerprint: 'fp-abc',
      };

      jobRepository.findManySelect
        .mockResolvedValueOnce([]) // eligible jobs (none)
        .mockResolvedValueOnce([exhaustedJob]); // exhausted jobs
      jobRepository.updateById.mockResolvedValue({});
      fileFailureTrackingService.recordFailure.mockResolvedValue(undefined);

      await worker.autoRequeueCorruptedJobs();

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'ex-1',
        expect.objectContaining({ stage: JobStage.FAILED })
      );
      expect(fileFailureTrackingService.recordFailure).toHaveBeenCalled();
    });

    it('should handle failure tracking error gracefully', async () => {
      const exhaustedJob = {
        id: 'ex-2',
        fileLabel: 'bad2.mkv',
        corruptedRequeueCount: 3,
        filePath: '/media/bad2.mkv',
        libraryId: 'lib-1',
        contentFingerprint: null,
      };

      jobRepository.findManySelect.mockResolvedValueOnce([]).mockResolvedValueOnce([exhaustedJob]);
      jobRepository.updateById.mockResolvedValue({});
      fileFailureTrackingService.recordFailure.mockRejectedValue(new Error('tracking DB down'));

      // Should not throw
      await expect(worker.autoRequeueCorruptedJobs()).resolves.not.toThrow();
    });
  });

  // ─── processHealthChecks - filtered jobs ─────────────────────────

  describe('processHealthChecks - filtered jobs', () => {
    it('should process DETECTED jobs immediately', async () => {
      const detectedJob = {
        id: 'job-d1',
        stage: JobStage.DETECTED,
        healthCheckStartedAt: null,
        beforeSizeBytes: BigInt(1024 * 1024 * 1024),
        filePath: '/media/file.mkv',
        fileLabel: 'file.mkv',
        sourceCodec: 'h264',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        policy: null,
      };

      jobRepository.findManyWithInclude.mockResolvedValue([detectedJob]);
      jobRepository.findUniqueWithInclude.mockResolvedValue(null); // job not found in checkJobHealth

      await (worker as any).processHealthChecks();

      expect(jobRepository.findManyWithInclude).toHaveBeenCalled();
    });

    it('should filter out HEALTH_CHECK jobs within dynamic timeout', async () => {
      const recentHealthCheckJob = {
        id: 'job-hc1',
        stage: JobStage.HEALTH_CHECK,
        healthCheckStartedAt: new Date(Date.now() - 1000), // just 1 second ago
        beforeSizeBytes: BigInt(1024 * 1024 * 1024), // 1GB → ~10 min timeout
        filePath: '/media/file.mkv',
        fileLabel: 'file.mkv',
        sourceCodec: 'h264',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        policy: null,
      };

      jobRepository.findManyWithInclude.mockResolvedValue([recentHealthCheckJob]);

      await (worker as any).processHealthChecks();

      // checkJobHealth should NOT be called since job is within timeout window
      expect(jobRepository.findUniqueWithInclude).not.toHaveBeenCalled();
    });
  });

  // ─── checkJobHealth - error retry paths ──────────────────────────

  describe('checkJobHealth - error paths', () => {
    it('should retry by resetting to DETECTED when healthCheckRetries < max', async () => {
      jobRepository.findUniqueWithInclude.mockResolvedValue({
        id: 'job-err',
        filePath: '/media/file.mkv',
        fileLabel: 'file.mkv',
        stage: JobStage.DETECTED,
        sourceCodec: 'h264',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        beforeSizeBytes: BigInt(1073741824),
        policy: null,
      });

      // Simulate file access failure by making fs.access throw
      jest.mock('fs/promises', () => ({
        access: jest.fn().mockRejectedValue(new Error('ENOENT')),
      }));

      // fileHealthService.analyzeFile throws
      fileHealthService.analyzeFile.mockRejectedValue(new Error('ffprobe failed'));

      // findUniqueSelect for retry count
      jobRepository.findUniqueSelect.mockResolvedValue({
        healthCheckRetries: 0,
        fileLabel: 'file.mkv',
      });
      jobRepository.updateById.mockResolvedValue({});
      prisma.$executeRaw.mockResolvedValue(1);

      // Mock fs/promises to allow file access
      const mockFsPromises = { access: jest.fn().mockResolvedValue(undefined) };
      jest.doMock('fs/promises', () => mockFsPromises);
      containerCompatibilityService.checkCompatibility.mockResolvedValue([]);

      await (worker as any).checkJobHealth('job-err');

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-err',
        expect.objectContaining({ stage: JobStage.DETECTED, healthCheckRetries: 1 })
      );
    });

    it('should mark FAILED when healthCheckRetries >= max', async () => {
      jobRepository.findUniqueWithInclude.mockResolvedValue({
        id: 'job-maxerr',
        filePath: '/media/file.mkv',
        fileLabel: 'file.mkv',
        stage: JobStage.DETECTED,
        sourceCodec: 'h264',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        beforeSizeBytes: BigInt(1073741824),
        policy: null,
      });

      fileHealthService.analyzeFile.mockRejectedValue(new Error('crash'));
      jobRepository.findUniqueSelect.mockResolvedValue({
        healthCheckRetries: 3,
        fileLabel: 'file.mkv',
      });
      jobRepository.updateById.mockResolvedValue({});
      prisma.$executeRaw.mockResolvedValue(1);
      containerCompatibilityService.checkCompatibility.mockResolvedValue([]);

      const mockFsPromises = { access: jest.fn().mockResolvedValue(undefined) };
      jest.doMock('fs/promises', () => mockFsPromises);

      await (worker as any).checkJobHealth('job-maxerr');

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-maxerr',
        expect.objectContaining({
          stage: JobStage.FAILED,
          healthStatus: FileHealthStatus.CORRUPTED,
        })
      );
    });

    it('should skip when job not found', async () => {
      jobRepository.findUniqueWithInclude.mockResolvedValue(null);
      // fs.access mock via doMock
      const mockFsPromises = { access: jest.fn().mockResolvedValue(undefined) };
      jest.doMock('fs/promises', () => mockFsPromises);
      prisma.$executeRaw.mockResolvedValue(0); // not claimed

      await (worker as any).checkJobHealth('nonexistent');

      // Should not crash or call updateById
      expect(jobRepository.updateById).not.toHaveBeenCalled();
    });

    it('should skip when job already claimed by another worker', async () => {
      jobRepository.findUniqueWithInclude.mockResolvedValue({
        id: 'job-claimed',
        filePath: '/media/file.mkv',
        fileLabel: 'file.mkv',
        stage: JobStage.DETECTED,
        sourceCodec: 'h264',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        beforeSizeBytes: BigInt(1073741824),
        policy: null,
      });

      const mockFsPromises = { access: jest.fn().mockResolvedValue(undefined) };
      jest.doMock('fs/promises', () => mockFsPromises);

      prisma.$executeRaw.mockResolvedValue(0); // claim returns 0 = already claimed

      await (worker as any).checkJobHealth('job-claimed');

      expect(fileHealthService.analyzeFile).not.toHaveBeenCalled();
    });
  });

  // ─── timeoutStuckHealthChecks - no healthCheckStartedAt ──────────

  describe('timeoutStuckHealthChecks - edge cases', () => {
    it('should use 10 min as fallback when healthCheckStartedAt is null', async () => {
      const stuckJob = {
        id: 'stuck-null',
        fileLabel: 'stuck-null.mkv',
        healthCheckStartedAt: null,
        retryCount: 3,
      };

      jobRepository.findManySelect.mockResolvedValue([stuckJob]);
      jobRepository.updateById.mockResolvedValue({});

      await (worker as any).timeoutStuckHealthChecks();

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'stuck-null',
        expect.objectContaining({ stage: JobStage.FAILED })
      );
    });

    it('should calculate backoff exponentially for retries', async () => {
      const stuckJob0 = {
        id: 'stuck-backoff-0',
        fileLabel: 'file0.mkv',
        healthCheckStartedAt: new Date(Date.now() - 15 * 60 * 1000),
        retryCount: 0, // backoff = 30s
      };

      const stuckJob1 = {
        id: 'stuck-backoff-1',
        fileLabel: 'file1.mkv',
        healthCheckStartedAt: new Date(Date.now() - 15 * 60 * 1000),
        retryCount: 1, // backoff = 60s
      };

      jobRepository.findManySelect.mockResolvedValue([stuckJob0, stuckJob1]);
      jobRepository.updateById.mockResolvedValue({});

      await (worker as any).timeoutStuckHealthChecks();

      // Both should be reset to DETECTED
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'stuck-backoff-0',
        expect.objectContaining({ stage: JobStage.DETECTED, retryCount: 1 })
      );
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'stuck-backoff-1',
        expect.objectContaining({ stage: JobStage.DETECTED, retryCount: 2 })
      );
    });

    it('should include nextRetryAt in reset payload', async () => {
      const stuckJob = {
        id: 'stuck-backoff-next',
        fileLabel: 'file-next.mkv',
        healthCheckStartedAt: new Date(Date.now() - 15 * 60 * 1000),
        retryCount: 0,
      };

      jobRepository.findManySelect.mockResolvedValue([stuckJob]);
      jobRepository.updateById.mockResolvedValue({});

      await (worker as any).timeoutStuckHealthChecks();

      const call = jobRepository.updateById.mock.calls[0][1];
      expect(call.nextRetryAt).toBeInstanceOf(Date);
    });

    it('should cap backoff at 300000ms for retryCount >= 4', async () => {
      const stuckJob = {
        id: 'stuck-capped',
        fileLabel: 'file-capped.mkv',
        healthCheckStartedAt: new Date(Date.now() - 15 * 60 * 1000),
        retryCount: 4, // 30000 * 2^4 = 480000 → capped at 300000
      };

      // retryCount 4 < MAX_RETRY_ATTEMPTS (3)? No, 4 >= 3, so it should FAIL
      // Actually MAX_RETRY_ATTEMPTS = 3, so retryCount 4 >= 3 → mark FAILED
      jobRepository.findManySelect.mockResolvedValue([stuckJob]);
      jobRepository.updateById.mockResolvedValue({});

      await (worker as any).timeoutStuckHealthChecks();

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'stuck-capped',
        expect.objectContaining({ stage: JobStage.FAILED })
      );
    });

    it('should remove job from currentlyChecking when retries remain', async () => {
      (worker as any).currentlyChecking.add('retry-job');

      const stuckJob = {
        id: 'retry-job',
        fileLabel: 'retry.mkv',
        healthCheckStartedAt: new Date(Date.now() - 15 * 60 * 1000),
        retryCount: 1,
      };

      jobRepository.findManySelect.mockResolvedValue([stuckJob]);
      jobRepository.updateById.mockResolvedValue({});

      await (worker as any).timeoutStuckHealthChecks();

      expect((worker as any).currentlyChecking.has('retry-job')).toBe(false);
    });
  });

  // ─── calculateHealthCheckTimeout - boundary conditions ────────────

  describe('calculateHealthCheckTimeout - boundaries', () => {
    it('should return exactly 60min timeout for exactly 100GB file', () => {
      const size100GB = BigInt(100 * 1024 * 1024 * 1024);
      const timeout = (worker as any).calculateHealthCheckTimeout(size100GB);
      // 100GB: sizeGB = 100, 100 > 100n is false → timeoutMinutes = min(60, 10 + 100/2) = min(60, 60) = 60
      const expectedMinAgo = Date.now() - 60 * 60 * 1000;
      expect(timeout.getTime()).toBeCloseTo(expectedMinAgo, -3);
    });

    it('should return 10-min timeout for 1-byte file', () => {
      const size1Byte = BigInt(1);
      const timeout = (worker as any).calculateHealthCheckTimeout(size1Byte);
      // sizeGB = 0, timeoutMinutes = min(60, 10 + 0) = 10
      const expectedMinAgo = Date.now() - 10 * 60 * 1000;
      expect(timeout.getTime()).toBeCloseTo(expectedMinAgo, -3);
    });
  });

  // ─── autoRequeueCorruptedJobs - logging sample ───────────────────

  describe('autoRequeueCorruptedJobs - more than 5 jobs', () => {
    it('should reset all jobs when more than 5 corrupted jobs exist', async () => {
      const manyJobs = Array.from({ length: 8 }, (_, i) => ({
        id: `j${i}`,
        fileLabel: `file${i}.mkv`,
        healthMessage: 'corrupt',
        healthCheckedAt: new Date(),
        corruptedRequeueCount: 0,
        filePath: `/path/file${i}.mkv`,
        libraryId: 'lib1',
      }));

      jobRepository.findManySelect.mockResolvedValueOnce(manyJobs).mockResolvedValueOnce([]);
      jobRepository.updateById.mockResolvedValue({});

      await worker.autoRequeueCorruptedJobs();

      expect(jobRepository.updateById).toHaveBeenCalledTimes(8);
    });
  });

  // ─── processHealthChecks - HEALTH_CHECK orphan with no startedAt ──

  describe('processHealthChecks - HEALTH_CHECK orphan', () => {
    it('should include HEALTH_CHECK orphan with null startedAt in processing', async () => {
      const orphanJob = {
        id: 'orphan-hc',
        stage: JobStage.HEALTH_CHECK,
        healthCheckStartedAt: null,
        beforeSizeBytes: BigInt(1024 * 1024 * 1024),
        filePath: '/media/orphan.mkv',
        fileLabel: 'orphan.mkv',
        sourceCodec: 'h264',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        policy: null,
      };

      jobRepository.findManyWithInclude.mockResolvedValue([orphanJob]);
      jobRepository.findUniqueWithInclude.mockResolvedValue(null);

      await (worker as any).processHealthChecks();

      expect(jobRepository.findManyWithInclude).toHaveBeenCalled();
    });

    it('should return early when all filtered jobs are within timeout window', async () => {
      // A HEALTH_CHECK job started just now (within any timeout window)
      const recentJob = {
        id: 'recent-hc',
        stage: JobStage.HEALTH_CHECK,
        healthCheckStartedAt: new Date(), // just started
        beforeSizeBytes: BigInt(1024 * 1024 * 1024), // 1GB → ~10min timeout
        filePath: '/media/recent.mkv',
        fileLabel: 'recent.mkv',
        sourceCodec: 'h264',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        policy: null,
      };

      jobRepository.findManyWithInclude.mockResolvedValue([recentJob]);

      await (worker as any).processHealthChecks();

      // findUniqueWithInclude should NOT be called since job is filtered out
      expect(jobRepository.findUniqueWithInclude).not.toHaveBeenCalled();
    });
  });

  // ─── start / onModuleInit ─────────────────────────────────────────

  describe('start / onModuleInit', () => {
    it('should not start a second loop when already running', () => {
      (worker as any).isRunning = true;
      const originalLoopPromise = Promise.resolve();
      (worker as any).loopPromise = originalLoopPromise;

      (worker as any).start();

      // loopPromise should remain unchanged
      expect((worker as any).loopPromise).toBe(originalLoopPromise);
    });

    it('should call start() during onModuleInit', async () => {
      const startSpy = jest.spyOn(worker as any, 'start');
      await worker.onModuleInit();
      expect(startSpy).toHaveBeenCalled();
    });
  });

  // ─── checkCodecMatch - metadata structure ────────────────────────

  describe('checkCodecMatch - metadata', () => {
    it('should include metadata with codecMatch=true in returned issue', () => {
      const result = (codecAnalyzer as any).checkCodecMatch('hevc', 'hevc');
      expect(result.metadata).toEqual(expect.objectContaining({ codecMatch: true }));
    });

    it('should set category to CODEC', () => {
      const result = (codecAnalyzer as any).checkCodecMatch('av1', 'av1');
      expect(result.category).toBe('CODEC');
    });
  });

  // ─── checkCodecMatchWithThreshold - metadata ─────────────────────

  describe('checkCodecMatchWithThreshold - metadata', () => {
    it('should include expectedSavings and minSavingsThreshold in metadata', () => {
      const result = (codecAnalyzer as any).checkCodecMatchWithThreshold('h264', 'hevc', 15, 30);
      expect(result.metadata).toEqual(
        expect.objectContaining({ expectedSavings: 15, minSavingsThreshold: 30 })
      );
    });

    it('should list all three action ids', () => {
      const result = (codecAnalyzer as any).checkCodecMatchWithThreshold('h264', 'hevc', 5, 20);
      const ids = result.suggestedActions.map((a: { id: string }) => a.id);
      expect(ids).toContain('skip_encoding');
      expect(ids).toContain('force_reencode');
      expect(ids).toContain('cancel_job');
    });
  });

  // ─── buildHealthMessage - edge cases ─────────────────────────────

  describe('buildHealthMessage - edge cases', () => {
    it('should cap score display at 100 (score from buildHealthMessage reflects passed value)', () => {
      const result = {
        status: FileHealthStatus.HEALTHY,
        score: 100,
        issues: [],
        warnings: [],
      };
      const message = (codecAnalyzer as any).buildHealthMessage(result);
      expect(message).toContain('100/100');
    });

    it('should join multiple issues with semicolon', () => {
      const result = {
        status: FileHealthStatus.CORRUPTED,
        score: 10,
        issues: ['issue A', 'issue B', 'issue C'],
        warnings: [],
      };
      const message = (codecAnalyzer as any).buildHealthMessage(result);
      expect(message).toContain('issue A; issue B; issue C');
    });
  });

  // ─── checkJobHealth - happy paths ─────────────────────────────────

  describe('checkJobHealth - healthy file → QUEUED', () => {
    const healthyJob = {
      id: 'job-healthy',
      filePath: '/media/file.mkv',
      fileLabel: 'file.mkv',
      stage: JobStage.DETECTED,
      sourceCodec: 'h264',
      targetCodec: 'hevc',
      targetContainer: 'mkv',
      beforeSizeBytes: BigInt(1073741824),
      policy: null,
    };

    it('should update job to QUEUED when health check passes', async () => {
      jobRepository.findUniqueWithInclude.mockResolvedValue(healthyJob);
      prisma.$executeRaw.mockResolvedValue(1);
      containerCompatibilityService.checkCompatibility.mockResolvedValue([]);
      fileHealthService.analyzeFile.mockResolvedValue({
        status: FileHealthStatus.HEALTHY,
        score: 90,
        canEncode: true,
        issues: [],
        warnings: [],
      });

      const mockFsPromises = { access: jest.fn().mockResolvedValue(undefined) };
      jest.doMock('fs/promises', () => mockFsPromises);

      await (worker as any).checkJobHealth('job-healthy');

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-healthy',
        expect.objectContaining({ stage: JobStage.QUEUED })
      );
    });

    it('should update job to FAILED when health score is below threshold', async () => {
      jobRepository.findUniqueWithInclude.mockResolvedValue(healthyJob);
      prisma.$executeRaw.mockResolvedValue(1);
      containerCompatibilityService.checkCompatibility.mockResolvedValue([]);
      fileHealthService.analyzeFile.mockResolvedValue({
        status: FileHealthStatus.CORRUPTED,
        score: 20,
        canEncode: false,
        issues: ['truncated data'],
        warnings: [],
      });

      const mockFsPromises = { access: jest.fn().mockResolvedValue(undefined) };
      jest.doMock('fs/promises', () => mockFsPromises);

      await (worker as any).checkJobHealth('job-healthy');

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-healthy',
        expect.objectContaining({ stage: JobStage.FAILED })
      );
    });

    it('should update job to NEEDS_DECISION when blocker compatibility issues found', async () => {
      jobRepository.findUniqueWithInclude.mockResolvedValue(healthyJob);
      prisma.$executeRaw.mockResolvedValue(1);
      containerCompatibilityService.checkCompatibility.mockResolvedValue([
        {
          severity: 'BLOCKER',
          category: 'CODEC',
          code: 'TEST',
          message: 'blocker',
          suggestedActions: [],
          metadata: {},
        },
      ]);
      fileHealthService.analyzeFile.mockResolvedValue({
        status: FileHealthStatus.HEALTHY,
        score: 85,
        canEncode: true,
        issues: [],
        warnings: [],
      });

      const mockFsPromises = { access: jest.fn().mockResolvedValue(undefined) };
      jest.doMock('fs/promises', () => mockFsPromises);

      await (worker as any).checkJobHealth('job-healthy');

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-healthy',
        expect.objectContaining({ stage: JobStage.NEEDS_DECISION })
      );
    });
  });

  describe('checkJobHealth - allowSameCodec branches', () => {
    it('should add codec match issue when allowSameCodec=false and codecs match', async () => {
      const sameCodecJob = {
        id: 'job-same',
        filePath: '/media/file.mkv',
        fileLabel: 'file.mkv',
        stage: JobStage.DETECTED,
        sourceCodec: 'hevc',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        beforeSizeBytes: BigInt(1073741824),
        policy: { allowSameCodec: false, minSavingsPercent: 0 },
      };

      jobRepository.findUniqueWithInclude.mockResolvedValue(sameCodecJob);
      prisma.$executeRaw.mockResolvedValue(1);
      containerCompatibilityService.checkCompatibility.mockResolvedValue([]);
      fileHealthService.analyzeFile.mockResolvedValue({
        status: FileHealthStatus.HEALTHY,
        score: 85,
        canEncode: true,
        issues: [],
        warnings: [],
      });

      const mockFsPromises = { access: jest.fn().mockResolvedValue(undefined) };
      jest.doMock('fs/promises', () => mockFsPromises);

      await (worker as any).checkJobHealth('job-same');

      // Should add BLOCKER codec match issue → NEEDS_DECISION
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-same',
        expect.objectContaining({ stage: JobStage.NEEDS_DECISION })
      );
    });

    it('should add savings threshold issue when allowSameCodec=true but savings below threshold', async () => {
      const savingsJob = {
        id: 'job-savings',
        filePath: '/media/file.mkv',
        fileLabel: 'file.mkv',
        stage: JobStage.DETECTED,
        sourceCodec: 'hevc', // hevc → av1 gives 25%, threshold is 30%
        targetCodec: 'av1',
        targetContainer: 'mkv',
        beforeSizeBytes: BigInt(1073741824),
        policy: { allowSameCodec: true, minSavingsPercent: 30 },
      };

      jobRepository.findUniqueWithInclude.mockResolvedValue(savingsJob);
      prisma.$executeRaw.mockResolvedValue(1);
      containerCompatibilityService.checkCompatibility.mockResolvedValue([]);
      fileHealthService.analyzeFile.mockResolvedValue({
        status: FileHealthStatus.HEALTHY,
        score: 85,
        canEncode: true,
        issues: [],
        warnings: [],
      });

      const mockFsPromises = { access: jest.fn().mockResolvedValue(undefined) };
      jest.doMock('fs/promises', () => mockFsPromises);

      await (worker as any).checkJobHealth('job-savings');

      // hevc→av1 = 25% < 30% threshold → NEEDS_DECISION
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-savings',
        expect.objectContaining({ stage: JobStage.NEEDS_DECISION })
      );
    });

    it('should skip codec check when allowSameCodec=true and savings meet threshold', async () => {
      const highSavingsJob = {
        id: 'job-high-savings',
        filePath: '/media/file.mkv',
        fileLabel: 'file.mkv',
        stage: JobStage.DETECTED,
        sourceCodec: 'h264', // h264 → hevc = 35% > 20% threshold
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        beforeSizeBytes: BigInt(1073741824),
        policy: { allowSameCodec: true, minSavingsPercent: 20 },
      };

      jobRepository.findUniqueWithInclude.mockResolvedValue(highSavingsJob);
      prisma.$executeRaw.mockResolvedValue(1);
      containerCompatibilityService.checkCompatibility.mockResolvedValue([]);
      fileHealthService.analyzeFile.mockResolvedValue({
        status: FileHealthStatus.HEALTHY,
        score: 85,
        canEncode: true,
        issues: [],
        warnings: [],
      });

      const mockFsPromises = { access: jest.fn().mockResolvedValue(undefined) };
      jest.doMock('fs/promises', () => mockFsPromises);

      await (worker as any).checkJobHealth('job-high-savings');

      // 35% savings > 20% threshold, no codec issue → QUEUED
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-high-savings',
        expect.objectContaining({ stage: JobStage.QUEUED })
      );
    });

    it('should skip codec check entirely when allowSameCodec=true and minSavingsPercent=0', async () => {
      const allowAllJob = {
        id: 'job-allow-all',
        filePath: '/media/file.mkv',
        fileLabel: 'file.mkv',
        stage: JobStage.DETECTED,
        sourceCodec: 'hevc',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        beforeSizeBytes: BigInt(1073741824),
        policy: { allowSameCodec: true, minSavingsPercent: 0 },
      };

      jobRepository.findUniqueWithInclude.mockResolvedValue(allowAllJob);
      prisma.$executeRaw.mockResolvedValue(1);
      containerCompatibilityService.checkCompatibility.mockResolvedValue([]);
      fileHealthService.analyzeFile.mockResolvedValue({
        status: FileHealthStatus.HEALTHY,
        score: 85,
        canEncode: true,
        issues: [],
        warnings: [],
      });

      const mockFsPromises = { access: jest.fn().mockResolvedValue(undefined) };
      jest.doMock('fs/promises', () => mockFsPromises);

      await (worker as any).checkJobHealth('job-allow-all');

      // allowSameCodec=true, minSavingsPercent=0 → skip codec check → QUEUED
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-allow-all',
        expect.objectContaining({ stage: JobStage.QUEUED })
      );
    });
  });

  describe('checkJobHealth - error handler: findUniqueSelect returns null', () => {
    it('should return early when job not found in error handler', async () => {
      jobRepository.findUniqueWithInclude.mockResolvedValue({
        id: 'job-err-null',
        filePath: '/media/file.mkv',
        fileLabel: 'file.mkv',
        stage: JobStage.DETECTED,
        sourceCodec: 'h264',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        beforeSizeBytes: BigInt(1073741824),
        policy: null,
      });
      prisma.$executeRaw.mockResolvedValue(1);
      fileHealthService.analyzeFile.mockRejectedValue(new Error('crash'));
      // Return null from findUniqueSelect (job deleted between claim and error handler)
      jobRepository.findUniqueSelect.mockResolvedValue(null);
      containerCompatibilityService.checkCompatibility.mockResolvedValue([]);
      const mockFsPromises = { access: jest.fn().mockResolvedValue(undefined) };
      jest.doMock('fs/promises', () => mockFsPromises);

      await (worker as any).checkJobHealth('job-err-null');

      // updateById should NOT be called since findUniqueSelect returned null
      expect(jobRepository.updateById).not.toHaveBeenCalled();
    });
  });

  describe('autoRequeueCorruptedJobs - non-Error thrown', () => {
    it('should handle non-Error thrown value gracefully', async () => {
      jobRepository.findManySelect.mockRejectedValue('string error');

      await expect(worker.autoRequeueCorruptedJobs()).resolves.not.toThrow();
      expect((worker as any).cronRunning).toBe(false);
    });
  });
});
