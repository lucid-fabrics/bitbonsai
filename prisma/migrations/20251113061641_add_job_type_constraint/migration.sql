-- Add CHECK constraint to ensure job type is either ENCODE or REMUX
-- This provides database-level validation in addition to application-level checks

-- SQLite doesn't support ALTER TABLE ADD CONSTRAINT directly
-- We need to recreate the table with the constraint

-- Step 1: Create new table with CHECK constraint
CREATE TABLE "jobs_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'ENCODE',
    "filePath" TEXT NOT NULL,
    "fileLabel" TEXT NOT NULL,
    "sourceCodec" TEXT NOT NULL,
    "sourceContainer" TEXT,
    "targetCodec" TEXT NOT NULL,
    "targetContainer" TEXT,
    "stage" TEXT NOT NULL,
    "progress" REAL NOT NULL DEFAULT 0,
    "etaSeconds" INTEGER,
    "fps" REAL,
    "beforeSizeBytes" BIGINT NOT NULL,
    "afterSizeBytes" BIGINT,
    "savedBytes" BIGINT,
    "savedPercent" REAL,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "failedAt" DATETIME,
    "error" TEXT,
    "isBlacklisted" BOOLEAN NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" DATETIME,
    "autoHealedAt" DATETIME,
    "autoHealedProgress" REAL,
    "healthStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "healthScore" INTEGER NOT NULL DEFAULT 0,
    "healthMessage" TEXT,
    "healthCheckedAt" DATETIME,
    "healthCheckStartedAt" DATETIME,
    "healthCheckRetries" INTEGER NOT NULL DEFAULT 0,
    "decisionRequired" BOOLEAN NOT NULL DEFAULT 0,
    "decisionIssues" TEXT,
    "decisionMadeAt" DATETIME,
    "decisionData" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "prioritySetAt" DATETIME,
    "tempFilePath" TEXT,
    "resumeTimestamp" TEXT,
    "lastProgressUpdate" DATETIME,
    "previewImagePaths" TEXT,
    "keepOriginalRequested" BOOLEAN NOT NULL DEFAULT 0,
    "originalBackupPath" TEXT,
    "originalSizeBytes" BIGINT,
    "replacementAction" TEXT,
    "warning" TEXT,
    "resourceThrottled" BOOLEAN NOT NULL DEFAULT 0,
    "resourceThrottleReason" TEXT,
    "ffmpegThreads" INTEGER,
    "startedFromSeconds" REAL,
    "healingPointSeconds" REAL,
    "nodeId" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "jobs_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobs_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobs_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("type" IN ('ENCODE', 'REMUX'))
);

-- Step 2: Copy data from old table
INSERT INTO "jobs_new" SELECT * FROM "jobs";

-- Step 3: Drop old table
DROP TABLE "jobs";

-- Step 4: Rename new table to original name
ALTER TABLE "jobs_new" RENAME TO "jobs";

-- Step 5: Recreate all indexes
CREATE INDEX "jobs_type_idx" ON "jobs"("type");
CREATE INDEX "jobs_stage_idx" ON "jobs"("stage");
CREATE INDEX "jobs_nodeId_idx" ON "jobs"("nodeId");
CREATE INDEX "jobs_libraryId_idx" ON "jobs"("libraryId");
CREATE INDEX "jobs_policyId_idx" ON "jobs"("policyId");
CREATE INDEX "jobs_createdAt_idx" ON "jobs"("createdAt");
CREATE INDEX "jobs_completedAt_idx" ON "jobs"("completedAt");
CREATE INDEX "jobs_updatedAt_idx" ON "jobs"("updatedAt");
CREATE INDEX "jobs_stage_nodeId_idx" ON "jobs"("stage", "nodeId");
CREATE INDEX "jobs_isBlacklisted_idx" ON "jobs"("isBlacklisted");
CREATE INDEX "jobs_filePath_libraryId_idx" ON "jobs"("filePath", "libraryId");
CREATE INDEX "jobs_healthStatus_idx" ON "jobs"("healthStatus");
CREATE INDEX "jobs_healthScore_idx" ON "jobs"("healthScore");
CREATE INDEX "jobs_stage_healthScore_idx" ON "jobs"("stage", "healthScore");
CREATE INDEX "jobs_priority_idx" ON "jobs"("priority");
CREATE INDEX "jobs_stage_priority_createdAt_idx" ON "jobs"("stage", "priority", "createdAt");
