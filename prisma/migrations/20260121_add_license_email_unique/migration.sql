-- AlterTable: Make email unique on licenses table
-- This enables atomic upsert operations by email

-- First, deduplicate if any duplicates exist (keep the most recent)
DELETE FROM licenses l1
WHERE EXISTS (
  SELECT 1 FROM licenses l2
  WHERE l2.email = l1.email
    AND l2."updatedAt" > l1."updatedAt"
);

-- Add unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS "licenses_email_key" ON "licenses"("email");

-- Remove redundant non-unique index (unique constraint creates its own index)
DROP INDEX IF EXISTS "licenses_email_idx";
-- Remove patreonId index since patreonId already has @unique
DROP INDEX IF EXISTS "licenses_patreonId_idx";
