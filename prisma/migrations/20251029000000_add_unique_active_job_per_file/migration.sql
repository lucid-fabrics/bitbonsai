-- ISSUE #9 FIX: Add unique index constraint to prevent duplicate jobs for same file
-- Only enforces uniqueness for active jobs (not COMPLETED, FAILED, CANCELLED)
-- This prevents race conditions where multiple requests create duplicate jobs

-- SQLite doesn't support partial unique indexes directly, so we use a workaround:
-- Create a unique index on (filePath, libraryId, stage) for non-terminal stages

-- First, drop the existing index if it exists (for idempotency)
DROP INDEX IF EXISTS "jobs_filePath_libraryId_idx";

-- Create unique constraint for active jobs
-- For SQLite, we create a unique index with a WHERE clause (supported in SQLite 3.8.0+)
CREATE UNIQUE INDEX "unique_active_job_per_file"
ON "jobs"("filePath", "libraryId")
WHERE "stage" NOT IN ('COMPLETED', 'FAILED', 'CANCELLED');

-- Recreate the non-unique index for queries
CREATE INDEX "jobs_filePath_libraryId_idx"
ON "jobs"("filePath", "libraryId");
