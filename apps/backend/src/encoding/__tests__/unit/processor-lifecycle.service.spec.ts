import { Test, type TestingModule } from '@nestjs/testing';
import { NodesService } from '../../../nodes/nodes.service';
import { EncodingStartupService } from '../../encoding-startup.service';
import { EncodingWatchdogService } from '../../encoding-watchdog.service';
import { FfmpegService } from '../../ffmpeg.service';
import { PoolLockService } from '../../pool-lock.service';
import { ProcessorLifecycleService } from '../../processor-lifecycle.service';
import { SystemResourceService } from '../../system-resource.service';
import { WorkerPoolService } from '../../worker-pool.service';

const mockNode = {
  id: 'node-1',
  name: 'Test Node',
  role: 'MAIN',
  mainNodeUrl: null,
  hasSharedStorage: true,
  maxWorkers: 2,
};

describe('ProcessorLifecycleService', () => {
  let service: ProcessorLifecycleService;
  let poolLockService: jest.Mocked<PoolLockService>;
  let systemResourceService: jest.Mocked<SystemResourceService>;
  let ffmpegService: jest.Mocked<FfmpegService>;
  let nodesService: jest.Mocked<NodesService>;
  let encodingStartupService: jest.Mocked<EncodingStartupService>;
  let workerPoolService: jest.Mocked<WorkerPoolService>;
  let encodingWatchdogService: jest.Mocked<EncodingWatchdogService>;

  beforeEach(async () => {
    // Reset static intervals between tests
    (
      ProcessorLifecycleService as unknown as { activeIntervals: Set<NodeJS.Timeout> }
    ).activeIntervals.clear();

    poolLockService = {
      initialize: jest.fn(),
    } as unknown as jest.Mocked<PoolLockService>;

    systemResourceService = {
      getEncodingTempPath: jest.fn().mockReturnValue(null),
      reloadLoadThreshold: jest.fn().mockResolvedValue(undefined),
      defaultWorkersPerNode: 2,
    } as unknown as jest.Mocked<SystemResourceService>;

    ffmpegService = {
      killAllFfmpegProcesses: jest.fn().mockResolvedValue({ killed: 0, failed: 0, details: [] }),
    } as unknown as jest.Mocked<FfmpegService>;

    nodesService = {
      getCurrentNode: jest.fn().mockResolvedValue(mockNode),
    } as unknown as jest.Mocked<NodesService>;

    encodingStartupService = {
      waitForVolumeMounts: jest.fn().mockResolvedValue(undefined),
      autoHealOrphanedJobs: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EncodingStartupService>;

    workerPoolService = {
      startWorkerPool: jest.fn().mockResolvedValue(2),
      stopWorker: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WorkerPoolService>;

    encodingWatchdogService = {
      startStuckJobWatchdog: jest.fn().mockReturnValue(setInterval(() => {}, 999999)),
    } as unknown as jest.Mocked<EncodingWatchdogService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcessorLifecycleService,
        { provide: PoolLockService, useValue: poolLockService },
        { provide: SystemResourceService, useValue: systemResourceService },
        { provide: FfmpegService, useValue: ffmpegService },
        { provide: NodesService, useValue: nodesService },
        { provide: EncodingStartupService, useValue: encodingStartupService },
        { provide: WorkerPoolService, useValue: workerPoolService },
        { provide: EncodingWatchdogService, useValue: encodingWatchdogService },
      ],
    }).compile();

    service = module.get(ProcessorLifecycleService);
  });

  afterEach(() => {
    service.destroy();
    jest.useRealTimers();
  });

  describe('initialize', () => {
    it('initializes pool lock and loads load threshold', async () => {
      jest.useFakeTimers();
      const loopFn = jest.fn().mockResolvedValue(undefined);

      const initPromise = service.initialize(loopFn);
      jest.runAllTimersAsync();
      await initPromise;

      expect(poolLockService.initialize).toHaveBeenCalledTimes(1);
      expect(systemResourceService.reloadLoadThreshold).toHaveBeenCalledTimes(1);
    });

    it('waits for volume mounts and kills orphaned ffmpeg processes', async () => {
      jest.useFakeTimers();
      const loopFn = jest.fn().mockResolvedValue(undefined);

      const initPromise = service.initialize(loopFn);
      jest.runAllTimersAsync();
      await initPromise;

      expect(encodingStartupService.waitForVolumeMounts).toHaveBeenCalledTimes(1);
      expect(ffmpegService.killAllFfmpegProcesses).toHaveBeenCalledTimes(1);
    });

    it('skips worker startup when current node not found', async () => {
      nodesService.getCurrentNode.mockResolvedValue(null as never);
      jest.useFakeTimers();

      const initPromise = service.initialize(jest.fn());
      jest.runAllTimersAsync();
      await initPromise;

      expect(workerPoolService.startWorkerPool).not.toHaveBeenCalled();
      expect(encodingWatchdogService.startStuckJobWatchdog).not.toHaveBeenCalled();
    });

    it('heals orphaned jobs and starts worker pool for current node', async () => {
      jest.useFakeTimers();
      const loopFn = jest.fn().mockResolvedValue(undefined);

      const initPromise = service.initialize(loopFn);
      jest.runAllTimersAsync();
      await initPromise;

      expect(encodingStartupService.autoHealOrphanedJobs).toHaveBeenCalledWith('node-1');
      expect(workerPoolService.startWorkerPool).toHaveBeenCalledWith('node-1', 2, loopFn);
    });

    it('starts watchdog and tracks interval', async () => {
      jest.useFakeTimers();

      const initPromise = service.initialize(jest.fn());
      jest.runAllTimersAsync();
      await initPromise;

      expect(encodingWatchdogService.startStuckJobWatchdog).toHaveBeenCalledTimes(1);
      expect(
        (ProcessorLifecycleService as unknown as { activeIntervals: Set<NodeJS.Timeout> })
          .activeIntervals.size
      ).toBe(1);
    });

    it('uses node maxWorkers when set', async () => {
      nodesService.getCurrentNode.mockResolvedValue({ ...mockNode, maxWorkers: 4 } as never);
      jest.useFakeTimers();
      const loopFn = jest.fn();

      const initPromise = service.initialize(loopFn);
      jest.runAllTimersAsync();
      await initPromise;

      expect(workerPoolService.startWorkerPool).toHaveBeenCalledWith('node-1', 4, loopFn);
    });

    it('falls back to defaultWorkersPerNode when maxWorkers is null', async () => {
      nodesService.getCurrentNode.mockResolvedValue({ ...mockNode, maxWorkers: null } as never);
      jest.useFakeTimers();
      const loopFn = jest.fn();

      const initPromise = service.initialize(loopFn);
      jest.runAllTimersAsync();
      await initPromise;

      expect(workerPoolService.startWorkerPool).toHaveBeenCalledWith('node-1', 2, loopFn);
    });
  });

  describe('destroy', () => {
    it('clears watchdog interval and removes it from active set', async () => {
      jest.useFakeTimers();
      const initPromise = service.initialize(jest.fn());
      jest.runAllTimersAsync();
      await initPromise;

      expect(
        (ProcessorLifecycleService as unknown as { activeIntervals: Set<NodeJS.Timeout> })
          .activeIntervals.size
      ).toBe(1);

      service.destroy();

      expect(
        (ProcessorLifecycleService as unknown as { activeIntervals: Set<NodeJS.Timeout> })
          .activeIntervals.size
      ).toBe(0);
    });

    it('clears all stale intervals from static set even without initialized watchdog', () => {
      const stale = setInterval(() => {}, 999999);
      (
        ProcessorLifecycleService as unknown as { activeIntervals: Set<NodeJS.Timeout> }
      ).activeIntervals.add(stale);

      service.destroy();

      expect(
        (ProcessorLifecycleService as unknown as { activeIntervals: Set<NodeJS.Timeout> })
          .activeIntervals.size
      ).toBe(0);
    });

    it('is safe to call multiple times (idempotent)', () => {
      expect(() => {
        service.destroy();
        service.destroy();
      }).not.toThrow();
    });
  });

  describe('startWorkerPool', () => {
    it('delegates to WorkerPoolService', async () => {
      const loopFn = jest.fn();
      const result = await service.startWorkerPool('node-2', 3, loopFn);

      expect(workerPoolService.startWorkerPool).toHaveBeenCalledWith('node-2', 3, loopFn);
      expect(result).toBe(2);
    });
  });

  describe('stopWorker', () => {
    it('delegates to WorkerPoolService', async () => {
      await service.stopWorker('node-1', 'worker-1');
      expect(workerPoolService.stopWorker).toHaveBeenCalledWith('node-1', 'worker-1');
    });

    it('delegates without workerId when omitted', async () => {
      await service.stopWorker('node-1');
      expect(workerPoolService.stopWorker).toHaveBeenCalledWith('node-1', undefined);
    });
  });
});
