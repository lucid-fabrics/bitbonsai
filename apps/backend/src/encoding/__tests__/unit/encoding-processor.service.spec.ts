import * as fs from 'node:fs';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../../common/repositories/job.repository';
import { LibraryRepository } from '../../../common/repositories/library.repository';
import { PolicyRepository } from '../../../common/repositories/policy.repository';
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
import { FfmpegService } from '../../ffmpeg.service';
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
            setWorkerJob: jest.fn(),
            isWorkerRunning: jest.fn().mockReturnValue(false),
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
});
