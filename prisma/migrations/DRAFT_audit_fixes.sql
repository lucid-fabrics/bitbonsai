-- Migration: Audit Fixes - Critical Race Conditions
-- Date: 2025-12-28
-- Issues Fixed: CRITICAL #2, CRITICAL #4

-- CRITICAL FIX #2: Cross-node auto-heal protection
-- Add heartbeat fields to prevent MAIN node from resetting LINKED node's active jobs
ALTER TABLE "Job" ADD COLUMN "lastHeartbeat" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "heartbeatNodeId" TEXT;

-- CRITICAL FIX #4: Watchdog vs Auto-Pause race protection
-- Track when job stage last changed to prevent false positives
ALTER TABLE "Job" ADD COLUMN "lastStageChangeAt" TIMESTAMP(3);

-- Create indexes for performance on new fields
CREATE INDEX "Job_lastHeartbeat_idx" ON "Job"("lastHeartbeat");
CREATE INDEX "Job_lastStageChangeAt_idx" ON "Job"("lastStageChangeAt");
CREATE INDEX "Job_heartbeatNodeId_idx" ON "Job"("heartbeatNodeId");

-- Comments for documentation
COMMENT ON COLUMN "Job"."lastHeartbeat" IS 'Last heartbeat from encoding node (updated every 30s during ENCODING) - CRITICAL FIX #2';
COMMENT ON COLUMN "Job"."heartbeatNodeId" IS 'Which node sent the last heartbeat (for validation) - CRITICAL FIX #2';
COMMENT ON COLUMN "Job"."lastStageChangeAt" IS 'Track when stage last changed (prevents watchdog false positives) - CRITICAL FIX #4';
