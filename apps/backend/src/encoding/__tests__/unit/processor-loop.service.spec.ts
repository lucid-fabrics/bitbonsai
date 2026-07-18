import * as fs from 'node:fs';
import * as path from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../../common/repositories/job.repository';
import { FileRelocatorService } from '../../../core/services/file-relocator.service';
import { QueueService } from '../../../queue/queue.service';
import { CircuitBreakerService } from '../../../queue/services/circuit-breaker.service';
import { OwnershipLeaseService } from '../../../queue/services/ownership-lease.service';
import { EncodingFileService } from '../../encoding-file.service';
import { EncodingValidatorService } from '../../encoding-validator.service';
import { ProcessorLoopService } from '../../processor-loop.service';
import { InsufficientDiskSpaceError, SystemResourceService } from '../../system-resource.service';
import { WorkerPoolService } from '../../worker-pool.service';

jest.mock('node:fs');

const mockFs = fs as jest.Mocked<typeof fs>;

const makeWorker = (overrides: Record<string, unknown> = {}) => ({
  id: 'worker-1',
  nodeId: 'node-1',
  isRunning: true,
  currentJobId: null,
  startTime: new Date(),
  ...overrides,
});

const makeJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  filePath: '/mnt/media/movie.mkv',
  fileLabel: 'movie.mkv',
  beforeSizeBytes: BigInt(1000000),
  targetCodec: 'HEVC',
  stage: JobStage.ENCODING,
  policy: { id: 'policy-1', targetCodec: 'HEVC', targetQuality: 28 },
  ...overrides,
});

describe('ProcessorLoopService', () => {
  let service: ProcessorLoopService;
  let jobRepository: jest.Mocked<JobRepository>;
  let queueService: jest.Mocked<QueueService>;
  let workerPoolService: jest.Mocked<WorkerPoolService>;
  let systemResourceService: jest.Mocked<SystemResourceService>;
  let encodingFileService: jest.Mocked<EncodingFileService>;
  let fileRelocatorService: jest.Mocked<FileRelocatorService>;
  let encodingValidator: jest.Mocked<EncodingValidatorService>;
  let ownershipLease: jest.Mocked<OwnershipLeaseService>;
  let circuitBreaker: jest.Mocked<CircuitBreakerService>;

  beforeEach(async () => {
    jobRepository = {
      atomicUpdateMany: jest.fn().mockResolvedValue(undefined),
      findUniqueSelect: jest
        .fn()
        .mockResolvedValue({ pauseRequestedAt: null, stage: JobStage.ENCODING }),
      updateById: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<JobRepository>;

    queueService = {
      getNextJob: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<QueueService>;

    workerPoolService = {
      getWorker: jest.fn(),
      setWorkerJob: jest.fn(),
      removeWorker: jest.fn(),
      resolveShutdown: jest.fn(),
    } as unknown as jest.Mocked<WorkerPoolService>;

    systemResourceService = {
      waitForSystemLoad: jest.fn().mockResolvedValue(undefined),
      performResourcePreflightChecks: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SystemResourceService>;

    encodingFileService = {
      encodeFile: jest.fn().mockResolvedValue({ savedPercent: 30 }),
    } as unknown as jest.Mocked<EncodingFileService>;

    fileRelocatorService = {
      relocateFile: jest.fn().mockResolvedValue({ found: false, searchedPaths: 0 }),
    } as unknown as jest.Mocked<FileRelocatorService>;

    encodingValidator = {
      validateAndHealJobPolicy: jest.fn().mockImplementation((job) => Promise.resolve(job)),
      handleJobCompletion: jest.fn().mockResolvedValue(undefined),
      handleJobFailure: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EncodingValidatorService>;

    ownershipLease = {
      startRenewing: jest.fn(),
      stopRenewing: jest.fn(),
    } as unknown as jest.Mocked<OwnershipLeaseService>;

    circuitBreaker = {
      checkAndBreak: jest.fn().mockResolvedValue(false),
      isCircuitBroken: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<CircuitBreakerService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcessorLoopService,
        { provide: JobRepository, useValue: jobRepository },
        { provide: QueueService, useValue: queueService },
        { provide: WorkerPoolService, useValue: workerPoolService },
        { provide: SystemResourceService, useValue: systemResourceService },
        { provide: EncodingFileService, useValue: encodingFileService },
        { provide: FileRelocatorService, useValue: fileRelocatorService },
        { provide: EncodingValidatorService, useValue: encodingValidator },
        { provide: OwnershipLeaseService, useValue: ownershipLease },
        { provide: CircuitBreakerService, useValue: circuitBreaker },
      ],
    }).compile();

    service = module.get(ProcessorLoopService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('processLoop', () => {
    it('returns immediately when worker not found', async () => {
      workerPoolService.getWorker.mockReturnValue(undefined);

      await service.processLoop('worker-1', 'node-1');

      expect(systemResourceService.waitForSystemLoad).not.toHaveBeenCalled();
    });

    it('cleans up worker in finally even when loop exits cleanly', async () => {
      const worker = makeWorker({ isRunning: false });
      workerPoolService.getWorker.mockReturnValue(worker as never);

      await service.processLoop('worker-1', 'node-1');

      expect(workerPoolService.removeWorker).toHaveBeenCalledWith('worker-1');
      expect(workerPoolService.resolveShutdown).toHaveBeenCalledWith('worker-1');
    });

    it('calls processNextJob and stops when isRunning becomes false', async () => {
      const worker = makeWorker({ isRunning: true });
      const job = makeJob();

      workerPoolService.getWorker.mockReturnValue(worker as never);
      queueService.getNextJob.mockResolvedValue(job as never);
      mockFs.existsSync.mockReturnValue(true);

      let callCount = 0;
      systemResourceService.waitForSystemLoad.mockImplementation(async () => {
        callCount++;
        if (callCount >= 2) worker.isRunning = false;
      });

      await service.processLoop('worker-1', 'node-1');

      expect(systemResourceService.waitForSystemLoad).toHaveBeenCalledTimes(2);
      expect(queueService.getNextJob).toHaveBeenCalledWith('node-1');
    });
  });

  describe('processNextJob', () => {
    it('returns null when worker not found', async () => {
      workerPoolService.getWorker.mockReturnValue(undefined);
      const result = await service.processNextJob('worker-1');
      expect(result).toBeNull();
    });

    it('returns null when no job available in queue', async () => {
      workerPoolService.getWorker.mockReturnValue(makeWorker() as never);
      queueService.getNextJob.mockResolvedValue(null);

      const result = await service.processNextJob('worker-1');

      expect(result).toBeNull();
      expect(queueService.getNextJob).toHaveBeenCalledWith('node-1');
    });

    it('encodes job and returns it on success', async () => {
      const job = makeJob();
      workerPoolService.getWorker.mockReturnValue(makeWorker() as never);
      queueService.getNextJob.mockResolvedValue(job as never);
      mockFs.existsSync.mockReturnValue(true);

      const result = await service.processNextJob('worker-1');

      expect(encodingFileService.encodeFile).toHaveBeenCalledWith(job);
      expect(encodingValidator.handleJobCompletion).toHaveBeenCalled();
      expect(result).toBe(job);
      expect(systemResourceService.performResourcePreflightChecks).toHaveBeenCalledWith(
        job.filePath,
        job.id,
        job.targetCodec,
        job.beforeSizeBytes
      );
    });

    it('validates and heals job policy before encoding', async () => {
      const job = makeJob();
      const healedJob = { ...job, policy: { ...job.policy, targetQuality: 24 } };
      workerPoolService.getWorker.mockReturnValue(makeWorker() as never);
      queueService.getNextJob.mockResolvedValue(job as never);
      encodingValidator.validateAndHealJobPolicy.mockResolvedValue(healedJob as never);
      mockFs.existsSync.mockReturnValue(true);

      await service.processNextJob('worker-1');

      expect(encodingValidator.validateAndHealJobPolicy).toHaveBeenCalledWith(job);
    });

    it('pauses job when pauseRequestedAt is set before encoding starts', async () => {
      const job = makeJob();
      workerPoolService.getWorker.mockReturnValue(makeWorker() as never);
      queueService.getNextJob.mockResolvedValue(job as never);
      jobRepository.findUniqueSelect.mockResolvedValue({
        pauseRequestedAt: new Date(),
        stage: JobStage.ENCODING,
      } as never);

      const result = await service.processNextJob('worker-1');

      expect(queueService.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ stage: JobStage.PAUSED })
      );
      expect(encodingFileService.encodeFile).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('attempts file relocation when source file not found', async () => {
      const job = makeJob();
      const newPath = '/mnt/media/renamed_movie.mkv';
      workerPoolService.getWorker.mockReturnValue(makeWorker() as never);
      queueService.getNextJob.mockResolvedValue(job as never);
      mockFs.existsSync.mockReturnValue(false);
      fileRelocatorService.relocateFile.mockResolvedValue({
        found: true,
        newPath,
        matchType: 'size',
        confidence: 95,
        searchedPaths: 10,
      } as never);

      const originalFilePath = job.filePath;
      await service.processNextJob('worker-1');

      expect(fileRelocatorService.relocateFile).toHaveBeenCalledWith(
        originalFilePath,
        job.beforeSizeBytes
      );
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ filePath: newPath, fileLabel: path.basename(newPath) })
      );
    });

    it('calls handleJobFailure when file not found and relocation fails', async () => {
      const job = makeJob();
      workerPoolService.getWorker.mockReturnValue(makeWorker() as never);
      queueService.getNextJob.mockResolvedValue(job as never);
      mockFs.existsSync.mockReturnValue(false);
      fileRelocatorService.relocateFile.mockResolvedValue({
        found: false,
        searchedPaths: 50,
      } as never);

      const result = await service.processNextJob('worker-1');

      expect(encodingValidator.handleJobFailure).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('starts and stops ownership lease around encoding', async () => {
      const job = makeJob();
      workerPoolService.getWorker.mockReturnValue(makeWorker() as never);
      queueService.getNextJob.mockResolvedValue(job as never);
      mockFs.existsSync.mockReturnValue(true);

      await service.processNextJob('worker-1');

      expect(ownershipLease.startRenewing).toHaveBeenCalledWith('job-1', 'node-1');
      expect(ownershipLease.stopRenewing).toHaveBeenCalledWith('job-1');
    });

    it('stops ownership lease even when encoding throws', async () => {
      const job = makeJob();
      workerPoolService.getWorker.mockReturnValue(makeWorker() as never);
      queueService.getNextJob.mockResolvedValue(job as never);
      mockFs.existsSync.mockReturnValue(true);
      encodingFileService.encodeFile.mockRejectedValue(new Error('encode failed'));

      await service.processNextJob('worker-1');

      expect(ownershipLease.stopRenewing).toHaveBeenCalledWith('job-1');
      expect(encodingValidator.handleJobFailure).toHaveBeenCalled();
    });

    it('defers (not fails) a job that hits InsufficientDiskSpaceError', async () => {
      const job = makeJob();
      workerPoolService.getWorker.mockReturnValue(makeWorker() as never);
      queueService.getNextJob.mockResolvedValue(job as never);
      mockFs.existsSync.mockReturnValue(true);
      systemResourceService.performResourcePreflightChecks.mockRejectedValue(
        new InsufficientDiskSpaceError('Insufficient disk space on /mnt/media', 2.5, 10)
      );
      circuitBreaker.checkAndBreak.mockResolvedValue(false);

      const result = await service.processNextJob('worker-1');

      expect(result).toBeNull();
      expect(encodingValidator.handleJobFailure).not.toHaveBeenCalled();
      expect(encodingFileService.encodeFile).not.toHaveBeenCalled();
      expect(circuitBreaker.checkAndBreak).toHaveBeenCalledWith(
        'job-1',
        expect.stringContaining('insufficient disk space')
      );
      expect(jobRepository.updateById).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          stage: JobStage.QUEUED,
          startedAt: null,
          nextRetryAt: expect.any(Date),
        })
      );
    });

    it('does not re-queue a job once the circuit breaker trips on repeated disk-space deferrals', async () => {
      const job = makeJob();
      workerPoolService.getWorker.mockReturnValue(makeWorker() as never);
      queueService.getNextJob.mockResolvedValue(job as never);
      mockFs.existsSync.mockReturnValue(true);
      systemResourceService.performResourcePreflightChecks.mockRejectedValue(
        new InsufficientDiskSpaceError('Insufficient disk space on /mnt/media', 2.5, 10)
      );
      // checkAndBreak already marked the job FAILED internally once tripped
      circuitBreaker.checkAndBreak.mockResolvedValue(true);

      const result = await service.processNextJob('worker-1');

      expect(result).toBeNull();
      expect(circuitBreaker.checkAndBreak).toHaveBeenCalledWith(
        'job-1',
        expect.stringContaining('insufficient disk space')
      );
      // deferJobForDiskSpace must not re-queue on top of the circuit breaker's own FAILED write
      expect(jobRepository.updateById).not.toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ stage: JobStage.QUEUED })
      );
    });

    it('sets and clears worker currentJobId', async () => {
      const job = makeJob();
      workerPoolService.getWorker.mockReturnValue(makeWorker() as never);
      queueService.getNextJob.mockResolvedValue(job as never);
      mockFs.existsSync.mockReturnValue(true);

      await service.processNextJob('worker-1');

      expect(workerPoolService.setWorkerJob).toHaveBeenCalledWith('worker-1', 'job-1');
      expect(workerPoolService.setWorkerJob).toHaveBeenLastCalledWith('worker-1', null);
    });
  });

  describe('handleJobCompletion', () => {
    it('delegates to EncodingValidatorService', async () => {
      const job = makeJob() as never;
      const result = { savedPercent: 25 } as never;

      await service.handleJobCompletion(job, result);

      expect(encodingValidator.handleJobCompletion).toHaveBeenCalledWith(job, result);
    });
  });

  describe('handleJobFailure', () => {
    it('delegates to EncodingValidatorService', async () => {
      const job = makeJob() as never;
      const error = new Error('encoding failed');

      await service.handleJobFailure(job, error);

      expect(encodingValidator.handleJobFailure).toHaveBeenCalledWith(job, error);
    });
  });
});
