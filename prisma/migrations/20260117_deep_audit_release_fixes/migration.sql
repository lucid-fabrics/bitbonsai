-- Deep Audit Release Fixes Migration
-- P0-P2 fixes for BitBonsai release readiness

-- ============================================================================
-- P2: Auto-heal atomic claim pattern fields
-- Prevents multiple nodes from healing the same jobs on simultaneous restart
-- ============================================================================

-- Add auto-heal claim fields to Job model
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "autoHealClaimedAt" TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "autoHealClaimedBy" TEXT;

-- Composite index for auto-heal claim queries (find unclaimed orphaned jobs)
CREATE INDEX IF NOT EXISTS "jobs_autoHealClaimedAt_autoHealClaimedBy_idx"
ON "jobs" ("autoHealClaimedAt", "autoHealClaimedBy");

-- ============================================================================
-- P1: Optimistic locking support
-- Index on updatedAt for efficient optimistic lock queries
-- ============================================================================

-- Note: updatedAt index already exists as "jobs_updatedAt_idx" per schema
-- Just verify it exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'jobs_updatedAt_idx') THEN
        CREATE INDEX "jobs_updatedAt_idx" ON "jobs" ("updatedAt");
    END IF;
END $$;
