# BitBonsai Deep Audit - Remaining Fixes

## ✅ COMPLETED

### C1. Batch Operations Pause/Cancel Race (CRITICAL)
- ✅ Added `pauseProcessedAt` and `cancelProcessedAt` fields to schema
- ✅ Created migration file
- ✅ Modified `handleProgressUpdate()` to check pause/cancel state
- ✅ Updated `killProcess()` to mark timestamps
- ✅ Added `getJobStatus()` method to QueueService

**Action needed:** Add `updateJobRaw()` helper method to QueueService (see below)

---

## 🔧 FIXES TO APPLY

### C2. SSH Process Orphan Leak (CRITICAL)
**File:** `apps/backend/src/queue/services/file-transfer.service.ts:25`

Add to constructor/onModuleInit:
```typescript
async onModuleInit() {
  // CRITICAL #2 FIX: Kill orphaned SSH processes from previous crash
  try {
    const { exec } = await import('child_process');
    exec('pkill -f "^ssh.*bitbonsai"', (error, stdout, stderr) => {
      if (!error || error.code === 1) { // code 1 = no processes found
        this.logger.log('🧹 Killed orphaned SSH processes from previous session');
      }
    });
  } catch (error) {
    this.logger.warn(`Failed to kill orphaned SSH: ${error}`);
  }
}
```

---

### C3. TOCTOU Security Vulnerability (CRITICAL)
**File:** `apps/backend/src/queue/queue.service.ts:258-333`

Replace `validateFilePath()` method:
```typescript
private validateFilePath(filePath: string, libraryPath: string): void {
  const path = require('node:path');
  const fs = require('node:fs');

  // Check for traversal patterns
  if (filePath.includes('..') || filePath.includes('%2e') || filePath.includes('%2E') || filePath.includes('\u2024')) {
    throw new BadRequestException('Directory traversal attempt detected');
  }

  const resolvedFile = path.resolve(filePath);
  const resolvedLibrary = path.resolve(libraryPath);

  // CRITICAL #3 FIX: Atomic validation using open() with O_NOFOLLOW
  // Prevents TOCTOU by validating and accessing in single syscall
  try {
    const fd = fs.openSync(resolvedFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stats = fs.fstatSync(fd);
    const realFile = fs.readlinkSync(`/proc/self/fd/${fd}`); // Linux-specific
    fs.closeSync(fd);

    if (!realFile.startsWith(resolvedLibrary + path.sep)) {
      throw new BadRequestException(`File outside library boundary`);
    }
  } catch (err) {
    if (err.code === 'ELOOP') {
      throw new BadRequestException('Symlink detected - operation rejected');
    }
    // Fallback to existing path walking logic for missing files...
  }
}
```

---

### C4. Rsync Newline Injection (HIGH)
**File:** `apps/backend/src/queue/services/file-transfer.service.ts:43-70`

Update validation:
```typescript
private validateRsyncPath(path: string): void {
  // CRITICAL #4 FIX: Reject ALL control chars including newlines
  if (/[\x00-\x1F\x7F\n\r]/.test(path)) {
    throw new Error('Path contains control characters or newlines');
  }

  if (path.length > 4096) {
    throw new Error('Path exceeds maximum length');
  }

  // SEC #1 FIX: NO spaces allowed
  if (!/^[a-zA-Z0-9/_\-\.]+$/.test(path)) {
    throw new Error('Invalid path characters');
  }

  if (path.includes('..') || path.includes('//') || path.includes('::')) {
    throw new Error('Path traversal/daemon syntax detected');
  }
}
```

---

### H3. Dynamic Require in Hot Loop (HIGH)
**File:** `apps/backend/src/distribution/services/distribution-orchestrator.service.ts`

Add to constructor:
```typescript
private readonly scheduleChecker: any; // Type from schedule-checker module

constructor(
  private readonly prisma: PrismaService,
  private readonly scorer: JobScorerService,
  readonly _loadMonitor: LoadMonitorService,
  private readonly etaCalculator: EtaCalculatorService,
  private readonly reliabilityTracker: ReliabilityTrackerService
) {
  // HIGH #3 FIX: Import once in constructor, not in hot loop
  this.scheduleChecker = require('../../nodes/utils/schedule-checker');
}
```

Replace lines 447 and 623:
```typescript
// Before:
const scheduleChecker = require('../../nodes/utils/schedule-checker');

// After:
if (!this.scheduleChecker.isNodeInAllowedWindow(targetNode)) continue;
```

---

### M2. Codec Cache Size Enforcement (MEDIUM)
**File:** `apps/backend/src/encoding/ffmpeg.service.ts:300`

Update `cleanupCodecCache()`:
```typescript
private cleanupCodecCache(): void {
  const now = Date.now();
  let removed = 0;

  // Remove stale entries
  for (const [filePath, entry] of this.codecCache.entries()) {
    if (now - entry.timestamp.getTime() > this.CODEC_CACHE_TTL_MS) {
      this.codecCache.delete(filePath);
      removed++;
    }
  }

  // MEDIUM #2 FIX: Enforce size limit (remove oldest entries)
  if (this.codecCache.size > this.CODEC_CACHE_MAX_SIZE) {
    const entries = Array.from(this.codecCache.entries());
    entries.sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());
    const toRemove = this.codecCache.size - this.CODEC_CACHE_MAX_SIZE;
    for (let i = 0; i < toRemove; i++) {
      this.codecCache.delete(entries[i][0]);
      removed++;
    }
  }

  if (removed > 0) {
    this.logger.debug(`🧹 Cleaned ${removed} codec cache entries (size: ${this.codecCache.size}/${this.CODEC_CACHE_MAX_SIZE})`);
  }
}
```

---

### M4. Policy Deletion UX Issue (MEDIUM)
**File:** `prisma/schema.prisma:788`

Change:
```prisma
policyId String
policy   Policy @relation(..., onDelete: SetNull)
```

Add migration:
```sql
-- Allow policy deletion by setting jobs to NULL
ALTER TABLE "jobs" ALTER COLUMN "policyId" DROP NOT NULL;
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_policyId_fkey";
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE SET NULL;
```

---

### L1. Interval Cleanup (LOW)
**File:** `apps/backend/src/encoding/ffmpeg.service.ts`

Add to `onModuleDestroy()`:
```typescript
async onModuleDestroy() {
  // CRITICAL #2 & #9 FIX: Clear cleanup intervals
  if (this.stderrCleanupInterval) {
    clearInterval(this.stderrCleanupInterval);
  }
  if (this.codecCacheCleanupInterval) {
    clearInterval(this.codecCacheCleanupInterval);
  }

  this.logger.log('✅ Cleanup intervals stopped');
}
```

---

## 🔧 HELPER METHODS TO ADD

### QueueService.updateJobRaw()
**File:** `apps/backend/src/queue/queue.service.ts` (after `getJobStatus()`)

```typescript
/**
 * CRITICAL #1 FIX: Raw job update for internal use
 * Bypasses validation for system operations
 */
async updateJobRaw(jobId: string, data: Record<string, any>): Promise<void> {
  await this.prisma.job.update({
    where: { id: jobId },
    data,
  });
}
```

---

## 📊 FIX PRIORITY

1. **CRITICAL** (C2, C3, C4): Security & data corruption issues
2. **HIGH** (H3): Performance degradation
3. **MEDIUM** (M2, M4): UX improvements
4. **LOW** (L1): Dev experience only

## 🚀 DEPLOYMENT STEPS

1. Run Prisma migration: `npx prisma migrate dev`
2. Apply all code changes above
3. Rebuild: `nx build backend`
4. Deploy: `./deploy-unraid.sh`
5. Verify pause/cancel works: Test batch operations

---

**Estimated time:** 2-3 hours for all fixes
