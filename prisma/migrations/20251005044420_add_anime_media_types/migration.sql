-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_libraries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "watchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastScanAt" DATETIME,
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "totalSizeBytes" BIGINT NOT NULL DEFAULT 0,
    "nodeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "libraries_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_libraries" SELECT * FROM "libraries";
DROP TABLE "libraries";
ALTER TABLE "new_libraries" RENAME TO "libraries";

CREATE UNIQUE INDEX "libraries_nodeId_path_key" ON "libraries"("nodeId", "path");
CREATE INDEX "libraries_nodeId_idx" ON "libraries"("nodeId");
CREATE INDEX "libraries_enabled_idx" ON "libraries"("enabled");
CREATE INDEX "libraries_mediaType_idx" ON "libraries"("mediaType");
CREATE INDEX "libraries_lastScanAt_idx" ON "libraries"("lastScanAt");
CREATE INDEX "libraries_watchEnabled_idx" ON "libraries"("watchEnabled");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
