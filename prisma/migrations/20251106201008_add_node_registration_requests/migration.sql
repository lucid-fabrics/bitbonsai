-- CreateTable
CREATE TABLE "node_registration_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "childNodeId" TEXT,
    "childNodeName" TEXT NOT NULL,
    "childVersion" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "containerType" TEXT NOT NULL,
    "hardwareSpecs" JSONB NOT NULL,
    "acceleration" TEXT NOT NULL,
    "macAddress" TEXT,
    "subnet" TEXT,
    "pairingToken" TEXT NOT NULL,
    "tokenExpiresAt" DATETIME NOT NULL,
    "tokenGeneratedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" DATETIME,
    "mainNodeId" TEXT NOT NULL,
    "message" TEXT,
    "rejectionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "node_registration_requests_mainNodeId_fkey" FOREIGN KEY ("mainNodeId") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "node_registration_requests_pairingToken_key" ON "node_registration_requests"("pairingToken");

-- CreateIndex
CREATE INDEX "node_registration_requests_status_idx" ON "node_registration_requests"("status");

-- CreateIndex
CREATE INDEX "node_registration_requests_mainNodeId_idx" ON "node_registration_requests"("mainNodeId");

-- CreateIndex
CREATE INDEX "node_registration_requests_pairingToken_idx" ON "node_registration_requests"("pairingToken");

-- CreateIndex
CREATE INDEX "node_registration_requests_tokenExpiresAt_idx" ON "node_registration_requests"("tokenExpiresAt");

-- CreateIndex
CREATE INDEX "node_registration_requests_status_mainNodeId_idx" ON "node_registration_requests"("status", "mainNodeId");

-- CreateIndex
CREATE INDEX "node_registration_requests_macAddress_idx" ON "node_registration_requests"("macAddress");
