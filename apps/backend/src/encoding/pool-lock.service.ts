import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

export interface PoolLockHolder {
  promise: Promise<void>;
  release: () => void;
  acquiredAt: number;
  holder: string;
  expectedDurationMs: number;
  staleThreshold: number;
  lastHeartbeat: number;
}

/**
 * PoolLockService
 *
 * Manages mutex locks for worker pool operations with deadlock detection.
 * Provides heartbeat-based stale lock detection and automatic recovery.
 *
 * Extracted from EncodingProcessorService to separate concerns.
 */
@Injectable()
export class PoolLockService implements OnModuleDestroy {
  private readonly logger = new Logger(PoolLockService.name);

  private readonly poolLocks = new Map<string, PoolLockHolder>();
  private lockWatchdogIntervalId?: NodeJS.Timeout;

  private readonly HEARTBEAT_STALE_THRESHOLD = 60000; // 60s without heartbeat = stale
  private readonly WATCHDOG_INTERVAL = 30000; // Check every 30 seconds

  onModuleDestroy() {
    if (this.lockWatchdogIntervalId) {
      clearInterval(this.lockWatchdogIntervalId);
      this.lockWatchdogIntervalId = undefined;
      this.logger.log('Lock watchdog interval cleared');
    }
  }

  /**
   * Clear all locks and start the watchdog.
   * Called during module initialization.
   */
  initialize(): void {
    this.poolLocks.clear();
    this.startLockWatchdog();
  }

  /**
   * Acquire a mutex lock for a node's pool operations.
   *
   * Uses heartbeat-based stale detection and automatic recovery.
   * Retries up to 3 times on timeout.
   *
   * @param nodeId - Node unique identifier
   * @param holder - Lock holder identifier (workerId or operation name)
   * @param timeoutMs - Lock acquisition timeout (default: 30000ms)
   * @param expectedDurationMs - Expected operation duration for long-running ops (default: 0)
   * @throws Error if lock acquisition fails after 3 retries
   */
  async acquire(
    nodeId: string,
    holder: string,
    timeoutMs = 30000,
    expectedDurationMs = 0
  ): Promise<void> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      const existingLock = this.poolLocks.get(nodeId);

      if (existingLock) {
        const now = Date.now();
        const timeSinceHeartbeat = now - existingLock.lastHeartbeat;
        const age = now - existingLock.acquiredAt;

        const isHeartbeatStale = timeSinceHeartbeat > this.HEARTBEAT_STALE_THRESHOLD;
        const isTimeStale = age > existingLock.staleThreshold;

        if (isHeartbeatStale || isTimeStale) {
          const reason = isHeartbeatStale
            ? `no heartbeat for ${timeSinceHeartbeat}ms (threshold: ${this.HEARTBEAT_STALE_THRESHOLD}ms)`
            : `held for ${age}ms (threshold: ${existingLock.staleThreshold}ms)`;
          this.logger.warn(
            `Auto-releasing stale lock for node ${nodeId} (held by ${existingLock.holder}, ${reason})`
          );
          existingLock.release();
          this.poolLocks.delete(nodeId);
          continue;
        }

        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error(`Pool lock timeout for node ${nodeId}`)), timeoutMs);
        });

        try {
          await Promise.race([existingLock.promise, timeoutPromise]);
        } catch (_error) {
          attempt++;
          if (attempt >= maxRetries) {
            throw new Error(
              `Failed to acquire pool lock for ${nodeId} after ${maxRetries} attempts`
            );
          }
          this.logger.warn(
            `Lock timeout attempt ${attempt}/${maxRetries} for ${nodeId}, retrying...`
          );
          continue;
        }
      }

      let releaseLock!: () => void;
      const lockPromise = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      const baseStaleLockThreshold = timeoutMs * 2;
      const staleThreshold = baseStaleLockThreshold + expectedDurationMs;
      const now = Date.now();

      this.poolLocks.set(nodeId, {
        promise: lockPromise,
        release: releaseLock,
        acquiredAt: now,
        holder,
        expectedDurationMs,
        staleThreshold,
        lastHeartbeat: now,
      });

      return;
    }

    throw new Error(`Failed to acquire pool lock for ${nodeId} after ${maxRetries} retries`);
  }

  /**
   * Release a mutex lock for a node.
   */
  release(nodeId: string): void {
    const lockHolder = this.poolLocks.get(nodeId);
    if (lockHolder) {
      lockHolder.release();
      this.poolLocks.delete(nodeId);
    }
  }

  /**
   * Execute a function while holding the pool lock.
   * Ensures the lock is always released, even on error.
   */
  async withLock<T>(
    nodeId: string,
    holder: string,
    fn: () => Promise<T>,
    expectedDurationMs = 0
  ): Promise<T> {
    await this.acquire(nodeId, holder, 30000, expectedDurationMs);
    try {
      return await fn();
    } finally {
      this.release(nodeId);
    }
  }

  /**
   * Periodic watchdog to detect and release deadlocked pool locks.
   * Runs every 30 seconds and forcibly releases locks held beyond their staleThreshold.
   */
  private startLockWatchdog(): void {
    this.lockWatchdogIntervalId = setInterval(() => {
      const now = Date.now();

      for (const [nodeId, lock] of this.poolLocks.entries()) {
        const age = now - lock.acquiredAt;
        const timeSinceHeartbeat = now - lock.lastHeartbeat;

        const isHeartbeatStale = timeSinceHeartbeat > this.HEARTBEAT_STALE_THRESHOLD;
        const isTimeStale = age > lock.staleThreshold;

        if (isHeartbeatStale || isTimeStale) {
          const reason = isHeartbeatStale
            ? `no heartbeat for ${timeSinceHeartbeat}ms`
            : `held for ${age}ms (threshold: ${lock.staleThreshold}ms)`;

          this.logger.error(
            `DEADLOCK DETECTED: Pool lock for ${nodeId} held by ${lock.holder} - ${reason}. Forcibly releasing.`
          );

          lock.release();
          this.poolLocks.delete(nodeId);

          this.logger.warn(`Deadlock resolved for ${nodeId}, lock forcibly released`);
        }
      }
    }, this.WATCHDOG_INTERVAL);

    this.logger.log(
      `Lock watchdog started (interval: ${this.WATCHDOG_INTERVAL}ms, heartbeat threshold: ${this.HEARTBEAT_STALE_THRESHOLD}ms)`
    );
  }
}
