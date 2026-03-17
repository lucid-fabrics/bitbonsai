-- Add operational settings to settings table
-- UX: Eliminates timeout-related environment variables

-- Job cleanup & stuck detection
ALTER TABLE "settings" ADD COLUMN "jobStuckThresholdMinutes" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "settings" ADD COLUMN "jobEncodingTimeoutHours" INTEGER NOT NULL DEFAULT 2;

-- Stuck job recovery worker
ALTER TABLE "settings" ADD COLUMN "recoveryIntervalMs" INTEGER NOT NULL DEFAULT 120000;
ALTER TABLE "settings" ADD COLUMN "healthCheckTimeoutMin" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "settings" ADD COLUMN "encodingTimeoutMin" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "settings" ADD COLUMN "verifyingTimeoutMin" INTEGER NOT NULL DEFAULT 30;

-- Health check worker
ALTER TABLE "settings" ADD COLUMN "healthCheckConcurrency" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "settings" ADD COLUMN "healthCheckIntervalMs" INTEGER NOT NULL DEFAULT 2000;
ALTER TABLE "settings" ADD COLUMN "maxRetryAttempts" INTEGER NOT NULL DEFAULT 3;

-- Backup cleanup worker
ALTER TABLE "settings" ADD COLUMN "backupCleanupIntervalMs" INTEGER NOT NULL DEFAULT 3600000;
ALTER TABLE "settings" ADD COLUMN "backupRetentionHours" INTEGER NOT NULL DEFAULT 24;
