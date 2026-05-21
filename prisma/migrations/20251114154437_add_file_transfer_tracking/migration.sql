-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_jobs" (
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
    "isBlacklisted" BOOLEAN NOT NULL DEFAULT false,
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
    "decisionRequired" BOOLEAN NOT NULL DEFAULT false,
    "decisionIssues" TEXT,
    "decisionMadeAt" DATETIME,
    "decisionData" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "prioritySetAt" DATETIME,
    "tempFilePath" TEXT,
    "resumeTimestamp" TEXT,
    "lastProgressUpdate" DATETIME,
    "previewImagePaths" TEXT,
    "keepOriginalRequested" BOOLEAN NOT NULL DEFAULT false,
    "originalBackupPath" TEXT,
    "originalSizeBytes" BIGINT,
    "replacementAction" TEXT,
    "warning" TEXT,
    "resourceThrottled" BOOLEAN NOT NULL DEFAULT false,
    "resourceThrottleReason" TEXT,
    "ffmpegThreads" INTEGER,
    "startedFromSeconds" REAL,
    "healingPointSeconds" REAL,
    "originalNodeId" TEXT,
    "manualAssignment" BOOLEAN NOT NULL DEFAULT false,
    "transferRequired" BOOLEAN NOT NULL DEFAULT false,
    "transferProgress" REAL NOT NULL DEFAULT 0,
    "transferSpeedMBps" REAL,
    "transferStartedAt" DATETIME,
    "transferCompletedAt" DATETIME,
    "transferError" TEXT,
    "remoteTempPath" TEXT,
    "transferRetryCount" INTEGER NOT NULL DEFAULT 0,
    "nodeId" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "jobs_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobs_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobs_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_jobs" ("afterSizeBytes", "autoHealedAt", "autoHealedProgress", "beforeSizeBytes", "completedAt", "createdAt", "decisionData", "decisionIssues", "decisionMadeAt", "decisionRequired", "error", "etaSeconds", "failedAt", "ffmpegThreads", "fileLabel", "filePath", "fps", "healingPointSeconds", "healthCheckRetries", "healthCheckStartedAt", "healthCheckedAt", "healthMessage", "healthScore", "healthStatus", "id", "isBlacklisted", "keepOriginalRequested", "lastProgressUpdate", "libraryId", "manualAssignment", "nextRetryAt", "nodeId", "originalBackupPath", "originalNodeId", "originalSizeBytes", "policyId", "previewImagePaths", "priority", "prioritySetAt", "progress", "replacementAction", "resourceThrottleReason", "resourceThrottled", "resumeTimestamp", "retryCount", "savedBytes", "savedPercent", "sourceCodec", "sourceContainer", "stage", "startedAt", "startedFromSeconds", "targetCodec", "targetContainer", "tempFilePath", "type", "updatedAt", "warning") SELECT "afterSizeBytes", "autoHealedAt", "autoHealedProgress", "beforeSizeBytes", "completedAt", "createdAt", "decisionData", "decisionIssues", "decisionMadeAt", "decisionRequired", "error", "etaSeconds", "failedAt", "ffmpegThreads", "fileLabel", "filePath", "fps", "healingPointSeconds", "healthCheckRetries", "healthCheckStartedAt", "healthCheckedAt", "healthMessage", "healthScore", "healthStatus", "id", "isBlacklisted", "keepOriginalRequested", "lastProgressUpdate", "libraryId", "manualAssignment", "nextRetryAt", "nodeId", "originalBackupPath", "originalNodeId", "originalSizeBytes", "policyId", "previewImagePaths", "priority", "prioritySetAt", "progress", "replacementAction", "resourceThrottleReason", "resourceThrottled", "resumeTimestamp", "retryCount", "savedBytes", "savedPercent", "sourceCodec", "sourceContainer", "stage", "startedAt", "startedFromSeconds", "targetCodec", "targetContainer", "tempFilePath", "type", "updatedAt", "warning" FROM "jobs";
DROP TABLE "jobs";
ALTER TABLE "new_jobs" RENAME TO "jobs";
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
CREATE INDEX "jobs_failedAt_idx" ON "jobs"("failedAt");
CREATE INDEX "jobs_autoHealedAt_idx" ON "jobs"("autoHealedAt");
CREATE INDEX "jobs_nextRetryAt_idx" ON "jobs"("nextRetryAt");
CREATE INDEX "jobs_stage_retryCount_nextRetryAt_idx" ON "jobs"("stage", "retryCount", "nextRetryAt");
CREATE INDEX "jobs_type_stage_idx" ON "jobs"("type", "stage");
CREATE INDEX "jobs_originalNodeId_idx" ON "jobs"("originalNodeId");
CREATE INDEX "jobs_manualAssignment_idx" ON "jobs"("manualAssignment");
CREATE INDEX "jobs_stage_originalNodeId_idx" ON "jobs"("stage", "originalNodeId");
CREATE INDEX "jobs_transferRequired_idx" ON "jobs"("transferRequired");
CREATE INDEX "jobs_stage_transferRequired_idx" ON "jobs"("stage", "transferRequired");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
