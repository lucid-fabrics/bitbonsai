import { Test, type TestingModule } from '@nestjs/testing';
import { PoolLockService } from '../../pool-lock.service';

describe('PoolLockService', () => {
  let service: PoolLockService;

  beforeEach(async () => {
    jest.useFakeTimers();
    const module: TestingModule = await Test.createTestingModule({
      providers: [PoolLockService],
    }).compile();
    service = module.get<PoolLockService>(PoolLockService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('clears locks and starts watchdog', () => {
      service.initialize();
      // No error thrown — watchdog started
      expect(service).toBeDefined();
    });
  });

  describe('onModuleDestroy', () => {
    it('clears the watchdog interval', () => {
      service.initialize();
      expect(() => service.onModuleDestroy()).not.toThrow();
    });

    it('is idempotent when called without initialization', () => {
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  describe('acquire / release', () => {
    it('acquires a lock for a node', async () => {
      await expect(service.acquire('node-1', 'worker-1')).resolves.toBeUndefined();
    });

    it('releases a lock', async () => {
      await service.acquire('node-1', 'worker-1');
      expect(() => service.release('node-1')).not.toThrow();
    });

    it('does nothing when releasing a non-existent lock', () => {
      expect(() => service.release('node-missing')).not.toThrow();
    });

    it('waits for existing lock to be released before acquiring', async () => {
      await service.acquire('node-1', 'worker-1');

      let acquired = false;
      const secondAcquire = service.acquire('node-1', 'worker-2').then(() => {
        acquired = true;
      });

      // Not yet acquired
      expect(acquired).toBe(false);

      // Release first lock
      service.release('node-1');
      await secondAcquire;
      expect(acquired).toBe(true);
    });

    it('throws after max retries on timeout', async () => {
      jest.useRealTimers();
      // Use large expectedDurationMs so staleThreshold is far in the future,
      // but small timeoutMs so Promise.race times out quickly
      const LARGE_EXPECTED = 10 * 60 * 1000; // 10 min expected duration
      await service.acquire('node-1', 'worker-1', 20, LARGE_EXPECTED);

      // worker-2 will try to acquire with 20ms timeout, fail 3 times
      await expect(service.acquire('node-1', 'worker-2', 20, LARGE_EXPECTED)).rejects.toThrow(
        /Failed to acquire pool lock/
      );
      jest.useFakeTimers();
    });
  });

  describe('withLock', () => {
    it('executes fn while holding lock and releases afterwards', async () => {
      let executed = false;
      await service.withLock('node-1', 'worker-1', async () => {
        executed = true;
        return 42;
      });
      expect(executed).toBe(true);
      // Should be able to acquire again after release
      await expect(service.acquire('node-1', 'worker-again')).resolves.toBeUndefined();
    });

    it('releases lock even when fn throws', async () => {
      await expect(
        service.withLock('node-1', 'worker-1', async () => {
          throw new Error('fn error');
        })
      ).rejects.toThrow('fn error');

      // Lock should be released — acquire should succeed immediately
      await expect(service.acquire('node-1', 'worker-2')).resolves.toBeUndefined();
    });

    it('returns the fn return value', async () => {
      const result = await service.withLock('node-1', 'worker-1', async () => 'result-value');
      expect(result).toBe('result-value');
    });
  });

  describe('stale lock detection', () => {
    it('auto-releases a heartbeat-stale lock on next acquire', async () => {
      await service.acquire('node-1', 'worker-1');

      // Advance time past heartbeat stale threshold (60s)
      jest.advanceTimersByTime(65000);

      // Next acquire should detect stale lock and take over
      await expect(service.acquire('node-1', 'worker-2', 100)).resolves.toBeUndefined();
    });

    it('watchdog forcibly releases stale locks', async () => {
      service.initialize();
      await service.acquire('node-1', 'stale-holder', 100, 0);

      // Advance time past watchdog interval and stale threshold
      jest.advanceTimersByTime(90000);

      // Lock should have been released by watchdog — acquire should succeed
      await expect(service.acquire('node-1', 'new-holder')).resolves.toBeUndefined();
    });
  });
});
