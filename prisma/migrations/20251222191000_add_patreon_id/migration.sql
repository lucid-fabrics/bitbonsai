-- Add patreonId field to License table for Patreon OAuth integration
ALTER TABLE "licenses" ADD COLUMN "patreonId" TEXT;

-- Add unique constraint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_patreonId_key" UNIQUE ("patreonId");

-- Add index for faster lookups
CREATE INDEX "licenses_patreonId_idx" ON "licenses"("patreonId");
