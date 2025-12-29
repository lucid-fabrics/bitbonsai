-- CreateIndex: Audit Fixes - Critical Race Conditions
-- Date: 2025-12-28
-- Issues Fixed: CRITICAL #2, CRITICAL #4

-- CRITICAL FIX #2: Cross-node auto-heal protection
-- Add heartbeat fields to prevent MAIN node from resetting LINKED node's active jobs
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "lastHeartbeat" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "heartbeatNodeId" TEXT;

-- CRITICAL FIX #4: Watchdog vs Auto-Pause race protection
-- Track when job stage last changed to prevent false positives
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "lastStageChangeAt" TIMESTAMP(3);

-- Create indexes for performance on new fields
CREATE INDEX IF NOT EXISTS "Job_lastHeartbeat_idx" ON "Job"("lastHeartbeat");
CREATE INDEX IF NOT EXISTS "Job_lastStageChangeAt_idx" ON "Job"("lastStageChangeAt");
CREATE INDEX IF NOT EXISTS "Job_heartbeatNodeId_idx" ON "Job"("heartbeatNodeId");
