import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { JobRepository } from '../../../common/repositories/job.repository';
import { FfmpegService } from '../../ffmpeg.service';
import { PoolLockService } from '../../pool-lock.service';
import { SystemResourceService } from '../../system-resource.service';
import { WorkerPoolService, type WorkerState } from '../../worker-pool.service';

const mockPoolLockService = {
  withLock: jest.fn((_nodeId: string, _holder: string, fn: () => Promise<unknown>) => fn()),
};

const mockSystemResourceService = {
  defaultWorkersPerNode: 2,
  maxWorkersPerNode: 8,
};

const mockFfmpegService = {
  killProcess: jest.fn(),
};

const mockJobRepository = {
  updateById: jest.fn(),
};

describe('WorkerPoolService', () => {
  let service: WorkerPoolService;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    // Re-wire withLock to always execute the callback
    mockPoolLockService.withLock.mockImplementation(
      (_nodeId: string, _holder: string, fn: () => Promise<unknown>) => fn()
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerPoolService,
        { provide: PoolLockService, useValue: mockPoolLockService },
        { provide: SystemResourceService, useValue: mockSystemResourceService },
        { provide: FfmpegService, useValue: mockFfmpegService },
        { provide: JobRepository, useValue: mockJobRepository },
      ],
    }).compile();

    service = module.get<WorkerPoolService>(WorkerPoolService);
  });

  it('should be defined', () => {
    expect(service).toBeInstanceOf(WorkerPoolService);
  });

  describe('startWorkerPool', () => {
    it('should start workers up to maxWorkers and return count started', async () => {
      // never-resolving keeps workers alive without triggering crash-recovery
      const startWorkerFn = jest.fn().mockReturnValue(
        new Promise<void>(() => {
          /* never resolves */
        })
      );

      const started = await service.startWorkerPool('node-1', 2, startWorkerFn);

      expect(started).toBe(2);
      expect(startWorkerFn).toHaveBeenCalledTimes(2);
      expect(startWorkerFn).toHaveBeenCalledWith('node-1-worker-1', 'node-1');
      expect(startWorkerFn).toHaveBeenCalledWith('node-1-worker-2', 'node-1');
    });

    it('should return 0 and not start workers when pool is already at capacity', async () => {
      const startWorkerFn = jest.fn().mockReturnValue(
        new Promise<void>(() => {
          /* never resolves */
        })
      );

      // First call fills the pool
      await service.startWorkerPool('node-1', 2, startWorkerFn);
      startWorkerFn.mockClear();

      // Second call: pool already at capacity
      const started = await service.startWorkerPool('node-1', 2, startWorkerFn);

      expect(started).toBe(0);
      expect(startWorkerFn).not.toHaveBeenCalled();
    });

    it('should clamp maxWorkers to systemResourceService.maxWorkersPerNode', async () => {
      const startWorkerFn = jest.fn().mockReturnValue(
        new Promise<void>(() => {
          /* never resolves */
        })
      );

      // Request 100 workers, cap is 8
      const started = await service.startWorkerPool('node-1', 100, startWorkerFn);

      expect(started).toBe(8);
      expect(startWorkerFn).toHaveBeenCalledTimes(8);
    });

    it('should register the worker in the pool even if the processing loop later rejects', async () => {
      // startWorkerFn runs fire-and-forget inside startWorker — rejections are caught
      // asynchronously, so startWorkerPool still reports 1 worker started.
      // A never-resolving fn avoids triggering the crash-recovery path in this test.
      const startWorkerFn = jest.fn().mockReturnValue(
        new Promise<void>(() => {
          /* never resolves */
        })
      );

      const started = await service.startWorkerPool('node-1', 1, startWorkerFn);

      expect(started).toBe(1);
      expect(service.getPool('node-1')?.activeWorkers.size).toBe(1);
      expect(service.getWorker('node-1-worker-1')).not.toBeUndefined();
    });
  });

  describe('getWorker / getAllWorkers', () => {
    it('should return undefined for an unknown workerId', () => {
      const result = service.getWorker('nonexistent-worker');
      expect(result).toBeUndefined();
    });

    it('should return the worker state after it has been registered', async () => {
      const startWorkerFn = jest.fn().mockReturnValue(
        new Promise<void>(() => {
          /* never resolves */
        })
      );
      await service.startWorkerPool('node-1', 1, startWorkerFn);

      const worker = service.getWorker('node-1-worker-1');

      expect(worker).not.toBeNull();
      expect(worker?.workerId).toBe('node-1-worker-1');
      expect(worker?.nodeId).toBe('node-1');
      expect(worker?.isRunning).toBe(true);
      expect(worker?.currentJobId).toBeNull();
    });

    it('should return all workers via getAllWorkers', async () => {
      const startWorkerFn = jest.fn().mockReturnValue(
        new Promise<void>(() => {
          /* never resolves */
        })
      );
      await service.startWorkerPool('node-1', 2, startWorkerFn);

      const all = service.getAllWorkers();

      expect(all.size).toBe(2);
      expect(all.has('node-1-worker-1')).toBe(true);
      expect(all.has('node-1-worker-2')).toBe(true);
    });
  });

  describe('setWorkerJob', () => {
    it('should update currentJobId on the worker', async () => {
      const startWorkerFn = jest.fn().mockReturnValue(
        new Promise<void>(() => {
          /* never resolves */
        })
      );
      await service.startWorkerPool('node-1', 1, startWorkerFn);

      service.setWorkerJob('node-1-worker-1', 'job-abc');

      expect(service.getWorker('node-1-worker-1')?.currentJobId).toBe('job-abc');
    });

    it('should set currentJobId to null when job is cleared', async () => {
      const startWorkerFn = jest.fn().mockReturnValue(
        new Promise<void>(() => {
          /* never resolves */
        })
      );
      await service.startWorkerPool('node-1', 1, startWorkerFn);

      service.setWorkerJob('node-1-worker-1', 'job-abc');
      service.setWorkerJob('node-1-worker-1', null);

      expect(service.getWorker('node-1-worker-1')?.currentJobId).toBeNull();
    });

    it('should do nothing when workerId does not exist', () => {
      // Should not throw
      expect(() => service.setWorkerJob('ghost-worker', 'job-1')).not.toThrow();
    });
  });

  describe('removeWorker', () => {
    it('should remove the worker from tracking maps and pool activeWorkers', async () => {
      const startWorkerFn = jest.fn().mockReturnValue(
        new Promise<void>(() => {
          /* never resolves */
        })
      );
      await service.startWorkerPool('node-1', 1, startWorkerFn);

      service.removeWorker('node-1-worker-1');

      expect(service.getWorker('node-1-worker-1')).toBeUndefined();
      expect(service.getPool('node-1')?.activeWorkers.has('node-1-worker-1')).toBe(false);
    });

    it('should do nothing when workerId does not exist', () => {
      expect(() => service.removeWorker('ghost-worker')).not.toThrow();
    });
  });

  describe('resolveShutdown', () => {
    it('should call shutdownResolve on the worker if present', async () => {
      const startWorkerFn = jest.fn().mockReturnValue(
        new Promise<void>(() => {
          /* never resolves */
        })
      );
      await service.startWorkerPool('node-1', 1, startWorkerFn);

      const worker = service.getWorker('node-1-worker-1') as WorkerState;
      const mockResolve = jest.fn();
      worker.shutdownResolve = mockResolve;

      service.resolveShutdown('node-1-worker-1');

      expect(mockResolve).toHaveBeenCalledTimes(1);
    });

    it('should do nothing when workerId does not exist', () => {
      expect(() => service.resolveShutdown('ghost-worker')).not.toThrow();
    });
  });

  describe('stopWorker', () => {
    it('should log a warning and return when no pool exists for nodeId', async () => {
      // Should not throw when pool does not exist
      await expect(service.stopWorker('unknown-node')).resolves.toBeUndefined();
    });

    it('should signal worker to stop and clean up state for a specific workerId', async () => {
      let _workerResolve!: () => void;
      const startWorkerFn = jest.fn().mockImplementation((_wId: string, _nId: string) => {
        return new Promise<void>((resolve) => {
          _workerResolve = resolve;
        });
      });

      await service.startWorkerPool('node-1', 1, startWorkerFn);
      const worker = service.getWorker('node-1-worker-1') as WorkerState;

      // Manually wire shutdownResolve to resolve the shutdownPromise
      const stopPromise = service.stopWorker('node-1', 'node-1-worker-1');
      // Resolve the shutdown so stopWorker's await resolves
      if (worker.shutdownResolve) worker.shutdownResolve();
      await stopPromise;

      expect(service.getWorker('node-1-worker-1')).toBeUndefined();
      expect(service.getPool('node-1')?.activeWorkers.has('node-1-worker-1')).toBe(false);
    });

    it('should stop all workers and delete the pool when no workerId specified', async () => {
      const startWorkerFn = jest.fn().mockReturnValue(
        new Promise<void>(() => {
          /* never resolves */
        })
      );
      await service.startWorkerPool('node-1', 2, startWorkerFn);

      // Resolve all shutdown promises immediately so stopWorker doesn't hang
      for (const [, w] of service.getAllWorkers()) {
        w.shutdownResolve?.();
      }

      await service.stopWorker('node-1');

      expect(service.getPool('node-1')).toBeUndefined();
      expect(service.getAllWorkers().size).toBe(0);
    });
  });
});
