# Audit Fixes Round 3 - BitBonsai

**Date:** 2025-12-30
**Auditor:** Deep Code Audit (Ultra-Deep Analysis)
**Total Issues:** 43 NEW (12 CRITICAL, 15 HIGH, 11 MEDIUM, 5 LOW)
**Previous Audits:** Round 2 found 29 issues (5 CRITICAL fixed)

---

## CRITICAL FIXES (12)

### CRITICAL #1: Job Claiming Race - Sleep Inside Transaction
**File:** `apps/backend/src/queue/queue.service.ts:935-939`
**Category:** Race Condition + Deadlock

**Problem:**
Retry loop uses `setTimeout` inside transaction, holding database locks for 10-250ms per attempt.

**Code:**
```typescript
// Inside $transaction:
const jitterMs = 10 + Math.random() * 40;
await new Promise((resolve) => setTimeout(resolve, jitterMs));
continue; // ⚠️ Transaction still open, locks still held
```

**Impact:**
- Other workers blocked waiting for locks
- Connection pool exhaustion under load
- Deadlock probability increases exponentially
- 30s timeout makes it worse (holds locks longer)

**Fix:**
```typescript
async claimJobWithRetry(nodeId: string): Promise<Job | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const job = await tx.job.findFirst({
          where: { stage: 'QUEUED', ... },
          orderBy: { priority: 'desc' },
        });

        if (!job) return null;

        const updateResult = await tx.job.updateMany({
          where: {
            id: job.id,
            stage: 'QUEUED', // Optimistic lock
          },
          data: {
            stage: 'ENCODING',
            nodeId,
            claimedAt: new Date(),
          },
        });

        if (updateResult.count === 0) {
          // Lost race - exit transaction immediately
          return { claimFailed: true, jobId: job.id };
        }

        return { claimedJob: job };
      }, {
        maxWait: 5000,
        timeout: 10000,
        isolationLevel: 'ReadCommitted',
      });

      // ✅ Jitter OUTSIDE transaction
      if (result?.claimFailed) {
        await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 40));
        continue;
      }

      return result?.claimedJob || null;
    } catch (error) {
      this.logger.error(`Claim attempt ${attempt + 1} failed:`, error);
      if (attempt === 4) throw error;
    }
  }

  return null;
}
```

---

### CRITICAL #2: Unbounded stderrCache Map Growth
**File:** `apps/backend/src/encoding/ffmpeg.service.ts:115`
**Category:** Memory Leak

**Problem:**
Map grows indefinitely. Cleanup interval defined but NEVER called.

**Code:**
```typescript
private readonly stderrCache = new Map<string, { stderr: string; timestamp: Date }>();
private readonly STDERR_CACHE_TTL_MS = 30 * 60 * 1000;
// ⚠️ NO cleanup method
// ⚠️ NO interval started
```

**Impact:**
- 1000 jobs × 2KB stderr = 2MB
- 100,000 jobs = 200MB leaked
- Eventually OOM crash

**Fix:**
```typescript
private stderrCleanupInterval?: NodeJS.Timeout;

async onModuleInit() {
  // Start cleanup every 15 minutes
  this.stderrCleanupInterval = setInterval(() => {
    this.cleanupStaleStderrCache();
  }, 15 * 60 * 1000);
}

async onModuleDestroy() {
  if (this.stderrCleanupInterval) {
    clearInterval(this.stderrCleanupInterval);
  }
  this.stderrCache.clear();
  this.codecCache.clear();
  this.lastPreviewGeneration.clear();
}

private cleanupStaleStderrCache(): void {
  const now = Date.now();
  let removed = 0;

  for (const [jobId, entry] of this.stderrCache.entries()) {
    if (now - entry.timestamp.getTime() > this.STDERR_CACHE_TTL_MS) {
      this.stderrCache.delete(jobId);
      removed++;
    }
  }

  if (removed > 0) {
    this.logger.debug(`🧹 Cleaned up ${removed} stale stderr cache entries`);
  }
}
```

---

### CRITICAL #3: File Transfer Progress Race Condition
**File:** `apps/backend/src/queue/services/file-transfer.service.ts:257-297`
**Category:** Race Condition

**Problem:**
`pendingUpdate` flag check is not atomic. Multiple stdout events can pass check before flag is set.

**Code:**
```typescript
if (progressState.pendingUpdate) {
  return; // ⚠️ Check and set are NOT atomic
}

progressState.pendingUpdate = true; // Race window here
```

**Impact:**
- Multiple concurrent DB updates
- Connection pool exhaustion
- Transfer aborted due to false DB failure

**Fix:**
```typescript
// Option 1: Atomic flag
const wasUpdating = progressState.pendingUpdate;
progressState.pendingUpdate = true;
if (wasUpdating) {
  return;
}

try {
  await this.prisma.job.update({ ... });
} finally {
  progressState.pendingUpdate = false;
}

// Option 2: Mutex/Semaphore
interface ProgressState {
  percent: number;
  speed: string;
  pendingUpdate: boolean;
  updateLock?: Promise<void>;
}

// In handler:
if (progressState.updateLock) {
  return; // Update already in progress
}

let resolveLock: () => void;
progressState.updateLock = new Promise(resolve => { resolveLock = resolve; });

try {
  await this.prisma.job.update({ ... });
} finally {
  resolveLock!();
  progressState.updateLock = undefined;
}
```

---

### CRITICAL #4: Pool Lock Never Released on Error
**File:** `apps/backend/src/encoding/encoding-processor.service.ts:960-991`
**Category:** Deadlock

**Problem:**
Lock acquired but if exception before `releasePoolLock()`, lock stays forever.

**Code:**
```typescript
await this.acquirePoolLock(nodeId);

// ⚠️ If exception here, lock never released
const pool = this.workerPools.get(nodeId);
// ... work ...

this.releasePoolLock(nodeId); // Never reached on error
```

**Impact:**
- Permanent node lockup after single error
- Requires app restart
- No monitoring detects this

**Fix:**
```typescript
private async withPoolLock<T>(
  nodeId: string,
  fn: () => Promise<T>
): Promise<T> {
  await this.acquirePoolLock(nodeId);
  try {
    return await fn();
  } finally {
    this.releasePoolLock(nodeId); // ALWAYS released
  }
}

// Usage:
async startWorkerPool(nodeId: string, maxWorkers?: number): Promise<number> {
  return await this.withPoolLock(nodeId, async () => {
    // ... pool logic ...
    return workersStarted;
  });
}
```

---

### CRITICAL #5: Watchdog Interval Multiplies on Hot Reload
**File:** `apps/backend/src/encoding/encoding-processor.service.ts:607`
**Category:** Resource Leak

**Problem:**
Hot reload clears old interval ID but interval keeps running. Multiple watchdogs accumulate.

**Code:**
```typescript
if (this.watchdogIntervalId) {
  clearInterval(this.watchdogIntervalId); // Clears local reference
}

this.watchdogIntervalId = setInterval(async () => {
  // ⚠️ Old interval still runs with lost reference
}, 60 * 1000);
```

**Impact:**
- N watchdogs after N reloads
- Database hammered with duplicate queries
- Memory leak from closure references

**Fix:**
```typescript
// Track ALL intervals globally
private static activeIntervals = new Set<NodeJS.Timeout>();

startStuckJobWatchdog() {
  const intervalId = setInterval(async () => {
    await this.checkForStuckJobs();
  }, 60 * 1000);

  this.watchdogIntervalId = intervalId;
  EncodingProcessorService.activeIntervals.add(intervalId);
}

async onModuleDestroy() {
  // Clear current instance
  if (this.watchdogIntervalId) {
    clearInterval(this.watchdogIntervalId);
    EncodingProcessorService.activeIntervals.delete(this.watchdogIntervalId);
  }

  // Safety: Clear ALL tracked intervals
  for (const interval of EncodingProcessorService.activeIntervals) {
    clearInterval(interval);
  }
  EncodingProcessorService.activeIntervals.clear();
}
```

---

### CRITICAL #6: Worker Map Concurrent Modification
**File:** `apps/backend/src/encoding/encoding-processor.service.ts:66-67`
**Category:** Race Condition

**Problem:**
Map iterated while workers delete themselves concurrently.

**Code:**
```typescript
// Thread 1: Iteration
for (const [workerId, worker] of this.workers.entries()) {
  worker.isRunning = false;
}

// Thread 2: Worker deletes itself
this.workers.delete(workerId);
```

**Impact:**
- Undefined errors during iteration
- Workers not stopped
- Graceful shutdown hangs

**Fix:**
```typescript
async stopWorkerPool(nodeId: string): Promise<void> {
  await this.withPoolLock(nodeId, async () => {
    const pool = this.workerPools.get(nodeId);
    if (!pool) return;

    // Snapshot IDs to avoid concurrent modification
    const workerIds = Array.from(pool.activeWorkers);
    const shutdownPromises: Promise<void>[] = [];

    for (const workerId of workerIds) {
      const worker = this.workers.get(workerId);
      if (worker) {
        worker.isRunning = false;
        if (worker.shutdownPromise) {
          shutdownPromises.push(worker.shutdownPromise);
        }
      }
    }

    // Wait for all workers to finish
    await Promise.all(shutdownPromises);

    // NOW safe to delete
    for (const workerId of workerIds) {
      this.workers.delete(workerId);
      pool.activeWorkers.delete(workerId);
    }
  });
}
```

---

### CRITICAL #7: Job Attribution Cache Write Race
**File:** `apps/backend/src/nodes/services/job-attribution.service.ts:117-142`
**Category:** Race Condition

**Problem:**
Cache written AFTER lock released. Two workers can both calculate and write different cache values.

**Impact:**
- Duplicate database queries
- Cache thrashing
- Inconsistent scoring

**Fix:**
```typescript
async calculateNodeScore(node: Node & { _count: { jobs: number } }): Promise<NodeScore> {
  // Check cache
  const cached = this.scoreCache.get(node.id);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.score;
  }

  // Check existing lock
  const existingLock = this.scoreLocks.get(node.id);
  if (existingLock) {
    return existingLock;
  }

  // Start calculation
  const calculationPromise = this.performScoreCalculation(node);
  this.scoreLocks.set(node.id, calculationPromise);

  try {
    const score = await calculationPromise;

    // ✅ Write cache WHILE holding lock
    this.scoreCache.set(node.id, {
      score,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });

    return score;
  } finally {
    this.scoreLocks.delete(node.id);
  }
}
```

---

### CRITICAL #8: setImmediate Inside Transaction Scope
**File:** `apps/backend/src/queue/queue.service.ts:902-909`
**Category:** Data Consistency

**Problem:**
File transfer starts before transaction commits. If rollback, transfer runs with invalid data.

**Code:**
```typescript
await tx.job.update({
  data: {
    transferRequired: true,
    stage: JobStage.DETECTED,
  },
});

setImmediate(() => {
  this.fileTransferService.transferFile(...) // ⚠️ Tx might rollback
});
```

**Impact:**
- Transfer for non-existent job
- Wasted bandwidth
- Corrupted job state

**Fix:**
```typescript
// Collect transfers outside transaction
const pendingTransfers: Array<TransferRequest> = [];

if (sourceNode) {
  pendingTransfers.push({
    jobId: job.id,
    filePath: job.filePath,
    source: sourceNode,
    target: node,
  });
}

// AFTER transaction commits
if (claimedJob && pendingTransfers.length > 0) {
  setImmediate(() => {
    for (const transfer of pendingTransfers) {
      this.fileTransferService
        .transferFile(transfer.jobId, transfer.filePath, transfer.source, transfer.target)
        .catch(error => {
          this.logger.error(`Background transfer failed for ${transfer.jobId}:`, error);
        });
    }
  });
}
```

---

### CRITICAL #9: Codec Cache Cleanup Never Called
**File:** `apps/backend/src/encoding/ffmpeg.service.ts:123-129`
**Category:** Memory Leak

**Problem:**
Cleanup interval defined but never started. Cache grows to 5000 entries then stops working.

**Code:**
```typescript
private readonly CODEC_CACHE_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
private lastCacheCleanup = 0;
// ⚠️ NO cleanup method
// ⚠️ NO interval started
// ⚠️ lastCacheCleanup NEVER used
```

**Impact:**
- 500KB permanent memory usage
- Old entries never evicted
- FFprobe re-runs for cached files

**Fix:**
```typescript
private codecCacheCleanupInterval?: NodeJS.Timeout;

async onModuleInit() {
  this.codecCacheCleanupInterval = setInterval(() => {
    this.cleanupCodecCache();
  }, this.CODEC_CACHE_CLEANUP_INTERVAL_MS);
}

async onModuleDestroy() {
  if (this.codecCacheCleanupInterval) {
    clearInterval(this.codecCacheCleanupInterval);
  }
  this.codecCache.clear();
}

private cleanupCodecCache(): void {
  const now = Date.now();
  let removed = 0;

  for (const [filePath, entry] of this.codecCache.entries()) {
    if (now - entry.timestamp.getTime() > this.CODEC_CACHE_TTL_MS) {
      this.codecCache.delete(filePath);
      removed++;
    }
  }

  if (removed > 0) {
    this.logger.debug(`🧹 Cleaned ${removed} stale codec cache entries`);
  }
}
```

---

### CRITICAL #10: activeEncodings Map Leak on Completion
**File:** `apps/backend/src/encoding/ffmpeg.service.ts:111`
**Category:** Memory Leak

**Problem:**
Entries added but only removed on kill, not on normal completion.

**Code:**
```typescript
this.activeEncodings.set(job.id, { jobId, process, ... });

// Removed only in:
// - killProcess() (explicit kill)
// - killAllFfmpegProcesses() (crash cleanup)
// ⚠️ NOT removed on normal completion
```

**Impact:**
- Every completed job leaks 2-10KB
- Eventually OOM

**Fix:**
```typescript
async encode(job: JobWithAllFields, policy: Policy): Promise<void> {
  const ffmpegProcess = spawn('ffmpeg', args);

  this.activeEncodings.set(job.id, {
    jobId: job.id,
    process: ffmpegProcess,
    startTime: new Date(),
  });

  return new Promise((resolve, reject) => {
    ffmpegProcess.on('close', (code) => {
      // ✅ ALWAYS cleanup on close
      this.activeEncodings.delete(job.id);

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpegProcess.on('error', (error) => {
      // ✅ Cleanup on error too
      this.activeEncodings.delete(job.id);
      reject(error);
    });
  });
}
```

---

### CRITICAL #11: lastPreviewGeneration Map Unbounded
**File:** `apps/backend/src/encoding/ffmpeg.service.ts:119`
**Category:** Memory Leak

**Problem:**
Preview timestamps never deleted after job completes.

**Code:**
```typescript
this.lastPreviewGeneration.set(jobId, now);
// ⚠️ Never deleted
```

**Impact:**
- 100k jobs = 2.4MB leaked

**Fix:**
```typescript
// In encode() close handler:
ffmpegProcess.on('close', (code) => {
  this.activeEncodings.delete(job.id);
  this.lastPreviewGeneration.delete(job.id); // ✅ ADD THIS
  this.stderrCache.delete(job.id); // ✅ Cleanup stderr too

  // ... rest of close logic ...
});
```

---

### CRITICAL #12: Worker activeWorkers Set Leak on Crash
**File:** `apps/backend/src/encoding/encoding-processor.service.ts:28-32`
**Category:** Memory Leak + Logic Bug

**Problem:**
Workers added to Set but if crash before loop ends, never removed.

**Code:**
```typescript
pool.activeWorkers.add(workerId);

try {
  while (worker.isRunning) {
    // ... work ...
  }
} finally {
  pool.activeWorkers.delete(workerId); // ⚠️ Only if finally reached
}
```

**Impact:**
- Pool thinks it's full when workers are dead
- New workers never start
- Node permanently disabled

**Fix:**
```typescript
private async startWorkerLoop(nodeId: string, workerId: string) {
  const pool = this.workerPools.get(nodeId);
  pool.activeWorkers.add(workerId);

  try {
    while (worker.isRunning) {
      try {
        const job = await this.queueService.getNextJob(nodeId);
        if (job) {
          await this.encodeJob(job);
        }
      } catch (error) {
        this.logger.error(`Worker ${workerId} job error:`, error);
        // Continue loop on job error
      }
    }
  } catch (error) {
    this.logger.error(`Worker ${workerId} crashed:`, error);
  } finally {
    // ✅ ALWAYS cleanup
    pool.activeWorkers.delete(workerId);
    this.workers.delete(workerId);

    if (worker.shutdownResolve) {
      worker.shutdownResolve();
    }

    this.logger.log(`Worker ${workerId} stopped (active: ${pool.activeWorkers.size})`);
  }
}
```

---

## HIGH PRIORITY FIXES (15)

### HIGH #13: Transaction Timeout Too Long
**File:** `apps/backend/src/queue/queue.service.ts:957-961`
**Category:** Performance

**Problem:**
30s timeout makes deadlocks worse, not better. Long transactions hold locks longer.

**Fix:**
```typescript
{
  maxWait: 5000, // Reduce to 5s
  timeout: 10000, // Reduce to 10s
  isolationLevel: 'ReadCommitted',
}

// Add retry at caller level with backoff
```

---

### HIGH #14: Orphaned SSH Processes
**File:** `apps/backend/src/queue/services/file-transfer.service.ts:336-413`
**Category:** Resource Leak

**Problem:**
SSH process spawned but exception before handlers = orphan.

**Fix:**
```typescript
const cleanup = () => {
  if (timeout) clearTimeout(timeout);
  if (!ssh.killed) ssh.kill('SIGKILL');
  ssh.stdout?.destroy();
  ssh.stderr?.destroy();
};

try {
  return await new Promise((resolve, reject) => { ... });
} finally {
  cleanup();
}
```

---

### HIGH #15: Rsync Stream Leak on Abort
**File:** `apps/backend/src/queue/services/file-transfer.service.ts:188-327`

**Problem:**
Abort kills process but streams not destroyed.

**Fix:**
```typescript
const cleanup = () => {
  this.activeTransfers.delete(jobId);
  rsync.stdout?.destroy();
  rsync.stderr?.destroy();
  rsync.kill('SIGKILL');
};

abortController.signal.addEventListener('abort', cleanup);
rsync.on('close', cleanup);
rsync.on('error', cleanup);
```

---

### HIGH #16: Load-Based Pausing Queries All Jobs
**File:** `apps/backend/src/encoding/encoding-processor.service.ts:805-806`

**Problem:**
Counts all ENCODING jobs every 60s. Slow with 10k+ jobs.

**Fix:**
```typescript
// Cache count in memory
private encodingJobCount = 0;

// Update on stage changes
async claimJob(...) {
  this.encodingJobCount++;
}

async completeJob(...) {
  this.encodingJobCount--;
}

// Use cached value
const encodingJobs = this.encodingJobCount; // O(1)
```

---

### HIGH #17: Missing Index on (nodeId, stage, updatedAt)
**File:** `prisma/schema.prisma:824`

**Problem:**
Watchdog query filters by these 3 fields but composite index missing.

**Fix:**
```prisma
@@index([nodeId, stage, updatedAt]) // For stuck job detection
```

---

### HIGH #18: Promise.all() Fails on Any Rejection
**File:** Multiple locations

**Problem:**
One failed promise stops all others.

**Fix:**
```typescript
const results = await Promise.allSettled([...]);

for (const result of results) {
  if (result.status === 'rejected') {
    this.logger.error('Query failed:', result.reason);
  }
}
```

---

### HIGH #19: No onModuleDestroy for FFmpeg Service
**File:** `apps/backend/src/encoding/ffmpeg.service.ts`

**Problem:**
Active processes not killed on shutdown = zombies.

**Fix:**
```typescript
async onModuleDestroy() {
  this.logger.log('Killing active FFmpeg processes...');

  for (const [jobId, encoding] of this.activeEncodings.entries()) {
    try {
      encoding.process.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (!encoding.process.killed) {
        encoding.process.kill('SIGKILL');
      }
    } catch (error) {
      this.logger.error(`Failed to kill process for ${jobId}:`, error);
    }
  }

  this.activeEncodings.clear();
}
```

---

### HIGH #20: Worker State Corruption on Rapid Start/Stop
**File:** `apps/backend/src/encoding/encoding-processor.service.ts:66`

**Problem:**
`isRunning` flag toggled without mutex.

**Fix:**
Add mutex to WorkerState and atomic checks.

---

### HIGH #21-27: Additional High Priority Issues
- **#21**: Missing cascade delete for NodeFailureLog
- **#22**: Missing composite index on (status, createdAt)
- **#23**: Health check retry loop blocks transaction
- **#24**: Storage share health check map never cleaned
- **#25**: Discovery service map grows unbounded
- **#26**: Notifications map not cleared
- **#27**: Missing unique index on (libraryId, filePath)

---

## MEDIUM & LOW PRIORITY (16 issues)

Documented but deferred for future cleanup phase.

---

## Summary

| Category | Count | Status |
|----------|-------|--------|
| Memory Leaks | 8 | ⚠️ Guaranteed OOM over time |
| Race Conditions | 6 | ⚠️ Production failures |
| Resource Leaks | 5 | ⚠️ Process/connection exhaustion |
| Performance | 4 | ⚠️ Scales poorly |
| Data Consistency | 3 | ⚠️ Corruption risk |
| Other | 17 | ⚠️ Code quality |

**Total Technical Debt:** 43 issues

---

**Next Steps:**
1. Fix all 12 CRITICAL issues first
2. Apply HIGH priority fixes
3. Test under load
4. Deploy to production
