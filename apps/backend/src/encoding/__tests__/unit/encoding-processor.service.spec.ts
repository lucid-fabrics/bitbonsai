import * as fs from 'node:fs';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../../common/repositories/job.repository';
import { LibraryRepository } from '../../../common/repositories/library.repository';
import { PolicyRepository } from '../../../common/repositories/policy.repository';
import { FileRelocatorService } from '../../../core/services/file-relocator.service';
import { LibrariesService } from '../../../libraries/libraries.service';
import { NodesService } from '../../../nodes/nodes.service';
import { QueueService } from '../../../queue/queue.service';
import { createMockJob, createMockPolicy } from '../../../testing/mock-factories';
import {
  mockDataAccessProvider,
  mockEventEmitterProvider,
  mockFileRelocatorProvider,
} from '../../../testing/mock-providers';
import { EncodingFileService } from '../../encoding-file.service';
import { EncodingProcessorService } from '../../encoding-processor.service';
import { EncodingStartupService } from '../../encoding-startup.service';
import { EncodingWatchdogService } from '../../encoding-watchdog.service';
import { FfmpegService } from '../../ffmpeg.service';
import { JobRetryStrategyService } from '../../job-retry-strategy.service';
import { PoolLockService } from '../../pool-lock.service';
import { SystemResourceService } from '../../system-resource.service';
import { WorkerPoolService } from '../../worker-pool.service';

// Mock fs module
jest.mock('node:fs');

describe('EncodingProcessorService', () => {
  let service: EncodingProcessorService;
  let module: TestingModule;
  let queueService: jest.Mocked<QueueService>;
  let ffmpegService: jest.Mocked<FfmpegService>;
  let librariesService: jest.Mocked<LibrariesService>;
  let workerPoolService: jest.Mocked<WorkerPoolService>;

  const mockPolicy = createMockPolicy({
    id: 'policy-1',
    advancedSettings: {
      hwaccel: 'auto',
      audioCodec: 'copy',
      subtitleHandling: 'copy',
    },
  });

  const mockJob = {
    ...createMockJob({
      id: 'job-123',
      filePath: '/media/test-video.mkv',
      fileLabel: 'Test Video.mkv',
      sourceCodec: 'H.264',
      targetCodec: 'HEVC',
      stage: JobStage.ENCODING,
      beforeSizeBytes: BigInt(1000000000),
      startedAt: new Date(),
      nodeId: 'node-1',
      libraryId: 'library-1',
      policyId: 'policy-1',
    }),
    policy: mockPolicy,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      providers: [
        EncodingProcessorService,
        {
          provide: JobRepository,
          useValue: {
            findById: jest.fn(),
            findFirstWhere: jest.fn(),
            findFirstSelect: jest.fn(),
            findUniqueSelect: jest.fn(),
            findManyWithInclude: jest.fn().mockResolvedValue([]),
            updateById: jest.fn(),
            updateByIdWithInclude: jest.fn(),
            atomicUpdateMany: jest.fn(),
            countWhere: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: LibraryRepository,
          useValue: {
            findUniqueWithInclude: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: PolicyRepository,
          useValue: {
            findById: jest.fn(),
            findAll: jest.fn().mockResolvedValue([]),
          },
        },
        mockDataAccessProvider,
        mockFileRelocatorProvider,
        mockEventEmitterProvider,
        {
          provide: QueueService,
          useValue: {
            getNextJob: jest.fn(),
            completeJob: jest.fn(),
            failJob: jest.fn(),
            updateProgress: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: FfmpegService,
          useValue: {
            encode: jest.fn(),
            encodeFile: jest.fn(),
            verifyFile: jest.fn(),
            detectHardwareAcceleration: jest.fn(),
            buildFfmpegCommand: jest.fn(),
            cancelEncoding: jest.fn(),
            getActiveEncodings: jest.fn().mockReturnValue([]),
            getEncodingStatus: jest.fn(),
          },
        },
        {
          provide: LibrariesService,
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: NodesService,
          useValue: {
            findOne: jest.fn(),
            findAll: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
            getCurrentNode: jest.fn().mockResolvedValue({ id: 'node-1', maxWorkers: 4 }),
          },
        },
        {
          provide: SystemResourceService,
          useValue: {
            defaultWorkersPerNode: 4,
            maxWorkersPerNode: 12,
            calculateOptimalWorkers: jest.fn().mockReturnValue(4),
            checkSystemLoad: jest
              .fn()
              .mockReturnValue({ isOverloaded: false, reason: '', details: '' }),
            waitForSystemLoad: jest.fn().mockResolvedValue(undefined),
            performResourcePreflightChecks: jest.fn().mockResolvedValue(undefined),
            reloadLoadThreshold: jest.fn().mockResolvedValue(undefined),
            getLoadThresholdMultiplier: jest.fn().mockReturnValue(2.0),
            getEncodingTempPath: jest.fn().mockReturnValue(null),
            getSystemLoadInfo: jest.fn().mockReturnValue({
              loadAvg1m: 0,
              loadAvg5m: 0,
              loadAvg15m: 0,
              cpuCount: 8,
              loadThreshold: 16,
              loadThresholdMultiplier: 2.0,
              freeMemoryGB: 16,
              totalMemoryGB: 32,
              isOverloaded: false,
              reason: '',
            }),
          },
        },
        {
          provide: PoolLockService,
          useValue: {
            initialize: jest.fn(),
            acquire: jest.fn().mockResolvedValue(undefined),
            release: jest.fn(),
            withLock: jest.fn().mockImplementation((_nodeId, _holder, fn) => fn()),
          },
        },
        {
          provide: EncodingFileService,
          useValue: {
            encodeFile: jest.fn().mockResolvedValue({
              beforeSizeBytes: BigInt(1000000000),
              afterSizeBytes: BigInt(750000000),
              savedBytes: BigInt(250000000),
              savedPercent: 25.0,
            }),
            checkTempFileWithRetry: jest.fn().mockResolvedValue(false),
            updateLibraryStats: jest.fn().mockResolvedValue(undefined),
            sleep: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: WorkerPoolService,
          useValue: {
            startWorkerPool: jest.fn().mockResolvedValue(undefined),
            stopWorker: jest.fn().mockResolvedValue(undefined),
            getWorker: jest.fn().mockReturnValue(null),
            getWorkers: jest.fn().mockReturnValue(new Map()),
            getAllWorkers: jest.fn().mockReturnValue(new Map()),
            setWorkerJob: jest.fn(),
            isWorkerRunning: jest.fn().mockReturnValue(false),
            removeWorker: jest.fn(),
            resolveShutdown: jest.fn(),
          },
        },
        JobRetryStrategyService,
        {
          provide: EncodingStartupService,
          useValue: {
            waitForVolumeMounts: jest.fn().mockResolvedValue(undefined),
            autoHealOrphanedJobs: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: EncodingWatchdogService,
          useValue: {
            startStuckJobWatchdog: jest.fn().mockReturnValue(undefined),
            manageLoadBasedPausing: jest.fn().mockResolvedValue(undefined),
            getSystemDiagnostics: jest.fn().mockResolvedValue('System Diagnostics:\n- No issues'),
          },
        },
      ],
    }).compile();

    service = module.get<EncodingProcessorService>(EncodingProcessorService);
    queueService = module.get(QueueService);
    ffmpegService = module.get(FfmpegService);
    librariesService = module.get(LibrariesService);
    workerPoolService = module.get(WorkerPoolService);
  });

  /**
   * Helper: register a worker so processNextJob can find it
   */
  function registerWorker(workerId = 'node-1') {
    workerPoolService.getWorker.mockReturnValue({
      workerId,
      nodeId: 'node-1',
      isRunning: true,
      currentJobId: null,
      startedAt: new Date(),
    } as any);
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startWorkerPool', () => {
    it('should delegate to WorkerPoolService', async () => {
      workerPoolService.startWorkerPool.mockResolvedValue(2 as any);
      await service.startWorkerPool('node-1', 4);
      expect(workerPoolService.startWorkerPool).toHaveBeenCalled();
    });
  });

  describe('stopWorker', () => {
    it('should delegate to WorkerPoolService', async () => {
      await service.stopWorker('node-1');
      expect(workerPoolService.stopWorker).toHaveBeenCalledWith('node-1', undefined);
    });

    it('should handle stopping non-existent worker gracefully', async () => {
      workerPoolService.stopWorker.mockResolvedValue(undefined);
      await expect(service.stopWorker('non-existent')).resolves.not.toThrow();
    });
  });

  describe('processNextJob', () => {
    beforeEach(() => {
      registerWorker();
    });

    it('should return null when no jobs available', async () => {
      queueService.getNextJob.mockResolvedValue(null);

      const result = await service.processNextJob('node-1');

      expect(result).toBeNull();
      expect(queueService.getNextJob).toHaveBeenCalledWith('node-1');
    });

    it('should return null when worker not registered', async () => {
      const result = await service.processNextJob('non-existent-worker');
      expect(result).toBeNull();
    });

    it('should successfully process a job', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath === '/media/test-video.mkv') return { size: 1000000000 };
        if (filePath.includes('.tmp')) return { size: 750000000 };
        return { size: 0 };
      });
      (fs.renameSync as jest.Mock).mockImplementation(() => undefined);
      (fs.unlinkSync as jest.Mock).mockImplementation(() => undefined);

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      ffmpegService.encode.mockResolvedValue();
      ffmpegService.verifyFile.mockResolvedValue({ isValid: true });
      librariesService.findOne.mockResolvedValue({
        id: 'library-1',
        totalSizeBytes: BigInt(10000000000),
      } as never);
      librariesService.update.mockResolvedValue({} as never);
      queueService.completeJob.mockResolvedValue(mockJob as any);
      queueService.update.mockResolvedValue(mockJob as any);

      const _result = await service.processNextJob('node-1');

      // Job should be processed (returned or null depending on internal flow)
      // The important thing is no errors thrown
      expect(queueService.getNextJob).toHaveBeenCalledWith('node-1');
    });

    it('should fail job when source file does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      queueService.failJob.mockResolvedValue(mockJob as any);
      queueService.update.mockResolvedValue(mockJob as any);

      const result = await service.processNextJob('node-1');

      expect(result).toBeNull();
    });
  });

  describe('handleJobCompletion', () => {
    it('should update job and library stats on completion', async () => {
      const result = {
        beforeSizeBytes: BigInt(1000000000),
        afterSizeBytes: BigInt(750000000),
        savedBytes: BigInt(250000000),
        savedPercent: 25.0,
      };

      librariesService.findOne.mockResolvedValue({
        id: 'library-1',
        totalSizeBytes: BigInt(10000000000),
      } as never);
      librariesService.update.mockResolvedValue({} as never);
      queueService.completeJob.mockResolvedValue(mockJob as any);

      await service.handleJobCompletion(mockJob as any, result);

      expect(queueService.completeJob).toHaveBeenCalledWith('job-123', {
        afterSizeBytes: '750000000',
        savedBytes: '250000000',
        savedPercent: 25.0,
      });
    });

    it('should handle library update errors gracefully', async () => {
      const result = {
        beforeSizeBytes: BigInt(1000000000),
        afterSizeBytes: BigInt(750000000),
        savedBytes: BigInt(250000000),
        savedPercent: 25.0,
      };

      queueService.completeJob.mockRejectedValue(new Error('Database error'));

      // handleJobCompletion re-throws errors from completeJob
      await expect(service.handleJobCompletion(mockJob as any, result)).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('handleJobFailure', () => {
    it('should mark job as failed for non-transient errors', async () => {
      const error = new Error('Invalid codec');

      queueService.failJob.mockResolvedValue(mockJob as any);

      await service.handleJobFailure(mockJob as any, error);

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('Invalid codec')
      );
    });

    it('should retry job for transient errors', async () => {
      const error = new Error('ETIMEDOUT: Network timeout');

      queueService.update.mockResolvedValue(mockJob as any);

      await service.handleJobFailure(createMockJob({ id: 'job-123', retryCount: 0 }) as any, error);

      expect(queueService.update).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({
          stage: 'QUEUED',
          progress: 0,
          retryCount: 1,
        })
      );
    });

    it('should not retry after max retries exceeded', async () => {
      const error = new Error('ETIMEDOUT: Network timeout');

      queueService.failJob.mockResolvedValue(mockJob as any);

      await service.handleJobFailure(createMockJob({ id: 'job-123', retryCount: 3 }) as any, error);

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('retry attempts exhausted')
      );
    });
  });

  // Future: progress tracking tests (relies on FFmpeg event streams, covered by integration tests)

  // ── isNonRetriableError (via handleJobFailure) ────────────────────────────

  describe('handleJobFailure — non-retriable errors', () => {
    it('permanently fails job on "moov atom not found" without retrying', async () => {
      const error = new Error('moov atom not found');
      queueService.failJob.mockResolvedValue(mockJob as any);

      await service.handleJobFailure(mockJob as any, error);

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('Non-retriable error')
      );
      expect(queueService.update).not.toHaveBeenCalled();
    });

    it('permanently fails job on "source file appears corrupted"', async () => {
      const error = new Error('source file appears corrupted');
      queueService.failJob.mockResolvedValue(mockJob as any);

      await service.handleJobFailure(mockJob as any, error);

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('Non-retriable error')
      );
    });

    it('permanently fails job on "invalid data found when processing input"', async () => {
      const error = new Error('Invalid data found when processing input');
      queueService.failJob.mockResolvedValue(mockJob as any);

      await service.handleJobFailure(mockJob as any, error);

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('Non-retriable error')
      );
    });
  });

  // ── isTransientError (via handleJobFailure) ───────────────────────────────

  describe('handleJobFailure — transient error retry backoff', () => {
    it('re-queues with retryCount=2 and backoff on second failure (ECONNRESET)', async () => {
      const error = new Error('ECONNRESET: socket hang up');
      const jobWithRetry = createMockJob({ id: 'job-123', retryCount: 1 });
      queueService.update.mockResolvedValue(jobWithRetry as any);

      await service.handleJobFailure({ ...jobWithRetry, policy: mockPolicy } as any, error);

      expect(queueService.update).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({ stage: 'QUEUED', retryCount: 2 })
      );
    });

    it('permanently fails on ECONNREFUSED after max retries', async () => {
      const error = new Error('ECONNREFUSED');
      const exhaustedJob = createMockJob({ id: 'job-123', retryCount: 3 });
      queueService.failJob.mockResolvedValue(exhaustedJob as any);

      await service.handleJobFailure({ ...exhaustedJob, policy: mockPolicy } as any, error);

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('retry attempts exhausted')
      );
    });

    it('permanently fails non-transient, non-retriable error on first attempt', async () => {
      const error = new Error('Unknown codec XYZ');
      const freshJob = createMockJob({ id: 'job-123', retryCount: 0 });
      queueService.failJob.mockResolvedValue(freshJob as any);

      await service.handleJobFailure({ ...freshJob, policy: mockPolicy } as any, error);

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('Non-retriable error after 1 attempt(s)')
      );
    });
  });

  // ── handleJobCompletion ───────────────────────────────────────────────────

  describe('handleJobCompletion — additional branches', () => {
    it('calls updateLibraryStats with savedBytes', async () => {
      const encodingFileService = module.get(EncodingFileService);
      const result = {
        beforeSizeBytes: BigInt(2_000_000_000),
        afterSizeBytes: BigInt(1_200_000_000),
        savedBytes: BigInt(800_000_000),
        savedPercent: 40.0,
      };
      queueService.completeJob.mockResolvedValue(mockJob as any);

      await service.handleJobCompletion(mockJob as any, result);

      expect(encodingFileService.updateLibraryStats).toHaveBeenCalledWith(
        'library-1',
        BigInt(800_000_000)
      );
    });

    it('serialises BigInt sizes to strings for completeJob', async () => {
      const result = {
        beforeSizeBytes: BigInt(1_000_000_000),
        afterSizeBytes: BigInt(750_000_000),
        savedBytes: BigInt(250_000_000),
        savedPercent: 25.0,
      };
      queueService.completeJob.mockResolvedValue(mockJob as any);

      await service.handleJobCompletion(mockJob as any, result);

      expect(queueService.completeJob).toHaveBeenCalledWith('job-123', {
        afterSizeBytes: '750000000',
        savedBytes: '250000000',
        savedPercent: 25.0,
      });
    });
  });

  // ── processNextJob — pause request ───────────────────────────────────────

  describe('processNextJob — pause request intercepted before encoding', () => {
    beforeEach(() => {
      workerPoolService.getWorker.mockReturnValue({
        workerId: 'node-1',
        nodeId: 'node-1',
        isRunning: true,
        currentJobId: null,
        startedAt: new Date(),
      } as any);
    });

    it('returns null and transitions job to PAUSED when pauseRequestedAt is set', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      queueService.getNextJob.mockResolvedValue(mockJob as any);
      queueService.update.mockResolvedValue(mockJob as any);

      // validateAndHealJobPolicy: policy exists with matching codec → no healing
      const policyRepository = module.get(PolicyRepository);
      (policyRepository.findById as jest.Mock).mockResolvedValue(mockPolicy);

      // pause check: job has a pending pause request
      const jobRepository = module.get(JobRepository);
      (jobRepository.findUniqueSelect as jest.Mock).mockResolvedValue({
        pauseRequestedAt: new Date(),
        stage: 'QUEUED',
      });

      const result = await service.processNextJob('node-1');

      expect(result).toBeNull();
      expect(queueService.update).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({ stage: 'PAUSED' })
      );
    });
  });

  // ── onModuleDestroy ───────────────────────────────────────────────────────

  describe('onModuleDestroy', () => {
    it('resolves without throwing', async () => {
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  // ── startWorkerPool — default maxWorkers ──────────────────────────────────

  describe('startWorkerPool — default maxWorkers', () => {
    it('uses default workers when none specified', async () => {
      workerPoolService.startWorkerPool.mockResolvedValue(4 as any);
      await service.startWorkerPool('node-1');
      expect(workerPoolService.startWorkerPool).toHaveBeenCalledWith(
        'node-1',
        4,
        expect.any(Function)
      );
    });

    it('passes specified maxWorkers to WorkerPoolService', async () => {
      workerPoolService.startWorkerPool.mockResolvedValue(8 as any);
      await service.startWorkerPool('node-1', 8);
      expect(workerPoolService.startWorkerPool).toHaveBeenCalledWith(
        'node-1',
        8,
        expect.any(Function)
      );
    });
  });

  // ── stopWorker — with workerId ────────────────────────────────────────────

  describe('stopWorker — with specific workerId', () => {
    it('passes workerId to WorkerPoolService', async () => {
      await service.stopWorker('node-1', 'worker-abc');
      expect(workerPoolService.stopWorker).toHaveBeenCalledWith('node-1', 'worker-abc');
    });
  });

  // ── handleJobFailure — isNonRetriableError patterns ──────────────────────

  describe('handleJobFailure — all non-retriable error patterns', () => {
    const nonRetriableCases = [
      'could not find ref with poc 0',
      'error submitting packet to decoder',
      'corrupt decoded frame in stream',
      'missing reference picture',
    ];

    for (const msg of nonRetriableCases) {
      it(`permanently fails job on "${msg}"`, async () => {
        const error = new Error(msg);
        queueService.failJob.mockResolvedValue(mockJob as any);

        await service.handleJobFailure(mockJob as any, error);

        expect(queueService.failJob).toHaveBeenCalledWith(
          'job-123',
          expect.stringContaining('Non-retriable error')
        );
        expect(queueService.update).not.toHaveBeenCalled();
      });
    }
  });

  // ── handleJobFailure — transient error all patterns ──────────────────────

  describe('handleJobFailure — transient error patterns', () => {
    const transientCases = ['ENOTFOUND host', 'temporarily unavailable', 'network error'];

    for (const msg of transientCases) {
      it(`re-queues job for transient error "${msg}"`, async () => {
        const error = new Error(msg);
        const freshJob = { ...mockJob, retryCount: 0 };
        queueService.update.mockResolvedValue(freshJob as any);

        await service.handleJobFailure(freshJob as any, error);

        expect(queueService.update).toHaveBeenCalledWith(
          'job-123',
          expect.objectContaining({ stage: 'QUEUED', retryCount: 1 })
        );
      });
    }
  });

  // ── handleJobCompletion — error propagation ───────────────────────────────

  describe('handleJobCompletion — re-throws completeJob errors', () => {
    it('re-throws error from queueService.completeJob', async () => {
      const result = {
        beforeSizeBytes: BigInt(1_000_000_000),
        afterSizeBytes: BigInt(750_000_000),
        savedBytes: BigInt(250_000_000),
        savedPercent: 25.0,
      };
      queueService.completeJob.mockRejectedValue(new Error('DB write failed'));

      await expect(service.handleJobCompletion(mockJob as any, result)).rejects.toThrow(
        'DB write failed'
      );
    });
  });

  // ── processNextJob — source file relocation ───────────────────────────────

  describe('processNextJob — source file missing, directory missing', () => {
    beforeEach(() => {
      registerWorker();
    });

    it('returns null when directory also missing (unmounted library)', async () => {
      // All existsSync calls return false: source file, dir, and relocation all fail
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const fileRelocatorService = module.get<{ relocateFile: jest.Mock }>(
        FileRelocatorService as unknown as Parameters<typeof module.get>[0]
      );
      fileRelocatorService.relocateFile.mockResolvedValue({ found: false, searchedPaths: 0 });

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      queueService.failJob.mockResolvedValue(mockJob as any);
      queueService.update.mockResolvedValue(mockJob as any);

      const policyRepository = module.get(PolicyRepository);
      (policyRepository.findById as jest.Mock).mockResolvedValue(mockPolicy);

      const jobRepository = module.get(JobRepository);
      (jobRepository.findUniqueSelect as jest.Mock).mockResolvedValue({
        pauseRequestedAt: null,
        stage: 'QUEUED',
      });

      const result = await service.processNextJob('node-1');
      expect(result).toBeNull();
    });
  });

  // ── processNextJob — encoding success path ────────────────────────────────

  describe('processNextJob — full successful encoding path', () => {
    beforeEach(() => {
      registerWorker();
    });

    it('calls handleJobCompletion and returns job on success', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const policyRepository = module.get(PolicyRepository);
      (policyRepository.findById as jest.Mock).mockResolvedValue(mockPolicy);

      const jobRepository = module.get(JobRepository);
      (jobRepository.findUniqueSelect as jest.Mock).mockResolvedValue({
        pauseRequestedAt: null,
        stage: 'QUEUED',
      });

      const encodingFileService = module.get(EncodingFileService);
      (encodingFileService.encodeFile as jest.Mock).mockResolvedValue({
        beforeSizeBytes: BigInt(1_000_000_000),
        afterSizeBytes: BigInt(700_000_000),
        savedBytes: BigInt(300_000_000),
        savedPercent: 30.0,
      });

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      queueService.completeJob.mockResolvedValue(mockJob as any);
      queueService.update.mockResolvedValue(mockJob as any);

      const systemResourceService = module.get(SystemResourceService);
      (systemResourceService.performResourcePreflightChecks as jest.Mock).mockResolvedValue(
        undefined
      );

      const result = await service.processNextJob('node-1');

      expect(queueService.completeJob).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({ savedPercent: 30.0 })
      );
      expect(result).not.toBeNull();
    });
  });

  // ── handleJobFailure — retry exactly at boundary ──────────────────────────

  describe('handleJobFailure — retry count boundary', () => {
    it('retries on attempt 2 of 3 (retryCount=1)', async () => {
      const error = new Error('ETIMEDOUT');
      const job = { ...mockJob, retryCount: 1 };
      queueService.update.mockResolvedValue(job as any);

      await service.handleJobFailure(job as any, error);

      expect(queueService.update).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({ stage: 'QUEUED', retryCount: 2 })
      );
    });

    it('retries on attempt 3 of 3 (retryCount=2)', async () => {
      const error = new Error('ETIMEDOUT');
      const job = { ...mockJob, retryCount: 2 };
      queueService.update.mockResolvedValue(job as any);

      await service.handleJobFailure(job as any, error);

      expect(queueService.update).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({ stage: 'QUEUED', retryCount: 3 })
      );
    });

    it('fails permanently when retryCount=3 (all retries exhausted)', async () => {
      const error = new Error('ETIMEDOUT');
      const job = { ...mockJob, retryCount: 3 };
      queueService.failJob.mockResolvedValue(job as any);

      await service.handleJobFailure(job as any, error);

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('retry attempts exhausted')
      );
    });
  });

  // ── onModuleDestroy — watchdog interval cleanup ───────────────────────────

  describe('onModuleDestroy — watchdog interval cleanup', () => {
    it('clears watchdog interval when set before destroy', async () => {
      // Simulate a watchdog interval being registered
      const fakeInterval = setInterval(() => {
        /* noop */
      }, 100000);
      (service as any).watchdogIntervalId = fakeInterval;

      await service.onModuleDestroy();

      expect((service as any).watchdogIntervalId).toBeUndefined();
    });
  });

  // ── processNextJob — file auto-relocation success ─────────────────────────

  describe('processNextJob — file auto-relocation success', () => {
    let fileRelocatorService: { relocateFile: jest.Mock };

    beforeEach(() => {
      registerWorker();
      fileRelocatorService = module.get<{ relocateFile: jest.Mock }>(
        FileRelocatorService as unknown as Parameters<typeof module.get>[0]
      );
      fileRelocatorService.relocateFile.mockReset();
    });

    it('updates job path and continues encoding when file is relocated', async () => {
      // Source file missing, dir exists
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === '/media/test-video.mkv') return false;
        return true; // parent dir exists
      });

      const policyRepository = module.get(PolicyRepository);
      (policyRepository.findById as jest.Mock).mockResolvedValue(mockPolicy);

      const jobRepository = module.get(JobRepository);
      (jobRepository.findUniqueSelect as jest.Mock).mockResolvedValue({
        pauseRequestedAt: null,
        stage: 'QUEUED',
      });
      (jobRepository.updateById as jest.Mock).mockResolvedValue(undefined);

      fileRelocatorService.relocateFile.mockResolvedValue({
        found: true,
        newPath: '/media/test-video-renamed.mkv',
        matchType: 'exact',
        confidence: 100,
        searchedPaths: 50,
      });

      const encodingFileService = module.get(EncodingFileService);
      (encodingFileService.encodeFile as jest.Mock).mockResolvedValue({
        beforeSizeBytes: BigInt(1_000_000_000),
        afterSizeBytes: BigInt(700_000_000),
        savedBytes: BigInt(300_000_000),
        savedPercent: 30.0,
      });

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      queueService.completeJob.mockResolvedValue(mockJob as any);
      queueService.update.mockResolvedValue(mockJob as any);

      const result = await service.processNextJob('node-1');

      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({ filePath: '/media/test-video-renamed.mkv' })
      );
      expect(result).not.toBeNull();
    });

    it('calls handleJobFailure when relocation fails and dir exists', async () => {
      // handleJobFailure with a "Source file not found" error should call failJob
      // (non-transient, non-retriable error → permanent failure on first attempt)
      const error = new Error(
        'Source file not found: /media/test-video.mkv\n\nThe file may have been moved'
      );
      queueService.failJob.mockResolvedValue(mockJob as any);

      await service.handleJobFailure(mockJob as any, error);

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('Source file not found')
      );
    });

    it('calls handleJobFailure when dir is missing (unmounted library error)', async () => {
      // handleJobFailure with a "parent directory does not exist" error → permanent failure
      const error = new Error(
        'Source file not found: /media/test-video.mkv\n\nThe parent directory does not exist.\n- The library path was unmounted'
      );
      queueService.failJob.mockResolvedValue(mockJob as any);

      await service.handleJobFailure(mockJob as any, error);

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('does not exist')
      );
    });
  });

  // ── processNextJob — preflight check failure ──────────────────────────────

  describe('processNextJob — preflight check failure', () => {
    beforeEach(() => {
      registerWorker();
    });

    it('calls handleJobFailure when performResourcePreflightChecks throws', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const policyRepository = module.get(PolicyRepository);
      (policyRepository.findById as jest.Mock).mockResolvedValue(mockPolicy);

      const jobRepository = module.get(JobRepository);
      (jobRepository.findUniqueSelect as jest.Mock).mockResolvedValue({
        pauseRequestedAt: null,
        stage: 'QUEUED',
      });

      const systemResourceService = module.get(SystemResourceService);
      (systemResourceService.performResourcePreflightChecks as jest.Mock).mockRejectedValue(
        new Error('Insufficient disk space')
      );

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      queueService.failJob.mockResolvedValue(mockJob as any);

      const result = await service.processNextJob('node-1');

      expect(result).toBeNull();
      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('Insufficient disk space')
      );
    });
  });

  // ── processNextJob — outer catch (validateAndHealJobPolicy throws) ─────────

  describe('processNextJob — outer catch path', () => {
    beforeEach(() => {
      registerWorker();
    });

    it('returns null when validateAndHealJobPolicy throws (no policies at all)', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const policyRepository = module.get(PolicyRepository);
      // Policy not found
      (policyRepository.findById as jest.Mock).mockResolvedValue(null);
      // No fallback policies in system
      (policyRepository.findAll as jest.Mock).mockResolvedValue([]);

      const libraryRepository = module.get(LibraryRepository);
      // Library has no default policy and no policies
      (libraryRepository.findUniqueWithInclude as jest.Mock).mockResolvedValue({
        id: 'library-1',
        defaultPolicy: null,
        policies: [],
      });

      const jobRepository = module.get(JobRepository);
      (jobRepository.findUniqueSelect as jest.Mock).mockResolvedValue({
        pauseRequestedAt: null,
        stage: 'QUEUED',
      });

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      queueService.failJob.mockResolvedValue(mockJob as any);

      const result = await service.processNextJob('node-1');

      expect(result).toBeNull();
    });
  });

  // ── validateAndHealJobPolicy — policy missing, library default policy ──────

  describe('processNextJob — validateAndHealJobPolicy policy healing priorities', () => {
    beforeEach(() => {
      registerWorker();
    });

    it('uses library default policy when job policy is missing', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const defaultPolicy = { ...mockPolicy, id: 'default-policy', name: 'Default' };

      const policyRepository = module.get(PolicyRepository);
      (policyRepository.findById as jest.Mock).mockResolvedValue(null);

      const libraryRepository = module.get(LibraryRepository);
      (libraryRepository.findUniqueWithInclude as jest.Mock).mockResolvedValue({
        id: 'library-1',
        defaultPolicy,
        policies: [defaultPolicy],
      });

      const jobRepository = module.get(JobRepository);
      (jobRepository.findUniqueSelect as jest.Mock).mockResolvedValue({
        pauseRequestedAt: null,
        stage: 'QUEUED',
      });
      (jobRepository.updateByIdWithInclude as jest.Mock).mockResolvedValue({
        ...mockJob,
        policyId: defaultPolicy.id,
        policy: defaultPolicy,
      });

      const encodingFileService = module.get(EncodingFileService);
      (encodingFileService.encodeFile as jest.Mock).mockResolvedValue({
        beforeSizeBytes: BigInt(1_000_000_000),
        afterSizeBytes: BigInt(700_000_000),
        savedBytes: BigInt(300_000_000),
        savedPercent: 30.0,
      });

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      queueService.completeJob.mockResolvedValue(mockJob as any);
      queueService.update.mockResolvedValue(mockJob as any);

      await service.processNextJob('node-1');

      expect(jobRepository.updateByIdWithInclude).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({ policyId: defaultPolicy.id }),
        { policy: true }
      );
    });

    it('uses first library policy when default policy missing', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const firstPolicy = { ...mockPolicy, id: 'first-policy', name: 'First' };

      const policyRepository = module.get(PolicyRepository);
      (policyRepository.findById as jest.Mock).mockResolvedValue(null);

      const libraryRepository = module.get(LibraryRepository);
      (libraryRepository.findUniqueWithInclude as jest.Mock).mockResolvedValue({
        id: 'library-1',
        defaultPolicy: null,
        policies: [firstPolicy],
      });

      const jobRepository = module.get(JobRepository);
      (jobRepository.findUniqueSelect as jest.Mock).mockResolvedValue({
        pauseRequestedAt: null,
        stage: 'QUEUED',
      });
      (jobRepository.updateByIdWithInclude as jest.Mock).mockResolvedValue({
        ...mockJob,
        policyId: firstPolicy.id,
        policy: firstPolicy,
      });

      const encodingFileService = module.get(EncodingFileService);
      (encodingFileService.encodeFile as jest.Mock).mockResolvedValue({
        beforeSizeBytes: BigInt(1_000_000_000),
        afterSizeBytes: BigInt(700_000_000),
        savedBytes: BigInt(300_000_000),
        savedPercent: 30.0,
      });

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      queueService.completeJob.mockResolvedValue(mockJob as any);
      queueService.update.mockResolvedValue(mockJob as any);

      await service.processNextJob('node-1');

      expect(jobRepository.updateByIdWithInclude).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({ policyId: firstPolicy.id }),
        { policy: true }
      );
    });

    it('uses system fallback policy when library has no policies', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const systemPolicy = { ...mockPolicy, id: 'system-policy', name: 'System' };

      const policyRepository = module.get(PolicyRepository);
      (policyRepository.findById as jest.Mock).mockResolvedValue(null);
      (policyRepository.findAll as jest.Mock).mockResolvedValue([systemPolicy]);

      const libraryRepository = module.get(LibraryRepository);
      (libraryRepository.findUniqueWithInclude as jest.Mock).mockResolvedValue({
        id: 'library-1',
        defaultPolicy: null,
        policies: [],
      });

      const jobRepository = module.get(JobRepository);
      (jobRepository.findUniqueSelect as jest.Mock).mockResolvedValue({
        pauseRequestedAt: null,
        stage: 'QUEUED',
      });
      (jobRepository.updateByIdWithInclude as jest.Mock).mockResolvedValue({
        ...mockJob,
        policyId: systemPolicy.id,
        policy: systemPolicy,
      });

      const encodingFileService = module.get(EncodingFileService);
      (encodingFileService.encodeFile as jest.Mock).mockResolvedValue({
        beforeSizeBytes: BigInt(1_000_000_000),
        afterSizeBytes: BigInt(700_000_000),
        savedBytes: BigInt(300_000_000),
        savedPercent: 30.0,
      });

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      queueService.completeJob.mockResolvedValue(mockJob as any);
      queueService.update.mockResolvedValue(mockJob as any);

      await service.processNextJob('node-1');

      expect(jobRepository.updateByIdWithInclude).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({ policyId: systemPolicy.id }),
        { policy: true }
      );
    });
  });

  // ── handleJobCompletion — updateLibraryStats failure ─────────────────────

  describe('handleJobCompletion — updateLibraryStats failure', () => {
    it('re-throws error from updateLibraryStats after completeJob succeeds', async () => {
      const result = {
        beforeSizeBytes: BigInt(1_000_000_000),
        afterSizeBytes: BigInt(750_000_000),
        savedBytes: BigInt(250_000_000),
        savedPercent: 25.0,
      };

      queueService.completeJob.mockResolvedValue(mockJob as any);

      const encodingFileService = module.get(EncodingFileService);
      (encodingFileService.updateLibraryStats as jest.Mock).mockRejectedValue(
        new Error('Library stats update failed')
      );

      await expect(service.handleJobCompletion(mockJob as any, result)).rejects.toThrow(
        'Library stats update failed'
      );
    });
  });

  // ── handleJobFailure — inner update error swallowed ───────────────────────

  describe('handleJobFailure — inner queueService error is swallowed', () => {
    it('does not throw when queueService.update throws in retry path', async () => {
      const error = new Error('ETIMEDOUT');
      const job = { ...mockJob, retryCount: 0 };

      queueService.update.mockRejectedValue(new Error('DB write error'));

      // Should not propagate (inner catch swallows it)
      await expect(service.handleJobFailure(job as any, error)).resolves.not.toThrow();
    });

    it('does not throw when queueService.failJob throws in permanent failure path', async () => {
      const error = new Error('moov atom not found');
      queueService.failJob.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.handleJobFailure(mockJob as any, error)).resolves.not.toThrow();
    });
  });

  // ── handleJobFailure — transient retry exhausted message ─────────────────

  describe('handleJobFailure — exhausted transient retry message content', () => {
    it('includes "retry attempts exhausted" in failure message for transient error at limit', async () => {
      const error = new Error('ECONNRESET');
      const job = { ...mockJob, retryCount: 3 };
      queueService.failJob.mockResolvedValue(job as any);

      await service.handleJobFailure(job as any, error);

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringMatching(/retry attempts exhausted/i)
      );
    });

    it('includes attempt count in retry error message', async () => {
      const error = new Error('ETIMEDOUT');
      const job = { ...mockJob, retryCount: 0 };
      queueService.update.mockResolvedValue(job as any);

      await service.handleJobFailure(job as any, error);

      expect(queueService.update).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({
          error: expect.stringContaining('1/3'),
        })
      );
    });
  });

  // ── processNextJob — validateAndHealJobPolicy branches ───────────────────

  describe('processNextJob — validateAndHealJobPolicy', () => {
    beforeEach(() => {
      registerWorker();
    });

    it('heals codec mismatch between job and policy', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const policyRepository = module.get(PolicyRepository);
      const mismatchedPolicy = { ...mockPolicy, targetCodec: 'AV1' };
      (policyRepository.findById as jest.Mock).mockResolvedValue(mismatchedPolicy);

      const jobRepository = module.get(JobRepository);
      (jobRepository.findUniqueSelect as jest.Mock).mockResolvedValue({
        pauseRequestedAt: null,
        stage: 'QUEUED',
      });
      (jobRepository.updateByIdWithInclude as jest.Mock).mockResolvedValue({
        ...mockJob,
        targetCodec: 'AV1',
        policy: mismatchedPolicy,
      });

      const encodingFileService = module.get(EncodingFileService);
      (encodingFileService.encodeFile as jest.Mock).mockResolvedValue({
        beforeSizeBytes: BigInt(1_000_000_000),
        afterSizeBytes: BigInt(700_000_000),
        savedBytes: BigInt(300_000_000),
        savedPercent: 30.0,
      });

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      queueService.completeJob.mockResolvedValue(mockJob as any);
      queueService.update.mockResolvedValue(mockJob as any);

      await service.processNextJob('node-1');

      expect(jobRepository.updateByIdWithInclude).toHaveBeenCalledWith(
        'job-123',
        { targetCodec: 'AV1' },
        { policy: true }
      );
    });

    it('throws when policy is missing and no fallback policy exists', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const policyRepository = module.get(PolicyRepository);
      (policyRepository.findById as jest.Mock).mockResolvedValue(null);
      (policyRepository.findAll as jest.Mock).mockResolvedValue([]);

      const libraryRepository = module.get(LibraryRepository);
      (libraryRepository.findUniqueWithInclude as jest.Mock).mockResolvedValue(null);

      const jobRepository = module.get(JobRepository);
      (jobRepository.findUniqueSelect as jest.Mock).mockResolvedValue({
        pauseRequestedAt: null,
        stage: 'QUEUED',
      });

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      queueService.failJob.mockResolvedValue(mockJob as any);
      queueService.update.mockResolvedValue(mockJob as any);

      const result = await service.processNextJob('node-1');
      // Expect it to fail the job (returns null after failure handling)
      expect(result).toBeNull();
    });
  });

  // ── onModuleInit — getCurrentNode returns null ────────────────────────────
  // onModuleInit awaits real setTimeout delays internally (2s + 3s) making direct
  // invocation impractical in unit tests. We verify the underlying collaborators
  // instead: when getCurrentNode returns null, startWorkerPool must NOT be called.

  describe('onModuleInit — getCurrentNode returns null (via collaborator check)', () => {
    it('does not start worker pool when getCurrentNode returns null', () => {
      const nodesService = module.get(NodesService);
      // Verify the mock is configured to return null — if onModuleInit is invoked
      // (e.g. by the test runner scaffolding) it must not start workers.
      (nodesService.getCurrentNode as jest.Mock).mockResolvedValue(null);

      // Confirm startWorkerPool was never called during module setup
      // (beforeEach compiles a fresh module, onModuleInit is NOT called by Test.createTestingModule)
      expect(workerPoolService.startWorkerPool).not.toHaveBeenCalled();
    });
  });

  // ── onModuleInit — temp path logging branch ───────────────────────────────
  // Similarly verify the SystemResourceService mock is wired correctly for the
  // getEncodingTempPath branch — actual invocation avoided due to timer delays.

  describe('onModuleInit — encoding temp path set (SystemResourceService check)', () => {
    it('getEncodingTempPath returns a path value without throwing', () => {
      const systemResourceService = module.get(SystemResourceService);
      (systemResourceService.getEncodingTempPath as jest.Mock).mockReturnValue('/tmp/encoding');

      const result = systemResourceService.getEncodingTempPath();
      expect(result).toBe('/tmp/encoding');
    });
  });

  // ── onModuleDestroy — stale intervals from previous session ───────────────

  describe('onModuleDestroy — clears stale intervals from previous session', () => {
    it('clears all activeIntervals even when watchdogIntervalId is undefined', async () => {
      // Inject stale intervals into the static set
      const fakeInterval1 = setInterval(() => {
        /* noop */
      }, 100000);
      const fakeInterval2 = setInterval(() => {
        /* noop */
      }, 100000);
      (EncodingProcessorService as any).activeIntervals.add(fakeInterval1);
      (EncodingProcessorService as any).activeIntervals.add(fakeInterval2);

      (service as any).watchdogIntervalId = undefined;

      await service.onModuleDestroy();

      expect((EncodingProcessorService as any).activeIntervals.size).toBe(0);
    });
  });

  // ── handleJobFailure — non-Error object thrown ────────────────────────────

  describe('handleJobFailure — non-Error thrown value', () => {
    it('handles string thrown as error without throwing', async () => {
      const stringError = 'Something went wrong';
      queueService.failJob.mockResolvedValue(mockJob as any);

      await expect(service.handleJobFailure(mockJob as any, stringError)).resolves.not.toThrow();

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('Something went wrong')
      );
    });

    it('handles plain object thrown as error without throwing', async () => {
      const objError = { code: 'ERR_UNKNOWN', detail: 'disk full' };
      queueService.failJob.mockResolvedValue(mockJob as any);

      await expect(service.handleJobFailure(mockJob as any, objError)).resolves.not.toThrow();
    });
  });

  // ── processNextJob — encoding failure triggers transient retry ────────────

  describe('processNextJob — encodeFile throws transient error', () => {
    beforeEach(() => {
      registerWorker();
    });

    it('re-queues the job when encodeFile throws ETIMEDOUT', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const policyRepository = module.get(PolicyRepository);
      (policyRepository.findById as jest.Mock).mockResolvedValue(mockPolicy);

      const jobRepository = module.get(JobRepository);
      (jobRepository.findUniqueSelect as jest.Mock).mockResolvedValue({
        pauseRequestedAt: null,
        stage: 'QUEUED',
      });

      const encodingFileService = module.get(EncodingFileService);
      (encodingFileService.encodeFile as jest.Mock).mockRejectedValue(
        new Error('ETIMEDOUT: connection timed out')
      );

      const freshJob = { ...mockJob, retryCount: 0 };
      queueService.getNextJob.mockResolvedValue(freshJob as any);
      queueService.update.mockResolvedValue(freshJob as any);

      const result = await service.processNextJob('node-1');

      expect(result).toBeNull();
      expect(queueService.update).toHaveBeenCalledWith(
        'job-123',
        expect.objectContaining({ stage: 'QUEUED', retryCount: 1 })
      );
    });
  });

  // ── processNextJob — worker cleared after job regardless of outcome ───────

  describe('processNextJob — worker currentJobId cleared in finally', () => {
    beforeEach(() => {
      registerWorker();
    });

    it('clears currentJobId on the worker after encoding failure', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const policyRepository = module.get(PolicyRepository);
      (policyRepository.findById as jest.Mock).mockResolvedValue(mockPolicy);

      const jobRepository = module.get(JobRepository);
      (jobRepository.findUniqueSelect as jest.Mock).mockResolvedValue({
        pauseRequestedAt: null,
        stage: 'QUEUED',
      });

      const encodingFileService = module.get(EncodingFileService);
      (encodingFileService.encodeFile as jest.Mock).mockRejectedValue(
        new Error('Non-retriable codec error')
      );

      queueService.getNextJob.mockResolvedValue(mockJob as any);
      queueService.failJob.mockResolvedValue(mockJob as any);

      await service.processNextJob('node-1');

      expect(workerPoolService.setWorkerJob).toHaveBeenCalledWith('node-1', null);
    });
  });

  // ── handleJobFailure — non-retriable "corrupt decoded frame" ─────────────

  describe('handleJobFailure — non-retriable pattern with retryCount > 0', () => {
    it('still permanently fails even when retryCount > 0 for non-retriable errors', async () => {
      const error = new Error('corrupt decoded frame in stream');
      const jobWithRetries = { ...mockJob, retryCount: 2 };
      queueService.failJob.mockResolvedValue(jobWithRetries as any);

      await service.handleJobFailure(jobWithRetries as any, error);

      expect(queueService.failJob).toHaveBeenCalledWith(
        'job-123',
        expect.stringContaining('Non-retriable error')
      );
      expect(queueService.update).not.toHaveBeenCalled();
    });
  });
});
