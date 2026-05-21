-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_nodes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceleration" TEXT NOT NULL,
    "pairingToken" TEXT,
    "pairingExpiresAt" DATETIME,
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
    "publicUrl" TEXT,
    "vpnIpAddress" TEXT,
    "maxTransferSizeMB" INTEGER NOT NULL DEFAULT 50000,
    "cpuCores" INTEGER,
    "ramGB" INTEGER,
    "bandwidthMbps" INTEGER,
    "latencyMs" INTEGER,
    "lastSpeedTest" DATETIME,
    "licenseId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "nodes_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "licenses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_nodes" ("acceleration", "apiKey", "cpuLimit", "createdAt", "id", "lastHeartbeat", "lastSyncedAt", "licenseId", "maxWorkers", "name", "pairingExpiresAt", "pairingToken", "role", "status", "syncError", "syncRetryCount", "syncStatus", "updatedAt", "uptimeSeconds", "version") SELECT "acceleration", "apiKey", "cpuLimit", "createdAt", "id", "lastHeartbeat", "lastSyncedAt", "licenseId", "maxWorkers", "name", "pairingExpiresAt", "pairingToken", "role", "status", "syncError", "syncRetryCount", "syncStatus", "updatedAt", "uptimeSeconds", "version" FROM "nodes";
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
