-- Distribution v2 Schema Migration
-- Adds enhanced job distribution algorithm support

-- ============================================================================
-- Node Model: Distribution v2 Fields
-- ============================================================================

-- Real-time load monitoring (updated via heartbeat)
ALTER TABLE "nodes" ADD COLUMN "currentSystemLoad" DOUBLE PRECISION;
ALTER TABLE "nodes" ADD COLUMN "currentMemoryFreeGB" DOUBLE PRECISION;
ALTER TABLE "nodes" ADD COLUMN "lastHeartbeatLoad" JSONB;

-- ETA & capacity tracking
ALTER TABLE "nodes" ADD COLUMN "estimatedFreeAt" TIMESTAMP(3);
ALTER TABLE "nodes" ADD COLUMN "queuedJobCount" INTEGER NOT NULL DEFAULT 0;

-- Reliability tracking
ALTER TABLE "nodes" ADD COLUMN "recentFailureCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "nodes" ADD COLUMN "lastFailureAt" TIMESTAMP(3);
ALTER TABLE "nodes" ADD COLUMN "failureRate24h" DOUBLE PRECISION;

-- ============================================================================
-- Job Model: Distribution v2 Fields
-- ============================================================================

-- Job stickiness (prevent unnecessary migrations)
ALTER TABLE "jobs" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN "stickyUntil" TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN "migrationCount" INTEGER NOT NULL DEFAULT 0;

-- Duration estimation (for ETA-based distribution)
ALTER TABLE "jobs" ADD COLUMN "estimatedDuration" INTEGER;
ALTER TABLE "jobs" ADD COLUMN "estimatedStartAt" TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN "estimatedCompleteAt" TIMESTAMP(3);

-- Distribution scoring (for debugging/visibility)
ALTER TABLE "jobs" ADD COLUMN "lastScoreBreakdown" JSONB;
ALTER TABLE "jobs" ADD COLUMN "assignmentReason" TEXT;

-- Job indexes for distribution v2
CREATE INDEX "jobs_assignedAt_idx" ON "jobs"("assignedAt");
CREATE INDEX "jobs_stickyUntil_idx" ON "jobs"("stickyUntil");
CREATE INDEX "jobs_migrationCount_idx" ON "jobs"("migrationCount");
CREATE INDEX "jobs_estimatedDuration_idx" ON "jobs"("estimatedDuration");
CREATE INDEX "jobs_stage_stickyUntil_idx" ON "jobs"("stage", "stickyUntil");

-- ============================================================================
-- NodeFailureLog Model (new table)
-- ============================================================================

CREATE TABLE "node_failure_logs" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "errorCode" TEXT,
    "stage" TEXT NOT NULL,
    "progress" DOUBLE PRECISION,
    "jobId" TEXT,
    "filePath" TEXT,
    "fileSize" BIGINT,
    "nodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_failure_logs_pkey" PRIMARY KEY ("id")
);

-- NodeFailureLog indexes
CREATE INDEX "node_failure_logs_nodeId_idx" ON "node_failure_logs"("nodeId");
CREATE INDEX "node_failure_logs_createdAt_idx" ON "node_failure_logs"("createdAt");
CREATE INDEX "node_failure_logs_nodeId_createdAt_idx" ON "node_failure_logs"("nodeId", "createdAt");
CREATE INDEX "node_failure_logs_reason_idx" ON "node_failure_logs"("reason");

-- NodeFailureLog foreign key
ALTER TABLE "node_failure_logs" ADD CONSTRAINT "node_failure_logs_nodeId_fkey"
    FOREIGN KEY ("nodeId") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- DistributionConfig Model (new table)
-- ============================================================================

CREATE TABLE "distribution_config" (
    "id" TEXT NOT NULL,

    -- Scoring Weights
    "weightRealTimeLoad" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "weightQueueDepth" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "weightHardware" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "weightPerformance" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "weightStickiness" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "weightTransferCost" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "weightCodecMatch" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "weightLibraryAffinity" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "weightReliability" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "weightETABalance" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "weightFileSizeSpread" DOUBLE PRECISION NOT NULL DEFAULT 1.0,

    -- Behavior Settings
    "stickinessMinutes" INTEGER NOT NULL DEFAULT 5,
    "failureWindow24h" BOOLEAN NOT NULL DEFAULT true,
    "enableETABalancing" BOOLEAN NOT NULL DEFAULT true,
    "enableFileSizeSpread" BOOLEAN NOT NULL DEFAULT true,
    "enableLibraryAffinity" BOOLEAN NOT NULL DEFAULT true,

    -- Thresholds
    "migrationScoreThreshold" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
    "maxMigrationsPerJob" INTEGER NOT NULL DEFAULT 3,
    "highLoadThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,

    -- Cache Settings
    "scoreCacheTtlSeconds" INTEGER NOT NULL DEFAULT 60,

    -- Singleton marker
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distribution_config_pkey" PRIMARY KEY ("id")
);

-- Insert default configuration
INSERT INTO "distribution_config" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP);
