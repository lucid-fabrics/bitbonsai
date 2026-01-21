-- DEEP AUDIT P0: Add transferLastProgressAt field for TRANSFERRING stage stall detection
-- This enables the stuck-job-recovery worker to detect and recover stalled file transfers

-- Add the new column
ALTER TABLE "jobs" ADD COLUMN "transferLastProgressAt" TIMESTAMP(3);

-- Create index for efficient stuck transfer detection queries
CREATE INDEX "jobs_stage_transferLastProgressAt_idx" ON "jobs"("stage", "transferLastProgressAt");
