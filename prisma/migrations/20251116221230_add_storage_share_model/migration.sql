-- CreateTable
CREATE TABLE "storage_shares" (
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

-- CreateIndex
CREATE INDEX "storage_shares_nodeId_idx" ON "storage_shares"("nodeId");

-- CreateIndex
CREATE INDEX "storage_shares_status_idx" ON "storage_shares"("status");

-- CreateIndex
CREATE INDEX "storage_shares_protocol_idx" ON "storage_shares"("protocol");

-- CreateIndex
CREATE INDEX "storage_shares_isMounted_idx" ON "storage_shares"("isMounted");

-- CreateIndex
CREATE INDEX "storage_shares_autoMount_idx" ON "storage_shares"("autoMount");

-- CreateIndex
CREATE INDEX "storage_shares_ownerNodeId_idx" ON "storage_shares"("ownerNodeId");

-- CreateIndex
CREATE INDEX "storage_shares_serverAddress_idx" ON "storage_shares"("serverAddress");

-- CreateIndex
CREATE UNIQUE INDEX "storage_shares_nodeId_mountPoint_key" ON "storage_shares"("nodeId", "mountPoint");
