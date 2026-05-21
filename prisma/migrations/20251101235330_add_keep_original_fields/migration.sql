-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filePath" TEXT NOT NULL,
    "fileLabel" TEXT NOT NULL,
    "sourceCodec" TEXT NOT NULL,
    "targetCodec" TEXT NOT NULL,
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
    "priority" INTEGER NOT NULL DEFAULT 0,
    "prioritySetAt" DATETIME,
    "tempFilePath" TEXT,
    "resumeTimestamp" TEXT,
    "lastProgressUpdate" DATETIME,
    "keepOriginalRequested" BOOLEAN NOT NULL DEFAULT false,
    "originalBackupPath" TEXT,
    "originalSizeBytes" BIGINT,
    "replacementAction" TEXT,
    "nodeId" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "jobs_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobs_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobs_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_jobs" ("afterSizeBytes", "autoHealedAt", "autoHealedProgress", "beforeSizeBytes", "completedAt", "createdAt", "error", "etaSeconds", "failedAt", "fileLabel", "filePath", "fps", "healthCheckRetries", "healthCheckStartedAt", "healthCheckedAt", "healthMessage", "healthScore", "healthStatus", "id", "isBlacklisted", "lastProgressUpdate", "libraryId", "nextRetryAt", "nodeId", "policyId", "priority", "prioritySetAt", "progress", "resumeTimestamp", "retryCount", "savedBytes", "savedPercent", "sourceCodec", "stage", "startedAt", "targetCodec", "tempFilePath", "updatedAt") SELECT "afterSizeBytes", "autoHealedAt", "autoHealedProgress", "beforeSizeBytes", "completedAt", "createdAt", "error", "etaSeconds", "failedAt", "fileLabel", "filePath", "fps", "healthCheckRetries", "healthCheckStartedAt", "healthCheckedAt", "healthMessage", "healthScore", "healthStatus", "id", "isBlacklisted", "lastProgressUpdate", "libraryId", "nextRetryAt", "nodeId", "policyId", "priority", "prioritySetAt", "progress", "resumeTimestamp", "retryCount", "savedBytes", "savedPercent", "sourceCodec", "stage", "startedAt", "targetCodec", "tempFilePath", "updatedAt" FROM "jobs";
DROP TABLE "jobs";
ALTER TABLE "new_jobs" RENAME TO "jobs";
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
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
