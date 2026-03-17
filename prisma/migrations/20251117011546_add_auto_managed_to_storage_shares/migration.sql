-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_storage_shares" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "serverAddress" TEXT NOT NULL,
    "sharePath" TEXT NOT NULL,
    "exportPath" TEXT,
    "mountPoint" TEXT NOT NULL,
    "mountOptions" TEXT,
    "readOnly" BOOLEAN NOT NULL DEFAULT true,
    "smbUsername" TEXT,
    "smbPassword" TEXT,
    "smbDomain" TEXT,
    "smbVersion" TEXT DEFAULT '3.0',
    "autoMount" BOOLEAN NOT NULL DEFAULT true,
    "addToFstab" BOOLEAN NOT NULL DEFAULT true,
    "mountOnDetection" BOOLEAN NOT NULL DEFAULT true,
    "autoManaged" BOOLEAN NOT NULL DEFAULT false,
    "isMounted" BOOLEAN NOT NULL DEFAULT false,
    "lastMountAt" DATETIME,
    "lastUnmountAt" DATETIME,
    "lastHealthCheckAt" DATETIME,
    "lastError" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "isReachable" BOOLEAN NOT NULL DEFAULT false,
    "supportsNFS" BOOLEAN NOT NULL DEFAULT false,
    "supportsSMB" BOOLEAN NOT NULL DEFAULT false,
    "detectedAt" DATETIME,
    "totalSizeBytes" BIGINT,
    "availableSizeBytes" BIGINT,
    "usedPercent" REAL,
    "nodeId" TEXT NOT NULL,
    "ownerNodeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "storage_shares_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_storage_shares" ("addToFstab", "autoMount", "availableSizeBytes", "createdAt", "detectedAt", "errorCount", "exportPath", "id", "isMounted", "isReachable", "lastError", "lastHealthCheckAt", "lastMountAt", "lastUnmountAt", "mountOnDetection", "mountOptions", "mountPoint", "name", "nodeId", "ownerNodeId", "protocol", "readOnly", "serverAddress", "sharePath", "smbDomain", "smbPassword", "smbUsername", "smbVersion", "status", "supportsNFS", "supportsSMB", "totalSizeBytes", "updatedAt", "usedPercent") SELECT "addToFstab", "autoMount", "availableSizeBytes", "createdAt", "detectedAt", "errorCount", "exportPath", "id", "isMounted", "isReachable", "lastError", "lastHealthCheckAt", "lastMountAt", "lastUnmountAt", "mountOnDetection", "mountOptions", "mountPoint", "name", "nodeId", "ownerNodeId", "protocol", "readOnly", "serverAddress", "sharePath", "smbDomain", "smbPassword", "smbUsername", "smbVersion", "status", "supportsNFS", "supportsSMB", "totalSizeBytes", "updatedAt", "usedPercent" FROM "storage_shares";
DROP TABLE "storage_shares";
ALTER TABLE "new_storage_shares" RENAME TO "storage_shares";
CREATE INDEX "storage_shares_nodeId_idx" ON "storage_shares"("nodeId");
CREATE INDEX "storage_shares_status_idx" ON "storage_shares"("status");
CREATE INDEX "storage_shares_protocol_idx" ON "storage_shares"("protocol");
CREATE INDEX "storage_shares_isMounted_idx" ON "storage_shares"("isMounted");
CREATE INDEX "storage_shares_autoMount_idx" ON "storage_shares"("autoMount");
CREATE INDEX "storage_shares_ownerNodeId_idx" ON "storage_shares"("ownerNodeId");
CREATE INDEX "storage_shares_serverAddress_idx" ON "storage_shares"("serverAddress");
CREATE UNIQUE INDEX "storage_shares_nodeId_mountPoint_key" ON "storage_shares"("nodeId", "mountPoint");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
