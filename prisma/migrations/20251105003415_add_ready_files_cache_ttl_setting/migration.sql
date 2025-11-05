-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "isSetupComplete" BOOLEAN NOT NULL DEFAULT false,
    "allowLocalNetworkWithoutAuth" BOOLEAN NOT NULL DEFAULT false,
    "defaultQueueView" TEXT NOT NULL DEFAULT 'ENCODING',
    "readyFilesCacheTtlMinutes" INTEGER NOT NULL DEFAULT 5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_settings" ("allowLocalNetworkWithoutAuth", "createdAt", "defaultQueueView", "id", "isSetupComplete", "updatedAt") SELECT "allowLocalNetworkWithoutAuth", "createdAt", "defaultQueueView", "id", "isSetupComplete", "updatedAt" FROM "settings";
DROP TABLE "settings";
ALTER TABLE "new_settings" RENAME TO "settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
