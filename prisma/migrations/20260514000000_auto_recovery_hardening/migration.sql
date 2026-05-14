-- Auto-Recovery Hardening Migration
-- Adds fencing tokens, GPU/CPU fallback fields, ownership leases,
-- completion outbox, circuit breaker fields, and job temp file registry.

-- Fencing token (prevents dual-reset race)
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "fencingToken" TEXT;

-- GPU→CPU fallback
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "gpuAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "codecOverride" TEXT;

-- Ownership lease (MAIN↔LINKED split-brain prevention)
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "ownershipLeaseExpiry" TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "ownershipEpoch" INTEGER NOT NULL DEFAULT 0;

-- Completion outbox (survive DB write failure after successful encode)
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "pendingCompletionData" TEXT;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "pendingCompletionAt" TIMESTAMP(3);

-- Circuit breaker (global cap across all retry systems)
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "totalAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "circuitBroken" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "circuitBrokenAt" TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "circuitBrokenReason" TEXT;

-- Indexes for new Job fields
CREATE INDEX IF NOT EXISTS "jobs_fencingToken_idx" ON "jobs"("fencingToken");
CREATE INDEX IF NOT EXISTS "jobs_ownershipLeaseExpiry_idx" ON "jobs"("ownershipLeaseExpiry");
CREATE INDEX IF NOT EXISTS "jobs_circuitBroken_idx" ON "jobs"("circuitBroken");
CREATE INDEX IF NOT EXISTS "jobs_totalAttempts_idx" ON "jobs"("totalAttempts");

-- Job Temp File Registry (runtime temp file tracking — survives force-kill)
CREATE TABLE IF NOT EXISTS "job_temp_files" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "tempPath" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleanedAt" TIMESTAMP(3),
    CONSTRAINT "job_temp_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "job_temp_files_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "job_temp_files_jobId_idx" ON "job_temp_files"("jobId");
CREATE INDEX IF NOT EXISTS "job_temp_files_nodeId_idx" ON "job_temp_files"("nodeId");
CREATE INDEX IF NOT EXISTS "job_temp_files_cleanedAt_idx" ON "job_temp_files"("cleanedAt");
