-- CRITICAL #1 FIX: Add pause/cancel processed timestamps for graceful shutdown
-- Prevents race conditions where multiple batch operations try to pause/cancel same jobs

ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "pauseProcessedAt" TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "cancelProcessedAt" TIMESTAMP(3);

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS "idx_jobs_pause_processed" ON "jobs"("pauseProcessedAt");
CREATE INDEX IF NOT EXISTS "idx_jobs_cancel_processed" ON "jobs"("cancelProcessedAt");
