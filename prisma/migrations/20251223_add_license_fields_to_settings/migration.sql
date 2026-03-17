-- AlterTable
ALTER TABLE "settings" ADD COLUMN "license_key" TEXT;
ALTER TABLE "settings" ADD COLUMN "license_last_verified" TIMESTAMP(3);
