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
    "nodeId" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "jobs_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobs_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobs_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_jobs" ("afterSizeBytes", "autoHealedAt", "autoHealedProgress", "beforeSizeBytes", "completedAt", "createdAt", "decisionData", "decisionIssues", "decisionMadeAt", "decisionRequired", "error", "etaSeconds", "failedAt", "ffmpegThreads", "fileLabel", "filePath", "fps", "healingPointSeconds", "healthCheckRetries", "healthCheckStartedAt", "healthCheckedAt", "healthMessage", "healthScore", "healthStatus", "id", "isBlacklisted", "keepOriginalRequested", "lastProgressUpdate", "libraryId", "nextRetryAt", "nodeId", "originalBackupPath", "originalSizeBytes", "policyId", "previewImagePaths", "priority", "prioritySetAt", "progress", "replacementAction", "resourceThrottleReason", "resourceThrottled", "resumeTimestamp", "retryCount", "savedBytes", "savedPercent", "sourceCodec", "sourceContainer", "stage", "startedAt", "startedFromSeconds", "targetCodec", "targetContainer", "tempFilePath", "type", "updatedAt", "warning") SELECT "afterSizeBytes", "autoHealedAt", "autoHealedProgress", "beforeSizeBytes", "completedAt", "createdAt", "decisionData", "decisionIssues", "decisionMadeAt", "decisionRequired", "error", "etaSeconds", "failedAt", "ffmpegThreads", "fileLabel", "filePath", "fps", "healingPointSeconds", "healthCheckRetries", "healthCheckStartedAt", "healthCheckedAt", "healthMessage", "healthScore", "healthStatus", "id", "isBlacklisted", "keepOriginalRequested", "lastProgressUpdate", "libraryId", "nextRetryAt", "nodeId", "originalBackupPath", "originalSizeBytes", "policyId", "previewImagePaths", "priority", "prioritySetAt", "progress", "replacementAction", "resourceThrottleReason", "resourceThrottled", "resumeTimestamp", "retryCount", "savedBytes", "savedPercent", "sourceCodec", "sourceContainer", "stage", "startedAt", "startedFromSeconds", "targetCodec", "targetContainer", "tempFilePath", "type", "updatedAt", "warning" FROM "jobs";
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
CREATE TABLE "new_nodes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceleration" TEXT NOT NULL,
    "pairingToken" TEXT,
    "pairingExpiresAt" DATETIME,
    "mainNodeUrl" TEXT,
    "apiKey" TEXT NOT NULL,
    "lastHeartbeat" DATETIME NOT NULL,
    "uptimeSeconds" INTEGER NOT NULL DEFAULT 0,
    "maxWorkers" INTEGER NOT NULL DEFAULT 1,
    "cpuLimit" INTEGER NOT NULL DEFAULT 80,
    "lastSyncedAt" DATETIME,
    "syncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "syncRetryCount" INTEGER NOT NULL DEFAULT 0,
    "syncError" TEXT,
    "networkLocation" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "hasSharedStorage" BOOLEAN NOT NULL DEFAULT false,
    "storageBasePath" TEXT,
    "ipAddress" TEXT,
    "publicUrl" TEXT,
    "vpnIpAddress" TEXT,
    "maxTransferSizeMB" INTEGER NOT NULL DEFAULT 50000,
    "cpuCores" INTEGER,
    "ramGB" INTEGER,
    "bandwidthMbps" INTEGER,
    "latencyMs" INTEGER,
    "lastSpeedTest" DATETIME,
    "hasGpu" BOOLEAN NOT NULL DEFAULT false,
    "avgEncodingSpeed" REAL,
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleWindows" JSONB,
    "licenseId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "nodes_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "licenses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_nodes" ("acceleration", "apiKey", "bandwidthMbps", "cpuCores", "cpuLimit", "createdAt", "hasSharedStorage", "id", "ipAddress", "lastHeartbeat", "lastSpeedTest", "lastSyncedAt", "latencyMs", "licenseId", "mainNodeUrl", "maxTransferSizeMB", "maxWorkers", "name", "networkLocation", "pairingExpiresAt", "pairingToken", "publicUrl", "ramGB", "role", "status", "storageBasePath", "syncError", "syncRetryCount", "syncStatus", "updatedAt", "uptimeSeconds", "version", "vpnIpAddress") SELECT "acceleration", "apiKey", "bandwidthMbps", "cpuCores", "cpuLimit", "createdAt", "hasSharedStorage", "id", "ipAddress", "lastHeartbeat", "lastSpeedTest", "lastSyncedAt", "latencyMs", "licenseId", "mainNodeUrl", "maxTransferSizeMB", "maxWorkers", "name", "networkLocation", "pairingExpiresAt", "pairingToken", "publicUrl", "ramGB", "role", "status", "storageBasePath", "syncError", "syncRetryCount", "syncStatus", "updatedAt", "uptimeSeconds", "version", "vpnIpAddress" FROM "nodes";
DROP TABLE "nodes";
ALTER TABLE "new_nodes" RENAME TO "nodes";
CREATE UNIQUE INDEX "nodes_pairingToken_key" ON "nodes"("pairingToken");
CREATE UNIQUE INDEX "nodes_apiKey_key" ON "nodes"("apiKey");
CREATE INDEX "nodes_status_idx" ON "nodes"("status");
CREATE INDEX "nodes_role_idx" ON "nodes"("role");
CREATE INDEX "nodes_licenseId_idx" ON "nodes"("licenseId");
CREATE INDEX "nodes_lastHeartbeat_idx" ON "nodes"("lastHeartbeat");
CREATE INDEX "nodes_syncStatus_idx" ON "nodes"("syncStatus");
CREATE INDEX "nodes_networkLocation_idx" ON "nodes"("networkLocation");
CREATE INDEX "nodes_hasSharedStorage_idx" ON "nodes"("hasSharedStorage");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
