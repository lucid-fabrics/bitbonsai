# BitBonsai Round 4 Audit - Ultra-Comprehensive Analysis

**Audit Date:** 2025-12-31
**Scope:** Complete codebase analysis - concurrency, memory leaks, resource leaks, type safety, logic bugs, security, performance, data consistency
**Previous Rounds:** Round 3 fixed 25/43 issues (all CRITICAL + most HIGH)

---

## Executive Summary

This ultra-comprehensive audit identified **47 issues** across 8 categories:

| Severity | Count | Categories |
|----------|-------|-----------|
| **CRITICAL** | 8 | Race conditions, deadlocks, resource leaks |
| **HIGH** | 15 | Memory leaks, data consistency, performance |
| **MEDIUM** | 18 | Code quality, error handling, type safety |
| **LOW** | 6 | Minor issues, cosmetic improvements |

**High-Risk Areas:**
1. `file-watcher.service.ts` - Unbounded Map growth (CRITICAL)
2. `node-discovery.service.ts` - Memory leak in discovered nodes (HIGH)
3. `notifications.service.ts` - No auto-cleanup mechanism (HIGH)
4. `file-transfer.service.ts` - Race condition in timeout cleanup (CRITICAL)
5. `encoding-processor.service.ts` - Pool lock timeout issues (CRITICAL)
6. `queue.service.ts` - Missing transaction rollback in error paths (HIGH)

---

## CRITICAL Issues (8)

### CRITICAL #1: Unbounded Map Growth in FileWatcherService
**Category:** Memory Leak
**File:** `apps/backend/src/file-watcher/file-watcher.service.ts`
**Lines:** 32, 186-197

**Problem:**
```typescript
private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

// Timers are added but NEVER removed after they fire
const timer = setTimeout(() => {
  this.debounceTimers.delete(debounceKey);  // Good!
  this.createJobForFile(libraryId, filePath);
}, this.debounceMs);

this.debounceTimers.set(debounceKey, timer);

// BUT: If clearTimeout() is called (line 188), the entry is NOT deleted from Map
if (existingTimer) {
  clearTimeout(existingTimer);  // Timer stopped but Map entry remains!
}
```

**Impact:**
- Map grows unbounded with every file detection
- Each cancelled timer leaves orphaned entry in Map
- Large libraries (10,000+ files) = 10,000+ Map entries
- Memory leak compounds over time

**Suggested Fix:**
```typescript
private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

private handleFileChange(libraryId: string, filePath: string): void {
  const debounceKey = `${libraryId}:${filePath}`;
  const existingTimer = this.debounceTimers.get(debounceKey);

  if (existingTimer) {
    clearTimeout(existingTimer);
    this.debounceTimers.delete(debounceKey); // CRITICAL FIX: Remove from Map
  }

  const timer = setTimeout(() => {
    this.debounceTimers.delete(debounceKey);
    this.createJobForFile(libraryId, filePath);
  }, this.debounceMs);

  this.debounceTimers.set(debounceKey, timer);
}

// ALSO: Add cleanup on module destroy
async onModuleDestroy() {
  for (const timer of this.debounceTimers.values()) {
    clearTimeout(timer);
  }
  this.debounceTimers.clear();
}
```

---

### CRITICAL #2: Race Condition in File Transfer Timeout Cleanup
**Category:** Race Condition / Resource Leak
**File:** `apps/backend/src/queue/services/file-transfer.service.ts`
**Lines:** 370-445

**Problem:**
```typescript
private async executeRemoteCommand(): Promise<string> {
  let timeout: NodeJS.Timeout | null = null;
  let forceKillTimeout: NodeJS.Timeout | null = null;

  const cleanup = () => {
    if (timeout) clearTimeout(timeout);           // Line 371
    if (forceKillTimeout) clearTimeout(forceKillTimeout); // Line 372
    // ... kill process ...
  };

  try {
    return await new Promise<string>((resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        ssh.kill('SIGTERM');

        forceKillTimeout = setTimeout(() => {      // Line 392
          if (!ssh.killed) {
            ssh.kill('SIGKILL');
          }
        }, 5000);

        reject(new Error('SSH command timed out'));  // Line 398
      }, timeoutMs);

      ssh.on('close', (code) => {
        if (timeout) clearTimeout(timeout);         // Line 414
        if (forceKillTimeout) clearTimeout(forceKillTimeout); // Line 415
        // RACE: If timeout fired at line 392 and promise rejected at 398,
        // but 'close' fires before forceKillTimeout executes (within 5s window),
        // we clear forceKillTimeout BUT it might not exist yet!
        // Result: forceKillTimeout fires AFTER cleanup, orphaned timer!
      });
    });
  } finally {
    cleanup();  // Line 445 - RACE: May execute before forceKillTimeout is set
  }
}
```

**Impact:**
- Orphaned `forceKillTimeout` continues running after Promise resolves
- Each transfer attempt leaks a 5-second timer
- Under heavy load (100+ transfers), accumulates hundreds of orphaned timers
- Potential process zombie accumulation if SIGKILL never fires

**Suggested Fix:**
```typescript
private async executeRemoteCommand(): Promise<string> {
  let timeout: NodeJS.Timeout | null = null;
  let forceKillTimeout: NodeJS.Timeout | null = null;
  let cleanupExecuted = false;

  const cleanup = () => {
    if (cleanupExecuted) return; // Prevent double cleanup
    cleanupExecuted = true;

    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    if (forceKillTimeout) {
      clearTimeout(forceKillTimeout);
      forceKillTimeout = null;
    }
    if (!ssh.killed) {
      ssh.kill('SIGKILL');
    }
    ssh.stdout?.destroy();
    ssh.stderr?.destroy();
  };

  try {
    return await new Promise<string>((resolve, reject) => {
      timeout = setTimeout(() => {
        const timedOut = true;
        ssh.kill('SIGTERM');

        // Use immediate to ensure forceKillTimeout is set before any cleanup
        forceKillTimeout = setTimeout(() => {
          if (!ssh.killed && !cleanupExecuted) {
            ssh.kill('SIGKILL');
          }
        }, 5000);

        reject(new Error('SSH command timed out'));
      }, timeoutMs);

      ssh.on('close', (code) => {
        cleanup(); // Cleanup will now safely clear forceKillTimeout if set

        if (timedOut) return; // Already rejected

        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`SSH command failed with code ${code}: ${stderr}`));
        }
      });

      ssh.on('error', (error) => {
        cleanup();
        if (!timedOut) reject(error);
      });
    });
  } finally {
    cleanup(); // Safe idempotent cleanup
  }
}
```

---

### CRITICAL #3: Pool Lock Starvation and Deadlock Risk
**Category:** Deadlock / Race Condition
**File:** `apps/backend/src/encoding/encoding-processor.service.ts`
**Lines:** 982-1026

**Problem:**
```typescript
private async acquirePoolLock(nodeId: string, timeoutMs = 30000): Promise<void> {
  const existingLock = this.poolLocks.get(nodeId);
  if (existingLock) {
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error(`Pool lock timeout for node ${nodeId}`)), timeoutMs);
    });

    try {
      await Promise.race([existingLock, timeoutPromise]);
    } catch (error) {
      // ISSUE 1: Force clear stale lock BUT...
      this.poolLocks.delete(nodeId);
      // ISSUE 2: ...other waiters are NOT notified!
      // They'll wait for a lock that was just deleted
    }
  }

  // ISSUE 3: Create new lock BEFORE checking if previous lock was cleared
  let releaseLock!: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  const lockWithRelease = lockPromise as LockPromise;
  lockWithRelease.release = releaseLock;
  this.poolLocks.set(nodeId, lockWithRelease);
  // ISSUE 4: Lock is set but never auto-released if holder crashes
}

// ISSUE 5: withPoolLock catches errors but doesn't handle lock holder crash
private async withPoolLock<T>(nodeId: string, fn: () => Promise<T>): Promise<T> {
  await this.acquirePoolLock(nodeId);
  try {
    return await fn();
  } finally {
    this.releasePoolLock(nodeId); // Works only if fn() completes
    // ISSUE 6: If process crashes during fn(), lock is NEVER released
  }
}
```

**Impact:**
- Deadlock scenario: Worker A holds lock, crashes → lock never released → Worker B waits forever
- Timeout "fix" creates race: Deletes lock but doesn't notify other waiters
- Multiple workers can acquire "lock" simultaneously after timeout clears it
- Pool corruption: Concurrent modifications to worker pool state

**Suggested Fix:**
```typescript
private readonly poolLockHolders = new Map<string, {
  promise: Promise<void>;
  release: () => void;
  acquiredAt: number;
  holder: string; // For debugging
}>();

private async acquirePoolLock(nodeId: string, holder: string, timeoutMs = 30000): Promise<void> {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    const existingLock = this.poolLockHolders.get(nodeId);

    if (existingLock) {
      const age = Date.now() - existingLock.acquiredAt;

      // Auto-release stale locks (held > 2 * timeout)
      if (age > timeoutMs * 2) {
        this.logger.warn(
          `Force releasing stale lock for node ${nodeId} (held by ${existingLock.holder} for ${age}ms)`
        );
        existingLock.release();
        this.poolLockHolders.delete(nodeId);
        continue; // Retry acquire
      }

      // Wait for lock with timeout
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error(`Pool lock timeout for node ${nodeId}`)), timeoutMs);
      });

      try {
        await Promise.race([existingLock.promise, timeoutPromise]);
      } catch (error) {
        attempt++;
        if (attempt >= maxRetries) {
          throw new Error(`Failed to acquire pool lock for ${nodeId} after ${maxRetries} attempts`);
        }
        this.logger.warn(`Lock timeout attempt ${attempt}/${maxRetries} for ${nodeId}`);
        continue; // Retry
      }
    }

    // Acquire lock
    let releaseLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.poolLockHolders.set(nodeId, {
      promise: lockPromise,
      release: releaseLock,
      acquiredAt: Date.now(),
      holder,
    });

    return; // Lock acquired successfully
  }

  throw new Error(`Failed to acquire pool lock for ${nodeId} after ${maxRetries} retries`);
}

private releasePoolLock(nodeId: string): void {
  const lockHolder = this.poolLockHolders.get(nodeId);
  if (lockHolder) {
    lockHolder.release();
    this.poolLockHolders.delete(nodeId);
  }
}

// Periodic cleanup of stale locks
private startLockWatchdog(): void {
  setInterval(() => {
    const now = Date.now();
    const staleLockThreshold = 60000; // 1 minute

    for (const [nodeId, lock] of this.poolLockHolders.entries()) {
      if (now - lock.acquiredAt > staleLockThreshold) {
        this.logger.error(
          `DEADLOCK DETECTED: Lock for ${nodeId} held by ${lock.holder} for ${now - lock.acquiredAt}ms`
        );
        lock.release();
        this.poolLockHolders.delete(nodeId);
      }
    }
  }, 30000); // Check every 30s
}
```

---

### CRITICAL #4: Unbounded Growth in NotificationsService
**Category:** Memory Leak
**File:** `apps/backend/src/notifications/notifications.service.ts`
**Lines:** 21, 43, 62-67

**Problem:**
```typescript
private readonly notifications: Map<string, Notification> = new Map();
private readonly EXPIRATION_HOURS = 24;

async createNotification(dto: CreateNotificationDto): Promise<Notification> {
  const notification: Notification = {
    id: randomUUID(),
    expiresAt: new Date(Date.now() + this.EXPIRATION_HOURS * 60 * 60 * 1000),
    // ...
  };

  this.notifications.set(notification.id, notification);
  // ISSUE: Never cleaned up automatically! Map grows forever.
  return notification;
}

async getNotifications(includeRead = true): Promise<Notification[]> {
  const now = new Date();

  // ISSUE: Filters expired notifications but DOESN'T DELETE THEM from Map!
  const active = Array.from(this.notifications.values()).filter(
    (n) => n.expiresAt > now && (includeRead || !n.read)
  );
  // Expired notifications remain in memory indefinitely

  return active.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// ISSUE: No onModuleInit() or cleanup interval to purge expired entries
```

**Impact:**
- Every notification created is stored forever in memory
- With 100 notifications/day × 365 days = 36,500 Map entries after 1 year
- Each notification ~500 bytes → 18MB wasted memory
- High-traffic systems: 1000 notifications/day = 180MB/year
- Map lookups slow down as size increases (O(n) iteration)

**Suggested Fix:**
```typescript
export class NotificationsService implements OnModuleInit {
  private readonly notifications: Map<string, Notification> = new Map();
  private readonly EXPIRATION_HOURS = 24;
  private cleanupIntervalId?: NodeJS.Timeout;

  onModuleInit() {
    // Start cleanup interval - purge expired every 10 minutes
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpiredNotifications();
    }, 10 * 60 * 1000);

    this.logger.log('✅ Notification cleanup interval started (10 min)');
  }

  onModuleDestroy() {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = undefined;
    }
    this.notifications.clear();
  }

  private cleanupExpiredNotifications(): void {
    const now = new Date();
    let removed = 0;

    for (const [id, notification] of this.notifications.entries()) {
      if (notification.expiresAt <= now) {
        this.notifications.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug(`🧹 Cleaned up ${removed} expired notifications`);
    }
  }

  async getNotifications(includeRead = true): Promise<Notification[]> {
    const now = new Date();

    // Filter active notifications (lazy cleanup)
    const active = Array.from(this.notifications.values()).filter((n) => {
      if (n.expiresAt <= now) {
        this.notifications.delete(n.id); // Lazy cleanup during read
        return false;
      }
      return includeRead || !n.read;
    });

    return active.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}
```

---

### CRITICAL #5: Unbounded Growth in NodeDiscoveryService
**Category:** Memory Leak
**File:** `apps/backend/src/discovery/node-discovery.service.ts`
**Lines:** 54, 185, 200-260

**Problem:**
```typescript
private discoveredNodes: Map<string, DiscoveredNode> = new Map();

async scanForMainNodes(): Promise<DiscoveredNode[]> {
  this.discoveredNodes.clear(); // Good! Clears before scan

  return new Promise((resolve, reject) => {
    this.browser = this.bonjour?.find({ type: 'bitbonsai' }) ?? null;

    const _timeout = setTimeout(() => {
      if (this.browser) {
        this.browser.stop();
      }
      resolve(Array.from(this.discoveredNodes.values()));
    }, 5000);

    if (!this.browser) {
      // ISSUE 1: Timeout never cleared if browser creation fails
      reject(new Error('Failed to create mDNS browser'));
      return;
    }

    this.browser.on('up', (service: RemoteService) => {
      // ISSUE 2: Nodes added to Map continuously during scan
      const node: DiscoveredNode = { /* ... */ };
      this.discoveredNodes.set(service.txt?.nodeId || service.name, node);
    });

    this.browser.on('error', (error) => {
      // ISSUE 3: Timeout never cleared on error
      reject(error);
    });
  });
}

// ISSUE 4: If multiple scans run concurrently (user spam-clicks "Scan"),
// each creates a new browser but previous browsers are never stopped
// Result: Multiple mDNS browsers running simultaneously, leaking memory

// ISSUE 5: If scan promise rejects, timeout continues running
// Timeout calls browser.stop() on already-failed browser (harmless but wasteful)
```

**Impact:**
- Concurrent scans create multiple mDNS browsers that leak memory
- Timeouts never cleared on error paths → orphaned timers
- Browser event listeners accumulate without cleanup
- Under network issues: Repeated scan failures = leaked resources

**Suggested Fix:**
```typescript
private discoveredNodes: Map<string, DiscoveredNode> = new Map();
private activeScan: Promise<DiscoveredNode[]> | null = null;
private scanTimeoutId: NodeJS.Timeout | null = null;

async scanForMainNodes(): Promise<DiscoveredNode[]> {
  // Prevent concurrent scans
  if (this.activeScan) {
    this.logger.warn('Scan already in progress, returning existing promise');
    return this.activeScan;
  }

  this.logger.log('🔍 Scanning for MAIN nodes on network...');
  this.discoveredNodes.clear();

  this.activeScan = new Promise((resolve, reject) => {
    try {
      // Stop any existing browser
      if (this.browser) {
        this.browser.stop();
        this.browser = null;
      }

      this.browser = this.bonjour?.find({ type: 'bitbonsai' }) ?? null;

      if (!this.browser) {
        reject(new Error('Failed to create mDNS browser'));
        return;
      }

      this.scanTimeoutId = setTimeout(() => {
        this.scanTimeoutId = null;
        if (this.browser) {
          this.browser.stop();
          this.browser = null;
        }
        this.logger.log(`✅ Scan complete - found ${this.discoveredNodes.size} node(s)`);
        resolve(Array.from(this.discoveredNodes.values()));
      }, 5000);

      this.browser.on('up', (service: RemoteService) => {
        const node: DiscoveredNode = { /* ... */ };
        this.discoveredNodes.set(service.txt?.nodeId || service.name, node);
      });

      this.browser.on('error', (error) => {
        this.cleanup();
        reject(error);
      });
    } catch (error) {
      this.cleanup();
      reject(error);
    }
  }).finally(() => {
    this.activeScan = null;
    this.cleanup();
  });

  return this.activeScan;
}

private cleanup(): void {
  if (this.scanTimeoutId) {
    clearTimeout(this.scanTimeoutId);
    this.scanTimeoutId = null;
  }
  if (this.browser) {
    this.browser.stop();
    this.browser = null;
  }
}
```

---

### CRITICAL #6: Race Condition in Job Stage Transitions
**Category:** Race Condition / Data Consistency
**File:** `apps/backend/src/queue/queue.service.ts`
**Lines:** 837-900 (claimNextJob)

**Problem:**
```typescript
async claimNextJob(nodeId: string): Promise<Job | null> {
  const result = await this.prisma.$transaction(
    async (tx) => {
      // STEP 1: Find next job (read)
      const nextJob = await tx.job.findFirst({
        where: {
          nodeId,
          stage: JobStage.QUEUED,
          // ... other filters
        },
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'asc' },
        ],
      });

      if (!nextJob) {
        return null;
      }

      // STEP 2: Update job (write)
      const updatedJob = await tx.job.update({
        where: { id: nextJob.id },
        data: {
          stage: JobStage.ENCODING,
          startedAt: new Date(),
          // ...
        },
      });

      return updatedJob;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      // ISSUE: ReadCommitted allows phantom reads!
      // Another transaction can claim the SAME job between findFirst and update
    }
  );

  return result;
}
```

**Race Condition Scenario:**
```
Time  Worker A                          Worker B
----  --------------------------------  --------------------------------
T0    BEGIN TRANSACTION
T1    findFirst() → Job X (QUEUED)
T2                                      BEGIN TRANSACTION
T3                                      findFirst() → Job X (QUEUED)  ← PHANTOM READ!
T4    update Job X → ENCODING
T5    COMMIT
T6                                      update Job X → ENCODING  ← CONFLICT!
T7                                      COMMIT
```

**Impact:**
- Two workers can claim the same job simultaneously
- Results in duplicate encoding of same file
- Wastes CPU resources on redundant work
- Database constraint violation if job has unique constraints
- Data corruption: job.startedAt overwritten by second worker

**Suggested Fix:**
```typescript
async claimNextJob(nodeId: string): Promise<Job | null> {
  const result = await this.prisma.$transaction(
    async (tx) => {
      // ATOMIC: Find and update in single query to prevent race
      // Use updateMany with WHERE clause that re-checks stage
      const updated = await tx.job.updateMany({
        where: {
          nodeId,
          stage: JobStage.QUEUED, // Re-verify stage during update
          // Use a subquery to get the FIRST eligible job
          id: {
            in: await tx.job
              .findFirst({
                where: {
                  nodeId,
                  stage: JobStage.QUEUED,
                  // ... filters
                },
                select: { id: true },
                orderBy: [
                  { priority: 'desc' },
                  { createdAt: 'asc' },
                ],
              })
              .then((job) => (job ? [job.id] : [])),
          },
        },
        data: {
          stage: JobStage.ENCODING,
          startedAt: new Date(),
          // ...
        },
      });

      if (updated.count === 0) {
        return null; // Job already claimed by another worker
      }

      // Fetch the updated job
      const job = await tx.job.findFirst({
        where: {
          nodeId,
          stage: JobStage.ENCODING,
          startedAt: { gte: new Date(Date.now() - 1000) }, // Within last second
        },
        orderBy: { startedAt: 'desc' },
      });

      return job;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      // Use Serializable to prevent phantom reads
    }
  );

  return result;
}

// BETTER ALTERNATIVE: Use PostgreSQL-specific advisory locks
async claimNextJob(nodeId: string): Promise<Job | null> {
  return this.prisma.$transaction(async (tx) => {
    // Acquire advisory lock for this node's job queue
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${nodeId}))`;

    const nextJob = await tx.job.findFirst({
      where: { nodeId, stage: JobStage.QUEUED /* ... */ },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    if (!nextJob) {
      return null;
    }

    const updatedJob = await tx.job.update({
      where: { id: nextJob.id },
      data: {
        stage: JobStage.ENCODING,
        startedAt: new Date(),
        // ...
      },
    });

    return updatedJob;
    // Advisory lock auto-released on transaction commit
  });
}
```

---

### CRITICAL #7: Unhandled Promise Rejection in Worker Loop
**Category:** Error Handling / Resource Leak
**File:** `apps/backend/src/encoding/encoding-processor.service.ts`
**Lines:** 1164

**Problem:**
```typescript
// Start processing loop (fire and forget - runs in background)
this.processLoop(workerId).catch((error) => {
  this.logger.error(`[${workerId}] Worker crashed:`, error);

  // CLEANUP: Remove worker from tracking
  const pool = this.workerPools.get(nodeId);
  if (pool) {
    pool.activeWorkers.delete(workerId);
  }
  this.workers.delete(workerId);

  // ISSUE 1: If job is currently encoding, FFmpeg process is NOT killed
  const worker = this.workers.get(workerId); // Already deleted above!
  // worker.currentJobId is now inaccessible

  // ISSUE 2: Job remains in ENCODING stage indefinitely
  // Stuck job watchdog must eventually recover it (5+ minutes)

  // ISSUE 3: Worker pool count decremented but not replaced
  // If maxWorkers = 4 and worker crashes, only 3 workers remain

  if (worker.shutdownResolve) {
    worker.shutdownResolve();
  }
});
```

**Impact:**
- Worker crash leaves job in ENCODING stage → stuck job
- FFmpeg process continues running as zombie → resource leak
- Worker pool permanently reduced (4 workers → 3 → 2 → ...)
- System degradation over time as workers crash
- Eventual complete halt if all workers crash

**Suggested Fix:**
```typescript
// Start processing loop with comprehensive error recovery
this.processLoop(workerId).catch(async (error) => {
  this.logger.error(`[${workerId}] Worker crashed:`, error);

  const worker = this.workers.get(workerId);
  const pool = this.workerPools.get(nodeId);

  if (!worker || !pool) {
    this.logger.error(`[${workerId}] Worker or pool not found during crash cleanup`);
    return;
  }

  // CRITICAL FIX 1: Kill active FFmpeg process if encoding
  if (worker.currentJobId) {
    this.logger.warn(`[${workerId}] Killing orphaned FFmpeg for job ${worker.currentJobId}`);

    try {
      await this.ffmpegService.killEncoding(worker.currentJobId);
    } catch (killError) {
      this.logger.error(
        `[${workerId}] Failed to kill FFmpeg for job ${worker.currentJobId}`,
        killError
      );
    }

    // CRITICAL FIX 2: Reset job to QUEUED for retry
    try {
      await this.prisma.job.update({
        where: { id: worker.currentJobId },
        data: {
          stage: JobStage.QUEUED,
          error: `Worker ${workerId} crashed during encoding`,
          retryCount: { increment: 1 },
        },
      });
      this.logger.log(`[${workerId}] Reset job ${worker.currentJobId} to QUEUED`);
    } catch (jobError) {
      this.logger.error(
        `[${workerId}] Failed to reset job ${worker.currentJobId}`,
        jobError
      );
    }
  }

  // CLEANUP: Remove worker from tracking
  pool.activeWorkers.delete(workerId);
  this.workers.delete(workerId);

  // Resolve shutdown promise
  if (worker.shutdownResolve) {
    worker.shutdownResolve();
  }

  // CRITICAL FIX 3: Restart worker to maintain pool size
  const remainingWorkers = pool.activeWorkers.size;
  if (remainingWorkers < pool.maxWorkers) {
    this.logger.warn(
      `[${nodeId}] Worker pool degraded to ${remainingWorkers}/${pool.maxWorkers}, restarting worker`
    );

    try {
      // Start replacement worker
      const newWorkerId = `${nodeId}-worker-${Date.now()}`;
      await this.startWorker(nodeId, newWorkerId);
      this.logger.log(`[${nodeId}] Replacement worker ${newWorkerId} started`);
    } catch (restartError) {
      this.logger.error(
        `[${nodeId}] Failed to restart worker after crash`,
        restartError
      );
    }
  }

  this.logger.log(`[${workerId}] Worker cleanup complete after crash`);
});
```

---

### CRITICAL #8: Missing Database Transaction Rollback
**Category:** Data Consistency
**File:** `apps/backend/src/queue/queue.service.ts`
**Lines:** 2541-2650 (completeJob)

**Problem:**
```typescript
async completeJob(id: string, dto: CompleteJobDto): Promise<Job> {
  const completedJob = await this.prisma.$transaction(async (tx) => {
    // STEP 1: Update job
    const job = await tx.job.update({
      where: { id },
      data: {
        stage: JobStage.COMPLETED,
        afterSizeBytes: BigInt(dto.afterSizeBytes),
        // ... 20+ field updates
      },
    });

    // STEP 2: Update node stats
    await tx.node.update({
      where: { id: job.nodeId },
      data: {
        totalJobsCompleted: { increment: 1 },
        totalBytesSaved: { increment: job.savedBytes || BigInt(0) },
      },
    });

    // STEP 3: Update library stats
    await tx.library.update({
      where: { id: job.libraryId },
      data: {
        totalSizeBytes: { increment: -(job.savedBytes || BigInt(0)) },
      },
    });

    // STEP 4: Create job history record
    await tx.jobHistory.create({
      data: {
        jobId: job.id,
        eventType: JobEventType.COMPLETED,
        // ...
      },
    });

    return job;
  });

  // ISSUE 1: No try-catch around transaction!
  // If any step fails, transaction auto-rollbacks BUT error propagates
  // uncaught to caller, potentially crashing request handler

  // ISSUE 2: External side effects OUTSIDE transaction
  try {
    // Delete temp files
    if (completedJob.tempFilePath) {
      await fs.promises.unlink(completedJob.tempFilePath);
      // ISSUE: If this fails, job marked COMPLETED but temp file remains
      // Disk space leak accumulates over time
    }

    // Delete preview images
    if (completedJob.previewImagePaths) {
      const paths = JSON.parse(completedJob.previewImagePaths);
      await Promise.all(paths.map((p: string) => fs.promises.unlink(p)));
      // ISSUE: If ANY preview deletion fails, ALL remaining previews leak
    }

    // Trigger external integrations (Plex, Radarr, etc.)
    await this.triggerExternalIntegrations(completedJob);
    // ISSUE: If integration fails, job still marked COMPLETED
    // User expects Plex refresh but it never happens
  } catch (cleanupError) {
    // ISSUE 3: Cleanup errors are logged but job remains COMPLETED
    this.logger.error(`Cleanup failed for job ${id}`, cleanupError);
    // Should we mark job as COMPLETED_WITH_ERRORS?
    // Should we retry cleanup?
  }

  return completedJob;
}
```

**Impact:**
- Database inconsistency if transaction step fails (rare but possible)
- Temp file accumulation if deletion fails (disk space leak)
- Preview images leak if deletion fails
- External integrations silently fail without user notification
- No way to detect or recover from cleanup failures

**Suggested Fix:**
```typescript
async completeJob(id: string, dto: CompleteJobDto): Promise<Job> {
  let completedJob: Job;

  try {
    // PHASE 1: Database updates (atomic transaction)
    completedJob = await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.update({
        where: { id },
        data: {
          stage: JobStage.COMPLETED,
          afterSizeBytes: BigInt(dto.afterSizeBytes),
          // ... field updates
        },
      });

      await tx.node.update({
        where: { id: job.nodeId },
        data: {
          totalJobsCompleted: { increment: 1 },
          totalBytesSaved: { increment: job.savedBytes || BigInt(0) },
        },
      });

      await tx.library.update({
        where: { id: job.libraryId },
        data: {
          totalSizeBytes: { increment: -(job.savedBytes || BigInt(0)) },
        },
      });

      await tx.jobHistory.create({
        data: {
          jobId: job.id,
          eventType: JobEventType.COMPLETED,
          stage: job.stage,
          progress: job.progress,
        },
      });

      return job;
    });
  } catch (txError) {
    this.logger.error(`Transaction failed for job ${id}`, txError);
    throw new Error(`Failed to mark job as completed: ${txError.message}`);
  }

  // PHASE 2: File cleanup (best effort, non-atomic)
  const cleanupErrors: string[] = [];

  // Cleanup temp file
  if (completedJob.tempFilePath) {
    try {
      await fs.promises.unlink(completedJob.tempFilePath);
      this.logger.debug(`Deleted temp file: ${completedJob.tempFilePath}`);
    } catch (error) {
      const msg = `Failed to delete temp file ${completedJob.tempFilePath}: ${error.message}`;
      cleanupErrors.push(msg);
      this.logger.error(msg);
    }
  }

  // Cleanup preview images
  if (completedJob.previewImagePaths) {
    try {
      const paths: string[] = JSON.parse(completedJob.previewImagePaths);
      const results = await Promise.allSettled(
        paths.map((p) => fs.promises.unlink(p))
      );

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const msg = `Failed to delete preview ${paths[index]}: ${result.reason}`;
          cleanupErrors.push(msg);
          this.logger.error(msg);
        }
      });
    } catch (error) {
      const msg = `Failed to parse preview paths: ${error.message}`;
      cleanupErrors.push(msg);
      this.logger.error(msg);
    }
  }

  // PHASE 3: External integrations (fire and forget, async)
  this.triggerExternalIntegrations(completedJob).catch((error) => {
    this.logger.error(
      `External integration failed for job ${id} (already completed)`,
      error
    );
    // Optionally: Create notification for user
    this.notificationsService.createNotification({
      type: 'WARNING',
      priority: 'MEDIUM',
      title: 'Integration Failed',
      message: `Failed to refresh media servers for: ${completedJob.fileLabel}`,
      data: { jobId: id, error: error.message },
    });
  });

  // If cleanup had errors, update job with warning
  if (cleanupErrors.length > 0) {
    await this.prisma.job.update({
      where: { id },
      data: {
        warning: `Completed but cleanup failed: ${cleanupErrors.join('; ')}`,
      },
    });
  }

  return completedJob;
}
```

---

## HIGH Priority Issues (15)

### HIGH #1: Missing Interval Cleanup in FileWatcherService
**Category:** Resource Leak
**File:** `apps/backend/src/file-watcher/file-watcher.service.ts`
**Lines:** 60-73

**Problem:**
No `onModuleDestroy()` lifecycle hook to stop file watchers when service is destroyed.

**Impact:**
- Watchers continue running after hot reload
- Multiple watchers created for same directory
- File system events trigger multiple times

**Suggested Fix:**
```typescript
async onModuleDestroy() {
  this.logger.log('Stopping all file watchers...');

  for (const timer of this.debounceTimers.values()) {
    clearTimeout(timer);
  }
  this.debounceTimers.clear();

  for (const [libraryId, watcher] of this.watchers.entries()) {
    try {
      await watcher.close();
      this.logger.log(`Stopped watcher for library ${libraryId}`);
    } catch (error) {
      this.logger.error(`Failed to stop watcher for library ${libraryId}`, error);
    }
  }
  this.watchers.clear();
}
```

---

### HIGH #2: Race Condition in Discovery Scanner Timeout
**Category:** Race Condition
**File:** `apps/backend/src/discovery/node-discovery.service.ts`
**Lines:** 192

**Problem:**
Timeout is created but never stored/cleared, leading to potential race condition.

```typescript
const _timeout = setTimeout(() => {
  if (this.browser) {
    this.browser.stop();
  }
  resolve(Array.from(this.discoveredNodes.values()));
}, 5000);

// ISSUE: Timeout not cleared if promise rejects early
// Unused variable name '_timeout' suggests intentional ignore
```

**Suggested Fix:**
See CRITICAL #5 for comprehensive fix.

---

### HIGH #3: Missing Error Handling in processLoop
**Category:** Error Handling
**File:** `apps/backend/src/encoding/encoding-processor.service.ts`
**Lines:** 1300-1450 (processLoop method)

**Problem:**
Worker loop may throw unhandled errors in edge cases, causing silent worker death.

**Suggested Fix:**
```typescript
private async processLoop(workerId: string): Promise<void> {
  const worker = this.workers.get(workerId);
  if (!worker) return;

  this.logger.log(`[${workerId}] Worker started`);

  while (worker.isRunning) {
    try {
      // Check load throttling
      const shouldThrottle = await this.checkLoadThrottling();
      if (shouldThrottle) {
        await this.sleep(this.THROTTLE_CHECK_INTERVAL_MS);
        continue;
      }

      // Get next job
      const job = await this.getNextJob(worker.nodeId);
      if (!job) {
        await this.sleep(5000);
        continue;
      }

      // Process job
      worker.currentJobId = job.id;

      try {
        await this.processJob(job);
      } catch (jobError) {
        this.logger.error(`[${workerId}] Job ${job.id} failed`, jobError);
        // Job error handled in processJob, continue to next job
      } finally {
        worker.currentJobId = null;
      }

    } catch (loopError) {
      // CRITICAL: Catch errors in loop iteration itself
      this.logger.error(
        `[${workerId}] Error in worker loop iteration`,
        loopError
      );

      // Back off to prevent tight error loop
      await this.sleep(10000);
    }
  }

  this.logger.log(`[${workerId}] Worker stopped gracefully`);
}
```

---

### HIGH #4-15: Additional Issues

Due to space constraints, listing remaining HIGH priority issues:

4. **Missing cleanup in FFmpeg stderr cache** - `ffmpeg.service.ts:232` - Cache grows unbounded if cleanup interval fails to start
5. **Race condition in rsync transfer progress** - `file-transfer.service.ts:220` - Multiple progress updates can overlap
6. **Missing transaction isolation in updateJob** - `queue.service.ts:1158` - Lost update problem possible
7. **Unbounded retry loop in health check** - `health-check.worker.ts:362` - No maximum retry cap
8. **Memory leak in active encodings map** - `ffmpeg.service.ts:324` - Entries not removed on crash
9. **Missing cleanup in encoding preview service** - `encoding-preview.service.ts:90` - Timeouts not tracked
10. **Race condition in worker pool resize** - `encoding-processor.service.ts:1046` - Concurrent resize operations conflict
11. **Missing index on jobs.updatedAt** - `schema.prisma:799` - Already exists but not utilized in all queries
12. **N+1 query in library scan** - `libraries.service.ts:594` - Could batch job lookups
13. **Missing connection pool limits** - Prisma config - Could exhaust database connections
14. **Inefficient polling in stuck job recovery** - `stuck-job-recovery.worker.ts:273` - Fixed interval regardless of load
15. **Missing rate limiting on API endpoints** - All controllers - No throttling on expensive operations

---

## MEDIUM Priority Issues (18)

### MEDIUM #1: Weak Path Validation in FileTransferService
**Category:** Security
**File:** `apps/backend/src/queue/services/file-transfer.service.ts`
**Lines:** 40-47

**Problem:**
```typescript
private validateRsyncPath(path: string): void {
  if (!/^[a-zA-Z0-9/_\-. ()]+$/.test(path)) {
    throw new Error('Invalid path characters detected');
  }
  // ISSUE: Allows spaces and parentheses which can cause rsync escaping issues
  // ISSUE: Doesn't block null bytes or other control characters
  // ISSUE: Doesn't validate path length (very long paths can cause issues)
}
```

**Suggested Fix:**
```typescript
private validateRsyncPath(path: string): void {
  // Check for null bytes and control characters
  if (/[\x00-\x1F\x7F]/.test(path)) {
    throw new Error('Path contains control characters');
  }

  // Check path length (typical Unix limit is 4096)
  if (path.length > 4096) {
    throw new Error('Path exceeds maximum length');
  }

  // More restrictive character set (add more if needed)
  if (!/^[a-zA-Z0-9/_\-. ]+$/.test(path)) {
    throw new Error('Invalid path characters detected');
  }

  // Additional rsync-specific validation
  if (path.includes('::')) {
    throw new Error('Path contains rsync daemon syntax');
  }
}
```

---

### MEDIUM #2-18: Additional Issues

2. **Type assertion in encoding processor** - `encoding-processor.service.ts:1009` - `as LockPromise` unsafe
3. **Missing null checks in node discovery** - `node-discovery.service.ts:200` - Service txt may be undefined
4. **Incorrect error type in SSH execution** - `file-transfer.service.ts:430` - Error type assertion unsafe
5. **Missing validation in job creation** - `queue.service.ts:248` - File size not validated
6. **Weak codec normalization** - `ffmpeg.service.ts:2445` - Case sensitivity issues
7. **Missing container validation** - `container-compatibility.service.ts:222` - No whitelist of valid containers
8. **Unsafe JSON parsing** - Multiple files - No try-catch around JSON.parse()
9. **Missing rate limiting in health check** - `health-check.worker.ts` - Can spam filesystem
10. **Inefficient map iteration** - `notifications.service.ts:62` - Array.from() creates copy
11. **Missing backup before file replace** - `encoding-processor.service.ts` - Atomic replace can fail
12. **Weak IP validation** - `file-transfer.service.ts:54` - Doesn't validate IPv6
13. **Missing tempfile cleanup on crash** - `encoding-processor.service.ts` - Temp files leak
14. **No validation of FFmpeg flags** - `ffmpeg.service.ts:344` - Whitelist can be bypassed
15. **Missing quota checks** - `queue.service.ts` - No disk space validation before encoding
16. **Weak password hashing config** - `auth` module - bcrypt rounds not specified
17. **Missing CSRF protection** - Controllers - State-changing GET requests possible
18. **No audit logging** - All services - No security event logging

---

## LOW Priority Issues (6)

### LOW #1-6: Minor Issues

1. **Inconsistent logging levels** - Multiple files - Debug vs log vs warn inconsistent
2. **Magic numbers in code** - Some constants not extracted to named variables
3. **TODO comments left in production** - See Grep output - 20+ TODO/FIXME comments
4. **Inconsistent error messages** - Some errors don't include context
5. **Missing JSDoc on public methods** - Some methods lack documentation
6. **Unused imports** - ESLint would catch but not enforced

---

## Performance Audit

### Database Query Performance

**N+1 Queries Detected:**
1. `libraries.service.ts:594` - Loads jobs for each library in loop
2. `queue.service.ts:671` - Loads policy for each job separately
3. `nodes.service.ts:255` - Loads storage shares in separate queries

**Missing Indexes:**
- `Job.lastProgressUpdate` - Used in stuck job detection
- `JobHistory.createdAt` - Used in analytics queries
- `Node.lastHeartbeat` - Used in health checks

**Inefficient Queries:**
- `health-check.worker.ts:321` - Loads full job objects when only IDs needed
- `analytics.service.ts:367` - Aggregation could be pushed to database
- `overview.service.ts:82` - Multiple sequential queries could be single query

---

## Security Audit

### Command Injection Risks

1. **FFmpeg command building** - `ffmpeg.service.ts:1402`
   - Status: PROTECTED by whitelist
   - Risk: LOW (whitelist is comprehensive)

2. **rsync command building** - `file-transfer.service.ts:199`
   - Status: PROTECTED by validation
   - Risk: MEDIUM (validation could be stronger)

3. **SSH command execution** - `file-transfer.service.ts:352`
   - Status: VULNERABLE
   - Risk: HIGH (command not escaped properly)

### SQL Injection Risks

- All queries use Prisma ORM
- Risk: LOW (Prisma prevents SQL injection)
- One raw query: `encoding-processor.service.ts` - uses parameterized query (safe)

### Path Traversal Risks

1. **File path validation** - `queue.service.ts:192`
   - Status: PROTECTED (realpath + startsWith check)
   - Risk: LOW

2. **Rsync path validation** - `file-transfer.service.ts:40`
   - Status: WEAK
   - Risk: MEDIUM

---

## Recommendations

### Immediate Actions (CRITICAL)

1. Fix CRITICAL #1: FileWatcher Map cleanup
2. Fix CRITICAL #2: File transfer timeout race
3. Fix CRITICAL #4: Notifications cleanup
4. Fix CRITICAL #6: Job claiming race condition
5. Add monitoring for Map/Set sizes

### Short-Term (HIGH)

1. Implement proper lifecycle hooks for all services
2. Add comprehensive error handling in worker loops
3. Review and fix all database transactions
4. Add proper cleanup in all services

### Long-Term (Architecture)

1. Consider event sourcing for job state transitions
2. Implement distributed locks (Redis) for multi-node
3. Add comprehensive metrics/monitoring
4. Implement circuit breakers for external integrations
5. Add proper rate limiting and quotas

---

## Testing Recommendations

### Critical Test Scenarios

1. **Concurrent job claiming** - Verify CRITICAL #6 fix
2. **Worker crash recovery** - Verify CRITICAL #7 fix
3. **Memory leak under load** - Run for 24h with monitoring
4. **File transfer timeout scenarios** - Verify CRITICAL #2 fix
5. **Pool lock contention** - Verify CRITICAL #3 fix

### Load Testing

- Target: 1000+ files in single library
- Duration: 24+ hours
- Monitor: Memory, CPU, open file handles, database connections
- Verify: No resource leaks, all jobs complete

---

## Conclusion

This audit identified **47 issues** across the codebase, with **8 CRITICAL** issues requiring immediate attention. The most severe issues involve:

1. **Unbounded memory growth** in Maps (FileWatcher, Notifications, NodeDiscovery)
2. **Race conditions** in concurrent operations (job claiming, file transfer, pool locks)
3. **Resource leaks** (timeouts, processes, file handles)
4. **Missing error recovery** in worker loops

**Priority Order:**
1. Fix all 8 CRITICAL issues (1-2 days)
2. Review and fix HIGH issues (3-5 days)
3. Address MEDIUM issues during regular development
4. LOW issues can be tackled during code cleanup sprints

**Estimated Total Effort:** 10-15 developer days to address all CRITICAL and HIGH issues.
