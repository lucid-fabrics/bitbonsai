-- Feature: Dead Letter Queue (DLQ) tracking
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "dlqEnteredAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "jobs_dlqEnteredAt_idx" ON "jobs"("dlqEnteredAt");

-- Feature: Idempotent job deduplication via fingerprint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "jobFingerprint" TEXT;
CREATE INDEX IF NOT EXISTS "jobs_jobFingerprint_idx" ON "jobs"("jobFingerprint");

-- Partial unique index: only one active job per fingerprint (active = not COMPLETED/FAILED/CANCELLED)
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_jobFingerprint_active_idx" ON "jobs"("jobFingerprint")
  WHERE "stage" NOT IN ('COMPLETED', 'FAILED', 'CANCELLED');
