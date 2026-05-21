-- AlterTable: Add Patreon OAuth fields to User model
ALTER TABLE "users" ADD COLUMN "patreonId" TEXT;
ALTER TABLE "users" ADD COLUMN "patreonAccessToken" TEXT;
ALTER TABLE "users" ADD COLUMN "patreonRefreshToken" TEXT;
ALTER TABLE "users" ADD COLUMN "patreonTokenExpiry" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "patreonEmail" TEXT;
ALTER TABLE "users" ADD COLUMN "patreonFullName" TEXT;
ALTER TABLE "users" ADD COLUMN "patreonTier" "LicenseTier";
ALTER TABLE "users" ADD COLUMN "patreonLastSync" TIMESTAMP(3);

-- CreateIndex: Add unique constraint on patreonId
CREATE UNIQUE INDEX "users_patreonId_key" ON "users"("patreonId");

-- CreateIndex: Add index on patreonTier for filtering
CREATE INDEX "users_patreonTier_idx" ON "users"("patreonTier");
