import * as fs from 'node:fs';
import * as os from 'node:os';
import { Test, type TestingModule } from '@nestjs/testing';
import { NodesService } from '../../../nodes/nodes.service';
import { SystemResourceService } from '../../system-resource.service';

jest.mock('node:fs', () => ({
  promises: {
    access: jest.fn(),
    stat: jest.fn(),
    statfs: jest.fn(),
  },
  constants: { R_OK: 4 },
  existsSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  renameSync: jest.fn(),
  copyFileSync: jest.fn(),
}));
jest.mock('node:os');

describe('SystemResourceService', () => {
  let service: SystemResourceService;
  let module: TestingModule;
  let nodesService: jest.Mocked<NodesService>;

  const mockNodesService = {
    getCurrentNode: jest.fn().mockResolvedValue({ id: 'node-1' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default OS mocks
    (os.cpus as jest.Mock).mockReturnValue(new Array(8).fill({ model: 'Intel' }));
    (os.loadavg as jest.Mock).mockReturnValue([1.0, 1.0, 1.0]);
    (os.freemem as jest.Mock).mockReturnValue(16 * 1024 ** 3);
    (os.totalmem as jest.Mock).mockReturnValue(32 * 1024 ** 3);

    module = await Test.createTestingModule({
      providers: [SystemResourceService, { provide: NodesService, useValue: mockNodesService }],
    }).compile();

    service = module.get(SystemResourceService);
    nodesService = module.get(NodesService);
  });

  afterEach(async () => {
    await module.close();
  });

  // ─── calculateOptimalWorkers ───────────────────────────────────────────────

  describe('calculateOptimalWorkers', () => {
    it('returns clamped result for normal 8-core system', () => {
      (os.cpus as jest.Mock).mockReturnValue(new Array(8).fill({}));
      const workers = service.calculateOptimalWorkers();
      // 8 / 4 = 2 theoretical, * 0.5 = 1, clamped to MIN 2
      expect(workers).toBe(2);
    });

    it('uses fallback of 8 cores when cpu count is 0', () => {
      (os.cpus as jest.Mock).mockReturnValue([]);
      const workers = service.calculateOptimalWorkers();
      // 8 / 4 = 2 theoretical, * 0.5 = 1, clamped to MIN 2
      expect(workers).toBe(2);
    });

    it('uses minimum of 4 cores when cpu count is below 4', () => {
      (os.cpus as jest.Mock).mockReturnValue(new Array(2).fill({}));
      const workers = service.calculateOptimalWorkers();
      // treated as 4 cores: 4/4=1 * 0.5=0, clamped to MIN 2
      expect(workers).toBe(2);
    });

    it('clamps to MAX_WORKERS_PER_NODE for very high core count', () => {
      (os.cpus as jest.Mock).mockReturnValue(new Array(128).fill({}));
      const workers = service.calculateOptimalWorkers();
      expect(workers).toBe(12); // clamped at MAX
    });

    it('handles exactly 4 cores without triggering low-cpu warning', () => {
      (os.cpus as jest.Mock).mockReturnValue(new Array(4).fill({}));
      const workers = service.calculateOptimalWorkers();
      expect(workers).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── checkSystemLoad ───────────────────────────────────────────────────────

  describe('checkSystemLoad', () => {
    it('returns not overloaded when load and memory are normal', () => {
      (os.cpus as jest.Mock).mockReturnValue(new Array(8).fill({}));
      (os.loadavg as jest.Mock).mockReturnValue([4.0, 0, 0]); // below 8*2=16
      (os.freemem as jest.Mock).mockReturnValue(8 * 1024 ** 3); // 8 GB > 4 GB min

      const result = service.checkSystemLoad();
      expect(result.isOverloaded).toBe(false);
      expect(result.reason).toBe('');
    });

    it('returns overloaded when load exceeds threshold', () => {
      (os.cpus as jest.Mock).mockReturnValue(new Array(8).fill({}));
      (os.loadavg as jest.Mock).mockReturnValue([20.0, 0, 0]); // 20 > 8*2=16
      (os.freemem as jest.Mock).mockReturnValue(8 * 1024 ** 3);

      const result = service.checkSystemLoad();
      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('High system load');
    });

    it('returns overloaded when free memory is below 4 GB', () => {
      (os.cpus as jest.Mock).mockReturnValue(new Array(8).fill({}));
      (os.loadavg as jest.Mock).mockReturnValue([1.0, 0, 0]);
      (os.freemem as jest.Mock).mockReturnValue(2 * 1024 ** 3); // 2 GB < 4 GB

      const result = service.checkSystemLoad();
      expect(result.isOverloaded).toBe(true);
      expect(result.reason).toContain('Low memory');
    });

    it('includes load and memory info in details string', () => {
      (os.cpus as jest.Mock).mockReturnValue(new Array(4).fill({}));
      (os.loadavg as jest.Mock).mockReturnValue([2.0, 0, 0]);
      (os.freemem as jest.Mock).mockReturnValue(10 * 1024 ** 3);

      const result = service.checkSystemLoad();
      expect(result.details).toContain('Load:');
      expect(result.details).toContain('Memory:');
    });

    it('prioritises high-load check over low-memory check', () => {
      (os.cpus as jest.Mock).mockReturnValue(new Array(8).fill({}));
      (os.loadavg as jest.Mock).mockReturnValue([20.0, 0, 0]); // overloaded
      (os.freemem as jest.Mock).mockReturnValue(1 * 1024 ** 3); // also low mem

      const result = service.checkSystemLoad();
      expect(result.reason).toContain('High system load');
    });
  });

  // ─── waitForSystemLoad ─────────────────────────────────────────────────────

  describe('waitForSystemLoad', () => {
    it('resolves immediately when system is not overloaded', async () => {
      (os.cpus as jest.Mock).mockReturnValue(new Array(8).fill({}));
      (os.loadavg as jest.Mock).mockReturnValue([1.0, 0, 0]);
      (os.freemem as jest.Mock).mockReturnValue(16 * 1024 ** 3);

      await expect(service.waitForSystemLoad()).resolves.toBeUndefined();
    });

    it('loops until system is no longer overloaded', async () => {
      jest.useFakeTimers();

      (os.cpus as jest.Mock).mockReturnValue(new Array(8).fill({}));
      (os.freemem as jest.Mock).mockReturnValue(16 * 1024 ** 3);

      let callCount = 0;
      (os.loadavg as jest.Mock).mockImplementation(() => {
        callCount++;
        // Overloaded on first two calls, normal on third
        return callCount < 3 ? [20.0, 0, 0] : [1.0, 0, 0];
      });

      const waitPromise = service.waitForSystemLoad();
      // Advance timer past the throttle check interval (10000ms) twice
      await jest.advanceTimersByTimeAsync(10000);
      await jest.advanceTimersByTimeAsync(10000);

      await waitPromise;
      jest.useRealTimers();
    });
  });

  // ─── performResourcePreflightChecks ───────────────────────────────────────

  describe('performResourcePreflightChecks', () => {
    beforeEach(() => {
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.stat as jest.Mock).mockResolvedValue({ size: 1 * 1024 ** 3 });
      (fs.promises.statfs as jest.Mock).mockResolvedValue({
        bavail: 10_000_000, // ~40 GB available
        bsize: 4096,
      });
      (os.totalmem as jest.Mock).mockReturnValue(32 * 1024 ** 3);
      (os.freemem as jest.Mock).mockReturnValue(16 * 1024 ** 3);
    });

    it('completes without error when all resources are sufficient', async () => {
      await expect(
        service.performResourcePreflightChecks('/media/video.mkv', 'job-1')
      ).resolves.toBeUndefined();
    });

    it('throws when file is not readable', async () => {
      (fs.promises.access as jest.Mock).mockRejectedValue(new Error('EACCES'));

      await expect(
        service.performResourcePreflightChecks('/media/video.mkv', 'job-1')
      ).rejects.toThrow('Cannot read source file');
    });

    it('throws when disk space is insufficient', async () => {
      // 1 GB file, but only tiny disk space available
      (fs.promises.statfs as jest.Mock).mockResolvedValue({
        bavail: 10,
        bsize: 4096, // ~40 KB available
      });

      await expect(
        service.performResourcePreflightChecks('/media/video.mkv', 'job-1')
      ).rejects.toThrow('Insufficient disk space');
    });

    it('skips disk check gracefully when statfs throws non-disk error', async () => {
      (fs.promises.statfs as jest.Mock).mockRejectedValue(new Error('ENOSYS'));

      await expect(
        service.performResourcePreflightChecks('/media/video.mkv', 'job-1')
      ).resolves.toBeUndefined();
    });

    it('logs low memory warning when free memory percent is below 10%', async () => {
      const logWarnSpy = jest.spyOn(service.logger, 'warn');

      (os.totalmem as jest.Mock).mockReturnValue(32 * 1024 ** 3);
      (os.freemem as jest.Mock).mockReturnValue(2 * 1024 ** 3); // ~6% — below 10%

      await service.performResourcePreflightChecks('/media/video.mkv', 'job-1');

      expect(logWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Low memory warning'));
    });
  });

  // ─── reloadLoadThreshold ───────────────────────────────────────────────────

  describe('reloadLoadThreshold', () => {
    it('sets multiplier from database node when present', async () => {
      nodesService.getCurrentNode.mockResolvedValueOnce({
        id: 'node-1',
        loadThresholdMultiplier: 1.5,
      } as never);

      await service.reloadLoadThreshold();

      expect(service.getLoadThresholdMultiplier()).toBe(1.5);
    });

    it('uses default multiplier when node has no loadThresholdMultiplier', async () => {
      nodesService.getCurrentNode.mockResolvedValueOnce({ id: 'node-1' } as never);

      await service.reloadLoadThreshold();

      expect(service.getLoadThresholdMultiplier()).toBeLessThanOrEqual(2.0);
    });

    it('sets encodingTempPath from database when present', async () => {
      nodesService.getCurrentNode.mockResolvedValueOnce({
        id: 'node-1',
        encodingTempPath: '/cache/ssd',
      } as never);

      await service.reloadLoadThreshold();

      expect(service.getEncodingTempPath()).toBe('/cache/ssd');
    });

    it('falls back to ENV for encodingTempPath when not in database', async () => {
      process.env.ENCODING_TEMP_PATH = '/tmp/encode';
      nodesService.getCurrentNode.mockResolvedValueOnce({ id: 'node-1' } as never);

      await service.reloadLoadThreshold();

      expect(service.getEncodingTempPath()).toBe('/tmp/encode');
      process.env.ENCODING_TEMP_PATH = '';
    });

    it('sets encodingTempPath to null when neither DB nor ENV configured', async () => {
      process.env.ENCODING_TEMP_PATH = '';
      nodesService.getCurrentNode.mockResolvedValueOnce({ id: 'node-1' } as never);

      await service.reloadLoadThreshold();

      expect(service.getEncodingTempPath()).toBeNull();
    });

    it('uses defaults and sets encodingTempPath from ENV when getCurrentNode throws', async () => {
      process.env.ENCODING_TEMP_PATH = '/fallback';
      nodesService.getCurrentNode.mockRejectedValueOnce(new Error('DB connection error'));

      await service.reloadLoadThreshold();

      expect(service.getLoadThresholdMultiplier()).toBeLessThanOrEqual(2.0);
      expect(service.getEncodingTempPath()).toBe('/fallback');
      process.env.ENCODING_TEMP_PATH = '';
    });

    it('sets encodingTempPath to null on error when ENV is not set', async () => {
      process.env.ENCODING_TEMP_PATH = '';
      nodesService.getCurrentNode.mockRejectedValueOnce(new Error('DB error'));

      await service.reloadLoadThreshold();

      expect(service.getEncodingTempPath()).toBeNull();
    });
  });

  // ─── getSystemLoadInfo ─────────────────────────────────────────────────────

  describe('getSystemLoadInfo', () => {
    it('returns complete system load info object', () => {
      (os.cpus as jest.Mock).mockReturnValue(new Array(8).fill({}));
      (os.loadavg as jest.Mock).mockReturnValue([1.5, 2.0, 1.8]);
      (os.freemem as jest.Mock).mockReturnValue(8 * 1024 ** 3);
      (os.totalmem as jest.Mock).mockReturnValue(32 * 1024 ** 3);

      const info = service.getSystemLoadInfo();

      expect(info.loadAvg1m).toBe(1.5);
      expect(info.loadAvg5m).toBe(2.0);
      expect(info.loadAvg15m).toBe(1.8);
      expect(info.cpuCount).toBe(8);
      expect(info.freeMemoryGB).toBeCloseTo(8);
      expect(info.totalMemoryGB).toBeCloseTo(32);
      expect(typeof info.isOverloaded).toBe('boolean');
    });

    it('reflects custom load threshold multiplier after reload', async () => {
      nodesService.getCurrentNode.mockResolvedValueOnce({
        id: 'node-1',
        loadThresholdMultiplier: 1.0,
      } as never);

      await service.reloadLoadThreshold();

      (os.cpus as jest.Mock).mockReturnValue(new Array(8).fill({}));
      const info = service.getSystemLoadInfo();
      expect(info.loadThreshold).toBe(8); // 8 cores * 1.0
      expect(info.loadThresholdMultiplier).toBe(1.0);
    });
  });

  // ─── getters ──────────────────────────────────────────────────────────────

  describe('maxWorkersPerNode getter', () => {
    it('returns 12', () => {
      expect(service.maxWorkersPerNode).toBe(12);
    });
  });
});
