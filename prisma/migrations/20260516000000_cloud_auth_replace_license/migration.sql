-- Migration: Replace license-key system with cloud account auth
-- Removes License model, Patreon fields, licenseId FKs
-- Adds cloud-auth fields to Settings

-- Step 1: Drop licenseId FK from nodes (must drop before License table)
ALTER TABLE "nodes" DROP CONSTRAINT IF EXISTS "nodes_licenseId_fkey";
ALTER TABLE "nodes" DROP COLUMN IF EXISTS "license_id";
ALTER TABLE "nodes" DROP COLUMN IF EXISTS "licenseId";
DROP INDEX IF EXISTS "nodes_licenseId_idx";
DROP INDEX IF EXISTS "nodes_license_id_idx";

-- Step 2: Drop licenseId FK and column from metrics
ALTER TABLE "metrics" DROP CONSTRAINT IF EXISTS "metrics_licenseId_fkey";
ALTER TABLE "metrics" DROP COLUMN IF EXISTS "license_id";
ALTER TABLE "metrics" DROP COLUMN IF EXISTS "licenseId";
DROP INDEX IF EXISTS "metrics_licenseId_idx";
DROP INDEX IF EXISTS "metrics_license_id_idx";

-- Step 3: Fix metrics unique constraint (remove licenseId from composite)
ALTER TABLE "metrics" DROP CONSTRAINT IF EXISTS "metrics_date_nodeId_licenseId_key";
ALTER TABLE "metrics" DROP CONSTRAINT IF EXISTS "metrics_date_node_id_license_id_key";
-- Re-create without licenseId
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_date_node_id_key" UNIQUE ("date", "node_id");

-- Step 4: Drop License table
DROP TABLE IF EXISTS "licenses" CASCADE;

-- Step 5: Drop LicenseTier and LicenseStatus enums
DROP TYPE IF EXISTS "LicenseTier";
DROP TYPE IF EXISTS "LicenseStatus";

-- Step 6: Remove Patreon columns from users
ALTER TABLE "users"
  DROP COLUMN IF EXISTS "patreonId",
  DROP COLUMN IF EXISTS "patreonAccessToken",
  DROP COLUMN IF EXISTS "patreonRefreshToken",
  DROP COLUMN IF EXISTS "patreonTokenExpiry",
  DROP COLUMN IF EXISTS "patreonEmail",
  DROP COLUMN IF EXISTS "patreonFullName",
  DROP COLUMN IF EXISTS "patreonTier",
  DROP COLUMN IF EXISTS "patreonLastSync";

DROP INDEX IF EXISTS "users_patreonId_key";
DROP INDEX IF EXISTS "users_patreonId_idx";
DROP INDEX IF EXISTS "users_patreonTier_idx";

-- Step 7: Remove old license columns from settings
ALTER TABLE "settings"
  DROP COLUMN IF EXISTS "license_key",
  DROP COLUMN IF EXISTS "license_last_verified";

-- Step 8: Add cloud-auth columns to settings
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "machine_id" TEXT,
  ADD COLUMN IF NOT EXISTS "machine_name" TEXT,
  ADD COLUMN IF NOT EXISTS "cloud_device_token" TEXT,
  ADD COLUMN IF NOT EXISTS "cloud_user_email" TEXT,
  ADD COLUMN IF NOT EXISTS "cloud_tier" TEXT,
  ADD COLUMN IF NOT EXISTS "cloud_max_nodes" INTEGER,
  ADD COLUMN IF NOT EXISTS "cloud_max_concurrent_jobs" INTEGER,
  ADD COLUMN IF NOT EXISTS "cloud_validated_at" TIMESTAMP(3);

-- Unique constraint on machine_id
CREATE UNIQUE INDEX IF NOT EXISTS "settings_machine_id_key" ON "settings"("machine_id");
