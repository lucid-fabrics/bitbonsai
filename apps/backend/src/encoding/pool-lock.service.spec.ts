import { Test, TestingModule } from '@nestjs/testing';
import { PoolLockService } from './pool-lock.service';

describe('PoolLockService', () => {
  let service: PoolLockService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PoolLockService],
    }).compile();

    service = module.get<PoolLockService>(PoolLockService);
    service.initialize();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('acquire and release', () => {
    it('should acquire a lock when none exists', async () => {
      await expect(service.acquire('node-1', 'worker-1')).resolves.not.toThrow();
      service.release('node-1');
    });

    it('should release a lock and allow re-acquisition', async () => {
      await service.acquire('node-1', 'worker-1');
      service.release('node-1');

      await expect(service.acquire('node-1', 'worker-2')).resolves.not.toThrow();
      service.release('node-1');
    });

    it('should handle release of non-existent lock gracefully', () => {
      expect(() => service.release('nonexistent-node')).not.toThrow();
    });
  });

  describe('withLock', () => {
    it('should execute function while holding lock', async () => {
      let executed = false;

      await service.withLock('node-1', 'test-op', async () => {
        executed = true;
      });

      expect(executed).toBe(true);
    });

    it('should release lock even when function throws', async () => {
      await expect(
        service.withLock('node-2', 'failing-op', async () => {
          throw new Error('operation failed');
        })
      ).rejects.toThrow('operation failed');

      // Lock should be released - should be able to acquire again
      await expect(service.acquire('node-2', 'next-op')).resolves.not.toThrow();
      service.release('node-2');
    });

    it('should return the function result', async () => {
      const result = await service.withLock('node-3', 'test-op', async () => 42);
      expect(result).toBe(42);
    });
  });

  describe('stale lock auto-release', () => {
    it('should auto-release stale lock with no heartbeat', async () => {
      // Manually inject a "stale" lock holder with old lastHeartbeat
      const poolLocks = (service as any).poolLocks as Map<string, any>;

      let released = false;
      poolLocks.set('node-stale', {
        promise: new Promise<void>((resolve) => {
          // Never resolves on its own
        }),
        release: () => {
          released = true;
        },
        acquiredAt: Date.now() - 120000, // 2 minutes ago
        holder: 'old-worker',
        expectedDurationMs: 0,
        staleThreshold: 60000,
        lastHeartbeat: Date.now() - 70000, // No heartbeat for 70 seconds (> 60s threshold)
      });

      // Acquiring lock for same node should auto-release the stale one
      await service.acquire('node-stale', 'new-worker', 5000);
      service.release('node-stale');

      expect(released).toBe(true);
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear the watchdog interval on destroy', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      service.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should be idempotent when called multiple times', () => {
      expect(() => {
        service.onModuleDestroy();
        service.onModuleDestroy();
      }).not.toThrow();
    });
  });

  describe('acquire - timeout and retry', () => {
    it('should throw after max retries when lock never releases', async () => {
      // Acquire first lock so subsequent acquire must wait
      await service.acquire('node-timeout', 'worker-1', 50);

      // Try to acquire with very short timeout — will timeout 3 times and throw
      await expect(service.acquire('node-timeout', 'worker-2', 10)).rejects.toThrow(
        /Failed to acquire pool lock/
      );

      service.release('node-timeout');
    }, 10000);

    it('should acquire successfully after prior lock is released', async () => {
      await service.acquire('node-seq', 'worker-1');

      // Release asynchronously
      setTimeout(() => service.release('node-seq'), 50);

      await expect(service.acquire('node-seq', 'worker-2', 5000)).resolves.not.toThrow();
      service.release('node-seq');
    });

    it('should auto-release time-stale lock and acquire immediately', async () => {
      const poolLocks = (service as any).poolLocks as Map<string, any>;

      let released = false;
      poolLocks.set('node-time-stale', {
        promise: new Promise<void>(() => {
          /* never resolves */
        }), // Never resolves
        release: () => {
          released = true;
        },
        acquiredAt: Date.now() - 200000, // Acquired 200s ago
        holder: 'old-holder',
        expectedDurationMs: 0,
        staleThreshold: 60000, // Only 60s threshold → stale
        lastHeartbeat: Date.now(), // Recent heartbeat, but time-stale
      });

      await service.acquire('node-time-stale', 'new-worker', 5000);
      service.release('node-time-stale');

      expect(released).toBe(true);
    });
  });

  describe('withLock - expectedDurationMs', () => {
    it('should pass expectedDurationMs to acquire', async () => {
      const acquireSpy = jest.spyOn(service, 'acquire');

      await service.withLock('node-dur', 'op', async () => 'done', 60000);

      expect(acquireSpy).toHaveBeenCalledWith('node-dur', 'op', 30000, 60000);
    });
  });

  describe('initialize', () => {
    it('should clear any existing locks', async () => {
      await service.acquire('node-x', 'worker-x');

      // Re-initialize should clear locks
      service.initialize();

      const poolLocks = (service as any).poolLocks as Map<string, any>;
      expect(poolLocks.size).toBe(0);
    });

    it('should restart the watchdog', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      service.initialize();

      expect(setIntervalSpy).toHaveBeenCalled();
    });
  });

  describe('watchdog - detects stale locks', () => {
    it('should forcibly release stale lock during watchdog tick', async () => {
      jest.useFakeTimers();

      // Fresh initialize with fake timers active
      service.onModuleDestroy();
      service.initialize();

      const poolLocks = (service as any).poolLocks as Map<string, any>;
      let forceReleased = false;

      poolLocks.set('node-watchdog', {
        promise: new Promise<void>(() => {
          /* never resolves */
        }),
        release: () => {
          forceReleased = true;
        },
        acquiredAt: Date.now() - 200000,
        holder: 'stuck-worker',
        expectedDurationMs: 0,
        staleThreshold: 60000,
        lastHeartbeat: Date.now() - 200000,
      });

      // Advance time to trigger watchdog (30s interval)
      jest.advanceTimersByTime(30001);

      expect(forceReleased).toBe(true);
      expect(poolLocks.has('node-watchdog')).toBe(false);

      jest.useRealTimers();
      service.onModuleDestroy();
      service.initialize(); // Restore real timers watchdog
    });
  });
});
