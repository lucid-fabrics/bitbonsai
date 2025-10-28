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
    "licenseId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "nodes_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "licenses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_nodes" ("acceleration", "apiKey", "createdAt", "id", "lastHeartbeat", "licenseId", "name", "pairingExpiresAt", "pairingToken", "role", "status", "updatedAt", "uptimeSeconds", "version") SELECT "acceleration", "apiKey", "createdAt", "id", "lastHeartbeat", "licenseId", "name", "pairingExpiresAt", "pairingToken", "role", "status", "updatedAt", "uptimeSeconds", "version" FROM "nodes";
DROP TABLE "nodes";
ALTER TABLE "new_nodes" RENAME TO "nodes";
CREATE UNIQUE INDEX "nodes_pairingToken_key" ON "nodes"("pairingToken");
CREATE UNIQUE INDEX "nodes_apiKey_key" ON "nodes"("apiKey");
CREATE INDEX "nodes_status_idx" ON "nodes"("status");
CREATE INDEX "nodes_role_idx" ON "nodes"("role");
CREATE INDEX "nodes_licenseId_idx" ON "nodes"("licenseId");
CREATE INDEX "nodes_lastHeartbeat_idx" ON "nodes"("lastHeartbeat");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
