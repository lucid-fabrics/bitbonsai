-- CreateTable
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "maxNodes" INTEGER NOT NULL,
    "maxConcurrentJobs" INTEGER NOT NULL,
    "features" JSONB NOT NULL,
    "validUntil" DATETIME,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "nodes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceleration" TEXT NOT NULL,
    "pairingToken" TEXT,
    "apiKey" TEXT NOT NULL,
    "lastHeartbeat" DATETIME NOT NULL,
    "uptimeSeconds" INTEGER NOT NULL DEFAULT 0,
    "licenseId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "nodes_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "licenses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "libraries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastScanAt" DATETIME,
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "totalSizeBytes" BIGINT NOT NULL DEFAULT 0,
    "nodeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "libraries_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "targetCodec" TEXT NOT NULL,
    "targetQuality" INTEGER NOT NULL,
    "deviceProfiles" JSONB NOT NULL,
    "advancedSettings" JSONB NOT NULL,
    "atomicReplace" BOOLEAN NOT NULL DEFAULT true,
    "verifyOutput" BOOLEAN NOT NULL DEFAULT true,
    "skipSeeding" BOOLEAN NOT NULL DEFAULT true,
    "libraryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "policies_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filePath" TEXT NOT NULL,
    "fileLabel" TEXT NOT NULL,
    "sourceCodec" TEXT NOT NULL,
    "targetCodec" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "progress" REAL NOT NULL DEFAULT 0,
    "etaSeconds" INTEGER,
    "beforeSizeBytes" BIGINT NOT NULL,
    "afterSizeBytes" BIGINT,
    "savedBytes" BIGINT,
    "savedPercent" REAL,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "error" TEXT,
    "nodeId" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "jobs_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobs_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobs_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "metrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "nodeId" TEXT,
    "licenseId" TEXT,
    "jobsCompleted" INTEGER NOT NULL DEFAULT 0,
    "jobsFailed" INTEGER NOT NULL DEFAULT 0,
    "totalSavedBytes" BIGINT NOT NULL DEFAULT 0,
    "avgThroughputFilesPerHour" REAL NOT NULL DEFAULT 0,
    "codecDistribution" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "metrics_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "metrics_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "licenses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "licenses_key_key" ON "licenses"("key");

-- CreateIndex
CREATE INDEX "licenses_status_idx" ON "licenses"("status");

-- CreateIndex
CREATE INDEX "licenses_tier_idx" ON "licenses"("tier");

-- CreateIndex
CREATE INDEX "licenses_email_idx" ON "licenses"("email");

-- CreateIndex
CREATE INDEX "licenses_validUntil_idx" ON "licenses"("validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "nodes_pairingToken_key" ON "nodes"("pairingToken");

-- CreateIndex
CREATE UNIQUE INDEX "nodes_apiKey_key" ON "nodes"("apiKey");

-- CreateIndex
CREATE INDEX "nodes_status_idx" ON "nodes"("status");

-- CreateIndex
CREATE INDEX "nodes_role_idx" ON "nodes"("role");

-- CreateIndex
CREATE INDEX "nodes_licenseId_idx" ON "nodes"("licenseId");

-- CreateIndex
CREATE INDEX "nodes_lastHeartbeat_idx" ON "nodes"("lastHeartbeat");

-- CreateIndex
CREATE INDEX "libraries_nodeId_idx" ON "libraries"("nodeId");

-- CreateIndex
CREATE INDEX "libraries_enabled_idx" ON "libraries"("enabled");

-- CreateIndex
CREATE INDEX "libraries_mediaType_idx" ON "libraries"("mediaType");

-- CreateIndex
CREATE INDEX "libraries_lastScanAt_idx" ON "libraries"("lastScanAt");

-- CreateIndex
CREATE UNIQUE INDEX "libraries_nodeId_path_key" ON "libraries"("nodeId", "path");

-- CreateIndex
CREATE INDEX "policies_libraryId_idx" ON "policies"("libraryId");

-- CreateIndex
CREATE INDEX "policies_preset_idx" ON "policies"("preset");

-- CreateIndex
CREATE INDEX "policies_targetCodec_idx" ON "policies"("targetCodec");

-- CreateIndex
CREATE INDEX "jobs_stage_idx" ON "jobs"("stage");

-- CreateIndex
CREATE INDEX "jobs_nodeId_idx" ON "jobs"("nodeId");

-- CreateIndex
CREATE INDEX "jobs_libraryId_idx" ON "jobs"("libraryId");

-- CreateIndex
CREATE INDEX "jobs_policyId_idx" ON "jobs"("policyId");

-- CreateIndex
CREATE INDEX "jobs_createdAt_idx" ON "jobs"("createdAt");

-- CreateIndex
CREATE INDEX "jobs_completedAt_idx" ON "jobs"("completedAt");

-- CreateIndex
CREATE INDEX "jobs_stage_nodeId_idx" ON "jobs"("stage", "nodeId");

-- CreateIndex
CREATE INDEX "metrics_date_idx" ON "metrics"("date");

-- CreateIndex
CREATE INDEX "metrics_nodeId_idx" ON "metrics"("nodeId");

-- CreateIndex
CREATE INDEX "metrics_licenseId_idx" ON "metrics"("licenseId");

-- CreateIndex
CREATE INDEX "metrics_date_nodeId_idx" ON "metrics"("date", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_date_nodeId_licenseId_key" ON "metrics"("date", "nodeId", "licenseId");
