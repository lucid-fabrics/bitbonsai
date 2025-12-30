# Audit Fixes Round 2 - BitBonsai

**Date:** 2025-12-30
**Total Issues:** 29 (5 CRITICAL, 8 HIGH, 10 MEDIUM, 6 LOW)

## CRITICAL FIXES

### CRITICAL #25: Metrics Double-Count on Backend Restart
**File:** `apps/backend/src/queue/queue.service.ts:2787`

**Problem:** In-memory `Set<string>` cleared on restart, causing metrics double-count

**Solution:**
1. Add `metricsProcessedJobs` table to track which jobs have been counted
2. Make `updateMetrics` idempotent by checking this table

**Schema Change:**
```prisma
model MetricsProcessedJob {
  id        String   @id @default(cuid())
  jobId     String   @unique
  processedAt DateTime @default(now())

  @@index([jobId])
  @@map("metrics_processed_jobs")
}
```

**Code Change:**
```typescript
private async updateMetrics(job, tx) {
  const prisma = tx || this.prisma;

  // Check if already processed
  const alreadyProcessed = await prisma.metricsProcessedJob.findUnique({
    where: { jobId: job.id }
  });

  if (alreadyProcessed) {
    this.logger.debug(`Metrics already processed for job ${job.id}`);
    return;
  }

  // Process metrics...
  await prisma.metric.upsert({...});

  // Mark as processed
  await prisma.metricsProcessedJob.create({
    data: { jobId: job.id }
  });
}
```

---

### CRITICAL #26: Transaction Timeout in High Concurrency
**File:** `apps/backend/src/queue/queue.service.ts:955`

**Fix:**
```typescript
const claimedJob = await this.prisma.$transaction(
  async (tx) => {
    // ... existing logic ...
  },
  {
    maxWait: 10000,  // Increase from 5s to 10s
    timeout: 30000,  // Increase from 10s to 30s
    isolationLevel: 'ReadCommitted', // Reduce lock contention
  }
);
```

---

### CRITICAL #27: File Transfer Infinite Stuck State
**File:** `apps/backend/src/queue/queue.service.ts:579`

**Add Cron Job:**
```typescript
@Cron('*/10 * * * *') // Every 10 minutes
async cleanupStuckTransfers() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const stuckJobs = await this.prisma.job.findMany({
    where: {
      stage: 'TRANSFERRING',
      transferStartedAt: { lt: oneHourAgo },
      transferProgress: { lt: 100 },
    },
  });

  for (const job of stuckJobs) {
    const retryCount = job.transferRetryCount || 0;

    if (retryCount >= 3) {
      // Max retries exceeded - fail the job
      await this.failJob(
        job.id,
        `File transfer stuck for over 1 hour after ${retryCount} retry attempts`
      );
    } else {
      // Reset to DETECTED for retry
      await this.update(job.id, {
        stage: JobStage.DETECTED,
        transferError: `Transfer timeout after 1 hour - retry ${retryCount + 1}/3`,
        transferRetryCount: retryCount + 1,
      });
    }
  }
}
```

---

### CRITICAL #28: Pool Lock Deadlock on Exception
**File:** `apps/backend/src/encoding/encoding-processor.service.ts:955`

**Fix:**
```typescript
private async acquirePoolLock(nodeId: string, timeoutMs = 30000): Promise<void> {
  const existingLock = this.poolLocks.get(nodeId);

  if (existingLock) {
    // Add timeout to prevent infinite wait
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error(`Pool lock timeout for node ${nodeId}`)), timeoutMs);
    });

    try {
      await Promise.race([existingLock, timeoutPromise]);
    } catch (error) {
      // Timeout - force clear stale lock
      this.logger.warn(`Pool lock timeout for node ${nodeId}, clearing stale lock`);
      this.poolLocks.delete(nodeId);
    }
  }

  // Create new lock...
}

// Clear locks on startup
async onModuleInit() {
  this.poolLocks.clear();
  this.logger.log('Cleared stale pool locks from previous session');
  // ... rest of init
}
```

---

### CRITICAL #29: Worker Pool Loop Logic Error
**File:** `apps/backend/src/encoding/encoding-processor.service.ts:1038`

**Fix:**
```typescript
// Calculate how many workers needed
const currentWorkerCount = pool.activeWorkers.size;
const workersToStart = validatedMaxWorkers - currentWorkerCount;

if (workersToStart <= 0) {
  this.logger.debug(`Worker pool already at capacity (${currentWorkerCount}/${validatedMaxWorkers})`);
  return 0;
}

// Start only the needed workers (not all from 1 to max)
let workersStarted = 0;
for (let i = currentWorkerCount + 1; i <= validatedMaxWorkers; i++) {
  const workerId = `${nodeId}-worker-${i}`;

  pool.activeWorkers.add(workerId);  // Add BEFORE starting

  try {
    await this.startWorker(workerId, nodeId);
    workersStarted++;
  } catch (error) {
    pool.activeWorkers.delete(workerId);  // Rollback on error
    this.logger.error(`Failed to start worker ${workerId}:`, error);
  }
}
```

---

## HIGH PRIORITY FIXES

### HIGH #11: No State Machine Validation
**File:** `apps/backend/src/queue/queue.service.ts`

**Add State Validator:**
```typescript
private readonly VALID_TRANSITIONS: Record<JobStage, JobStage[]> = {
  DETECTED: ['HEALTH_CHECK', 'FAILED', 'CANCELLED'],
  HEALTH_CHECK: ['QUEUED', 'FAILED', 'CANCELLED', 'CORRUPTED'],
  QUEUED: ['ENCODING', 'TRANSFERRING', 'PAUSED_LOAD', 'CANCELLED'],
  TRANSFERRING: ['QUEUED', 'FAILED', 'CANCELLED'],
  ENCODING: ['VERIFYING', 'COMPLETED', 'FAILED', 'PAUSED_LOAD', 'CANCELLED'],
  VERIFYING: ['COMPLETED', 'FAILED'],
  PAUSED_LOAD: ['QUEUED', 'CANCELLED'],
  PAUSED: ['QUEUED', 'CANCELLED'],
  COMPLETED: [], // Terminal state
  FAILED: ['QUEUED'], // Can retry
  CANCELLED: [], // Terminal state
  CORRUPTED: ['HEALTH_CHECK', 'FAILED'], // Can re-check or fail
};

private validateStageTransition(jobId: string, from: JobStage, to: JobStage): void {
  const validTransitions = this.VALID_TRANSITIONS[from];

  if (!validTransitions.includes(to)) {
    throw new BadRequestException(
      `Invalid job stage transition for ${jobId}: ${from} → ${to}. ` +
      `Valid transitions from ${from}: ${validTransitions.join(', ')}`
    );
  }
}

// Use in update method
async update(id: string, data: UpdateJobDto): Promise<Job> {
  const existingJob = await this.prisma.job.findUnique({ where: { id } });

  if (data.stage && existingJob) {
    this.validateStageTransition(id, existingJob.stage, data.stage);
  }

  // ... proceed with update
}
```

---

### HIGH #12: File Transfer Cleanup Race
**File:** `apps/backend/src/queue/services/file-transfer.service.ts:502`

**Fix:**
```typescript
async cleanupRemoteTempFile(jobId: string): Promise<void> {
  const job = await this.prisma.job.findUnique({
    where: { id: jobId },
    select: {
      remoteTempPath: true,
      stage: true,
      transferProgress: true,
      node: { select: { id: true, name: true, ipAddress: true } },
    },
  });

  if (!job?.remoteTempPath) {
    return;
  }

  // SAFETY CHECK: Don't cleanup if transfer still in progress
  if (job.stage === 'TRANSFERRING' || job.transferProgress < 100) {
    this.logger.warn(
      `Skipping cleanup for job ${jobId} - transfer still in progress ` +
      `(stage: ${job.stage}, progress: ${job.transferProgress}%)`
    );
    return;
  }

  // Proceed with cleanup...
}
```

---

### HIGH #13: Job Claiming Lacks Exponential Backoff
**File:** `apps/backend/src/queue/queue.service.ts:936`

**Fix:**
```typescript
// RACE CONDITION FIX: Exponential backoff with jitter
const baseBackoff = 100; // Start at 100ms
const maxBackoff = 2000; // Cap at 2s
const backoffMs = Math.min(baseBackoff * Math.pow(2, attempt - 1), maxBackoff);
const jitterMs = Math.random() * 50; // 0-50ms jitter

await new Promise(resolve => setTimeout(resolve, backoffMs + jitterMs));
```

---

### HIGH #14: Node Score Cache Never Invalidated
**File:** `apps/backend/src/nodes/services/job-attribution.service.ts`

**Add Event Listener:**
```typescript
import { OnEvent } from '@nestjs/event-emitter';

@OnEvent('node.updated')
handleNodeUpdated(payload: { nodeId: string }) {
  const cached = this.scoreCache.get(payload.nodeId);
  if (cached) {
    this.scoreCache.delete(payload.nodeId);
    this.scoreLocks.delete(payload.nodeId);
    this.logger.debug(`Invalidated score cache for updated node ${payload.nodeId}`);
  }
}

@OnEvent('node.deleted')
handleNodeDeleted(payload: { nodeId: string }) {
  this.scoreCache.delete(payload.nodeId);
  this.scoreLocks.delete(payload.nodeId);
  this.logger.debug(`Removed cache for deleted node ${payload.nodeId}`);
}
```

---

### HIGH #15: Missing Pagination Size Limit
**File:** `apps/backend/src/queue/queue.service.ts:615`

**Fix:**
```typescript
const MAX_PAGE_SIZE = 1000;
const DEFAULT_PAGE_SIZE = 20;

const currentPage = page && page > 0 ? page : 1;
const requestedSize = limit && limit > 0 ? limit : DEFAULT_PAGE_SIZE;
const pageSize = Math.min(requestedSize, MAX_PAGE_SIZE);

if (limit && limit > MAX_PAGE_SIZE) {
  this.logger.warn(
    `Page size ${limit} exceeds maximum ${MAX_PAGE_SIZE}, capping to ${MAX_PAGE_SIZE}`
  );
}
```

---

### HIGH #16: Worker Shutdown Not Awaited
**File:** `apps/backend/src/encoding/encoding-processor.service.ts:281`

**Fix:**
```typescript
async onModuleDestroy() {
  this.logger.log('🛑 Shutting down encoding processor...');

  // Stop watchdog
  if (this.watchdogIntervalId) {
    clearInterval(this.watchdogIntervalId);
    this.watchdogIntervalId = undefined;
  }

  // Signal all workers to stop
  for (const worker of this.workers.values()) {
    worker.isRunning = false;
  }

  // Wait for all workers to finish (with timeout)
  const shutdownPromises = Array.from(this.workers.values())
    .map(w => w.shutdownPromise)
    .filter((p): p is Promise<void> => p !== undefined);

  if (shutdownPromises.length > 0) {
    this.logger.log(`Waiting for ${shutdownPromises.length} workers to shutdown...`);

    try {
      await Promise.race([
        Promise.all(shutdownPromises),
        new Promise<void>(resolve => setTimeout(resolve, 30000)) // 30s timeout
      ]);
      this.logger.log('✅ All workers stopped gracefully');
    } catch (error) {
      this.logger.error('Worker shutdown timeout - some workers may still be running');
    }
  }
}
```

---

### HIGH #17: ScoreLocks Map Memory Leak
**File:** `apps/backend/src/nodes/services/job-attribution.service.ts:132`

**Fix:**
```typescript
async calculateNodeScore(node: Node & { _count: { jobs: number } }): Promise<NodeScore> {
  // Check cache first
  const cached = this.scoreCache.get(node.id);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.score;
  }

  // Check if calculation already in progress
  const existingLock = this.scoreLocks.get(node.id);
  if (existingLock) {
    return existingLock;
  }

  // Start calculation
  const calculationPromise = this.performScoreCalculation(node);
  this.scoreLocks.set(node.id, calculationPromise);

  try {
    const score = await calculationPromise;
    return score;
  } catch (error) {
    this.logger.error(`Score calculation error for node ${node.id}:`, error);

    // Return zero score on error instead of throwing
    const errorScore: NodeScore = {
      nodeId: node.id,
      nodeName: node.name,
      totalScore: 0,
      breakdown: {
        scheduleAvailable: false,
        loadScore: 0,
        hardwareScore: 0,
        performanceScore: 0,
      },
    };

    return errorScore;
  } finally {
    // ALWAYS release lock, even on error
    this.scoreLocks.delete(node.id);
  }
}
```

---

### HIGH #18: activeTransfers Map Never Cleaned Up
**File:** `apps/backend/src/queue/services/file-transfer.service.ts`

**Add Cron Job:**
```typescript
@Cron('0 * * * *') // Every hour
async cleanupStaleTransferEntries() {
  const staleEntries: string[] = [];

  for (const [jobId, controller] of this.activeTransfers.entries()) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { stage: true },
    });

    // If job doesn't exist or is not transferring, cleanup
    if (!job || job.stage !== 'TRANSFERRING') {
      controller.abort(); // Cleanup any orphaned process
      staleEntries.push(jobId);
    }
  }

  staleEntries.forEach(id => this.activeTransfers.delete(id));

  if (staleEntries.length > 0) {
    this.logger.log(`🧹 Cleaned up ${staleEntries.length} stale transfer entries`);
  }
}
```

---

## Summary of Code Files to Modify

1. `prisma/schema.prisma` - Add MetricsProcessedJob model
2. `apps/backend/src/queue/queue.service.ts` - 6 fixes
3. `apps/backend/src/encoding/encoding-processor.service.ts` - 4 fixes
4. `apps/backend/src/nodes/services/job-attribution.service.ts` - 2 fixes
5. `apps/backend/src/queue/services/file-transfer.service.ts` - 2 fixes

**Next Steps:**
1. Apply all code fixes
2. Generate Prisma migration
3. Test locally
4. Deploy to Unraid
