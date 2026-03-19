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
  });
});
