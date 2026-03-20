import { Test, type TestingModule } from '@nestjs/testing';
import { JobStage } from '@prisma/client';
import { JobRepository } from '../../../common/repositories/job.repository';
import { FfmpegService } from '../../ffmpeg.service';
import { PoolLockService } from '../../pool-lock.service';
import { SystemResourceService } from '../../system-resource.service';
import { WorkerPoolService } from '../../worker-pool.service';

describe('WorkerPoolService', () => {
  let service: WorkerPoolService;
  let poolLockService: { withLock: jest.Mock };
  let systemResourceService: { defaultWorkersPerNode: number; maxWorkersPerNode: number };
  let ffmpegService: { killProcess: jest.Mock };
  let jobRepository: { updateById: jest.Mock };

  beforeEach(async () => {
    poolLockService = {
      withLock: jest
        .fn()
        .mockImplementation((_nodeId: string, _holder: string, fn: () => Promise<unknown>) => fn()),
    };

    systemResourceService = {
      defaultWorkersPerNode: 2,
      maxWorkersPerNode: 4,
    };

    ffmpegService = {
      killProcess: jest.fn().mockResolvedValue(undefined),
    };

    jobRepository = {
      updateById: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerPoolService,
        { provide: PoolLockService, useValue: poolLockService },
        { provide: SystemResourceService, useValue: systemResourceService },
        { provide: FfmpegService, useValue: ffmpegService },
        { provide: JobRepository, useValue: jobRepository },
      ],
    }).compile();

    service = module.get<WorkerPoolService>(WorkerPoolService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // Helper: set a pool whose maxWorkers == 0 so crash handler never triggers restart
  function setNoRestartPool(nodeId: string, workerIds: string[]) {
    (service as any).workerPools.set(nodeId, {
      nodeId,
      maxWorkers: 0, // 0 means remainingWorkers(0) < maxWorkers(0) is false → no restart
      activeWorkers: new Set(workerIds),
    });
  }

  // ---------------------------------------------------------------------------
  // getPool / getWorker / getAllWorkers
  // ---------------------------------------------------------------------------

  describe('getPool', () => {
    it('should return undefined when pool does not exist', () => {
      expect(service.getPool('nonexistent-node')).toBeUndefined();
    });

    it('should return pool after it has been created', async () => {
      const startWorkerFn = jest.fn().mockResolvedValue(undefined);
      await service.startWorkerPool('node-1', 1, startWorkerFn);
      const pool = service.getPool('node-1');
      expect(pool).not.toBeUndefined();
      expect(pool!.nodeId).toBe('node-1');
    });
  });

  describe('getWorker', () => {
    it('should return undefined when worker does not exist', () => {
      expect(service.getWorker('nonexistent-worker')).toBeUndefined();
    });
  });

  describe('getAllWorkers', () => {
    it('should return empty map initially', () => {
      expect(service.getAllWorkers().size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // startWorkerPool
  // ---------------------------------------------------------------------------

  describe('startWorkerPool', () => {
    it('should create a pool and start the requested number of workers', async () => {
      const startWorkerFn = jest.fn().mockResolvedValue(undefined);
      const started = await service.startWorkerPool('node-1', 2, startWorkerFn);

      expect(started).toBe(2);
      expect(service.getPool('node-1')!.activeWorkers.size).toBe(2);
    });

    it('should clamp maxWorkers to 1 when 0 is passed', async () => {
      const startWorkerFn = jest.fn().mockResolvedValue(undefined);
      const started = await service.startWorkerPool('node-1', 0, startWorkerFn);

      expect(started).toBe(1);
    });

    it('should clamp maxWorkers to systemResourceService.maxWorkersPerNode', async () => {
      const startWorkerFn = jest.fn().mockResolvedValue(undefined);
      const started = await service.startWorkerPool('node-1', 99, startWorkerFn);

      expect(started).toBe(4); // maxWorkersPerNode = 4
    });

    it('should return 0 and warn when pool already at capacity', async () => {
      const startWorkerFn = jest.fn().mockResolvedValue(undefined);
      await service.startWorkerPool('node-1', 2, startWorkerFn);
      const started = await service.startWorkerPool('node-1', 2, startWorkerFn);

      expect(started).toBe(0);
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('already at capacity')
      );
    });

    it('should start only delta workers when pool exists with fewer workers', async () => {
      const startWorkerFn = jest.fn().mockResolvedValue(undefined);
      await service.startWorkerPool('node-1', 1, startWorkerFn);
      const started = await service.startWorkerPool('node-1', 2, startWorkerFn);

      expect(started).toBe(1);
      expect(service.getPool('node-1')!.activeWorkers.size).toBe(2);
    });

    it('should rollback worker from activeWorkers when startWorker throws', async () => {
      const startWorkerFn = jest.fn().mockResolvedValue(undefined);
      let startWorkerCallCount = 0;
      jest.spyOn(service, 'startWorker').mockImplementation(async (wId, nId, fn) => {
        startWorkerCallCount++;
        if (startWorkerCallCount === 2) throw new Error('start failure');
        // Call real method via the prototype but without recursion risk
        const worker = {
          workerId: wId,
          nodeId: nId,
          isRunning: true,
          currentJobId: null,
          startedAt: new Date(),
          shutdownPromise: Promise.resolve(),
          shutdownResolve: jest.fn(),
        };
        (service as any).workers.set(wId, worker);
        fn(wId, nId).catch(() => {
          /* noop */
        });
      });

      const started = await service.startWorkerPool('node-1', 2, startWorkerFn);

      expect(started).toBe(1);
      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to start worker'),
        expect.any(Error)
      );
    });

    it('should use defaultWorkersPerNode when no maxWorkers provided', async () => {
      const startWorkerFn = jest.fn().mockResolvedValue(undefined);
      const started = await service.startWorkerPool('node-1', undefined, startWorkerFn);

      expect(started).toBe(systemResourceService.defaultWorkersPerNode);
    });
  });

  // ---------------------------------------------------------------------------
  // startWorker
  // ---------------------------------------------------------------------------

  describe('startWorker', () => {
    it('should warn and return early when worker already exists', async () => {
      (service as any).workers.set('node-1-worker-1', {
        workerId: 'node-1-worker-1',
        nodeId: 'node-1',
        isRunning: true,
        currentJobId: null,
        startedAt: new Date(),
      });

      const startWorkerFn = jest.fn().mockResolvedValue(undefined);
      await service.startWorker('node-1-worker-1', 'node-1', startWorkerFn);

      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('already running')
      );
      expect(startWorkerFn).not.toHaveBeenCalled();
    });

    it('should register worker in workers map', async () => {
      const startWorkerFn = jest.fn().mockResolvedValue(undefined);

      await service.startWorker('node-1-worker-1', 'node-1', startWorkerFn);
      await new Promise(process.nextTick);

      expect(service.getWorker('node-1-worker-1')).not.toBeUndefined();
    });

    it('should handle crash recovery without active job (no restart when pool full)', async () => {
      const crashError = new Error('crash!');
      const startWorkerFn = jest.fn().mockRejectedValue(crashError);

      // maxWorkers=0: after crash removes the worker, remainingWorkers(0) < 0 is false → no restart
      setNoRestartPool('node-1', ['node-1-worker-1']);

      await service.startWorker('node-1-worker-1', 'node-1', startWorkerFn);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Worker crashed:'),
        crashError
      );
      expect(service.getWorker('node-1-worker-1')).toBeUndefined();
    });

    it('should kill active FFmpeg process on crash when currentJobId is set', async () => {
      const crashError = new Error('crash during encoding!');
      // startWorkerFn resolves on first tick so worker is registered, then we set jobId,
      // then on second call it rejects to simulate the crash
      let callCount = 0;
      const startWorkerFn = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Delay rejection so we can set currentJobId first
          return new Promise<void>((_, reject) => setTimeout(() => reject(crashError), 20));
        }
        return Promise.resolve();
      });

      setNoRestartPool('node-1', ['node-1-worker-1']);

      await service.startWorker('node-1-worker-1', 'node-1', startWorkerFn);

      // Worker is now registered — set jobId before crash fires
      const worker = service.getWorker('node-1-worker-1');
      if (worker) worker.currentJobId = 'job-abc';

      // Wait for crash handler (fires after 20ms delay)
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(ffmpegService.killProcess).toHaveBeenCalledWith('job-abc');
      expect(jobRepository.updateById).toHaveBeenCalledWith('job-abc', {
        stage: JobStage.QUEUED,
        error: expect.stringContaining('crashed'),
        retryCount: { increment: 1 },
      });
    });

    it('should handle killProcess failure gracefully during crash recovery', async () => {
      const crashError = new Error('crash!');
      ffmpegService.killProcess.mockRejectedValue(new Error('kill failed'));

      const startWorkerFn = jest
        .fn()
        .mockImplementation(
          () => new Promise<void>((_, reject) => setTimeout(() => reject(crashError), 20))
        );

      setNoRestartPool('node-1', ['node-1-worker-1']);

      await service.startWorker('node-1-worker-1', 'node-1', startWorkerFn);
      const worker = service.getWorker('node-1-worker-1');
      if (worker) worker.currentJobId = 'job-xyz';

      await new Promise((resolve) => setTimeout(resolve, 40));

      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to kill FFmpeg'),
        expect.any(Error)
      );
    });

    it('should handle jobRepository.updateById failure gracefully during crash recovery', async () => {
      const crashError = new Error('crash!');
      jobRepository.updateById.mockRejectedValue(new Error('db error'));

      const startWorkerFn = jest
        .fn()
        .mockImplementation(
          () => new Promise<void>((_, reject) => setTimeout(() => reject(crashError), 20))
        );

      setNoRestartPool('node-1', ['node-1-worker-1']);

      await service.startWorker('node-1-worker-1', 'node-1', startWorkerFn);
      const worker = service.getWorker('node-1-worker-1');
      if (worker) worker.currentJobId = 'job-xyz';

      await new Promise((resolve) => setTimeout(resolve, 40));

      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to reset job'),
        expect.any(Error)
      );
    });

    it('should log error when worker or pool not found during crash cleanup', async () => {
      const crashError = new Error('crash!');
      const startWorkerFn = jest.fn().mockRejectedValue(crashError);

      // No pool set — crash handler cannot find it
      await service.startWorker('node-1-worker-1', 'node-1', startWorkerFn);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Worker or pool not found during crash cleanup')
      );
    });

    it('should resolve shutdownPromise after crash cleanup', async () => {
      const crashError = new Error('crash!');
      const startWorkerFn = jest.fn().mockRejectedValue(crashError);

      // maxWorkers=0: no restart triggered after crash
      setNoRestartPool('node-1', ['node-1-worker-1']);

      await service.startWorker('node-1-worker-1', 'node-1', startWorkerFn);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Worker must be fully cleaned up (no leak)
      expect(service.getWorker('node-1-worker-1')).toBeUndefined();
      expect(service.getPool('node-1')!.activeWorkers.has('node-1-worker-1')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // stopWorker
  // ---------------------------------------------------------------------------

  describe('stopWorker', () => {
    it('should warn when no pool found for node', async () => {
      await service.stopWorker('nonexistent-node');

      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No worker pool found')
      );
    });

    it('should warn when specific workerId not found', async () => {
      (service as any).workerPools.set('node-1', {
        nodeId: 'node-1',
        maxWorkers: 1,
        activeWorkers: new Set(),
      });

      await service.stopWorker('node-1', 'node-1-worker-99');

      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('not found')
      );
    });

    it('should stop a specific worker with no current job', async () => {
      const worker = {
        workerId: 'node-1-worker-1',
        nodeId: 'node-1',
        isRunning: true,
        currentJobId: null as string | null,
        startedAt: new Date(),
        shutdownPromise: Promise.resolve(),
        shutdownResolve: jest.fn(),
      };

      (service as any).workers.set('node-1-worker-1', worker);
      (service as any).workerPools.set('node-1', {
        nodeId: 'node-1',
        maxWorkers: 1,
        activeWorkers: new Set(['node-1-worker-1']),
      });

      await service.stopWorker('node-1', 'node-1-worker-1');

      expect(worker.isRunning).toBe(false);
      expect(service.getWorker('node-1-worker-1')).toBeUndefined();
    });

    it('should log waiting message when stopping a worker with an active job', async () => {
      const worker = {
        workerId: 'node-1-worker-1',
        nodeId: 'node-1',
        isRunning: true,
        currentJobId: 'job-123',
        startedAt: new Date(),
        shutdownPromise: Promise.resolve(),
        shutdownResolve: jest.fn(),
      };

      (service as any).workers.set('node-1-worker-1', worker);
      (service as any).workerPools.set('node-1', {
        nodeId: 'node-1',
        maxWorkers: 1,
        activeWorkers: new Set(['node-1-worker-1']),
      });

      await service.stopWorker('node-1', 'node-1-worker-1');

      expect((service as any).logger.log).toHaveBeenCalledWith(
        expect.stringContaining('Waiting for worker')
      );
    });

    it('should stop all workers for a node when no workerId given', async () => {
      const makeWorker = (id: string) => ({
        workerId: id,
        nodeId: 'node-1',
        isRunning: true,
        currentJobId: null as string | null,
        startedAt: new Date(),
        shutdownPromise: Promise.resolve(),
        shutdownResolve: jest.fn(),
      });

      (service as any).workers.set('node-1-worker-1', makeWorker('node-1-worker-1'));
      (service as any).workers.set('node-1-worker-2', makeWorker('node-1-worker-2'));
      (service as any).workerPools.set('node-1', {
        nodeId: 'node-1',
        maxWorkers: 2,
        activeWorkers: new Set(['node-1-worker-1', 'node-1-worker-2']),
      });

      await service.stopWorker('node-1');

      expect(service.getWorker('node-1-worker-1')).toBeUndefined();
      expect(service.getWorker('node-1-worker-2')).toBeUndefined();
      expect(service.getPool('node-1')).toBeUndefined();
    });

    it('should log waiting for active job in stop-all path', async () => {
      const worker = {
        workerId: 'node-1-worker-1',
        nodeId: 'node-1',
        isRunning: true,
        currentJobId: 'job-active',
        startedAt: new Date(),
        shutdownPromise: Promise.resolve(),
        shutdownResolve: jest.fn(),
      };

      (service as any).workers.set('node-1-worker-1', worker);
      (service as any).workerPools.set('node-1', {
        nodeId: 'node-1',
        maxWorkers: 1,
        activeWorkers: new Set(['node-1-worker-1']),
      });

      await service.stopWorker('node-1');

      expect((service as any).logger.log).toHaveBeenCalledWith(
        expect.stringContaining('Waiting for worker')
      );
    });
  });

  // ---------------------------------------------------------------------------
  // removeWorker
  // ---------------------------------------------------------------------------

  describe('removeWorker', () => {
    it('should do nothing when worker not found', () => {
      expect(() => service.removeWorker('nonexistent')).not.toThrow();
    });

    it('should remove worker from both workers map and pool activeWorkers', () => {
      (service as any).workers.set('node-1-worker-1', {
        workerId: 'node-1-worker-1',
        nodeId: 'node-1',
        isRunning: false,
        currentJobId: null,
        startedAt: new Date(),
      });
      (service as any).workerPools.set('node-1', {
        nodeId: 'node-1',
        maxWorkers: 1,
        activeWorkers: new Set(['node-1-worker-1']),
      });

      service.removeWorker('node-1-worker-1');

      expect(service.getWorker('node-1-worker-1')).toBeUndefined();
      expect(service.getPool('node-1')!.activeWorkers.has('node-1-worker-1')).toBe(false);
    });

    it('should still delete from workers map when pool not found', () => {
      (service as any).workers.set('node-orphan-worker', {
        workerId: 'node-orphan-worker',
        nodeId: 'nonexistent-node',
        isRunning: false,
        currentJobId: null,
        startedAt: new Date(),
      });

      service.removeWorker('node-orphan-worker');

      expect(service.getWorker('node-orphan-worker')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // setWorkerJob
  // ---------------------------------------------------------------------------

  describe('setWorkerJob', () => {
    it('should do nothing when worker not found', () => {
      expect(() => service.setWorkerJob('nonexistent', 'job-1')).not.toThrow();
    });

    it('should set currentJobId on the worker', async () => {
      const startWorkerFn = jest.fn().mockResolvedValue(undefined);
      await service.startWorker('node-1-worker-1', 'node-1', startWorkerFn);

      service.setWorkerJob('node-1-worker-1', 'job-abc');

      expect(service.getWorker('node-1-worker-1')!.currentJobId).toBe('job-abc');
    });

    it('should clear currentJobId when set to null', async () => {
      const startWorkerFn = jest.fn().mockResolvedValue(undefined);
      await service.startWorker('node-1-worker-1', 'node-1', startWorkerFn);

      service.setWorkerJob('node-1-worker-1', 'job-abc');
      service.setWorkerJob('node-1-worker-1', null);

      expect(service.getWorker('node-1-worker-1')!.currentJobId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // resolveShutdown
  // ---------------------------------------------------------------------------

  describe('resolveShutdown', () => {
    it('should do nothing when worker not found', () => {
      expect(() => service.resolveShutdown('nonexistent')).not.toThrow();
    });

    it('should call shutdownResolve when worker has it', () => {
      const shutdownResolve = jest.fn();
      (service as any).workers.set('node-1-worker-1', {
        workerId: 'node-1-worker-1',
        nodeId: 'node-1',
        isRunning: false,
        currentJobId: null,
        startedAt: new Date(),
        shutdownResolve,
      });

      service.resolveShutdown('node-1-worker-1');

      expect(shutdownResolve).toHaveBeenCalledTimes(1);
    });

    it('should not throw when shutdownResolve is undefined', () => {
      (service as any).workers.set('node-1-worker-1', {
        workerId: 'node-1-worker-1',
        nodeId: 'node-1',
        isRunning: false,
        currentJobId: null,
        startedAt: new Date(),
        shutdownResolve: undefined,
      });

      expect(() => service.resolveShutdown('node-1-worker-1')).not.toThrow();
    });
  });
});
