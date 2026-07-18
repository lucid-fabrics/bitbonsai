ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "repairedSourcePath" TEXT;

ALTER TABLE "file_failure_records" ADD COLUMN IF NOT EXISTS "lastSuccessfulCodec" TEXT;
ALTER TABLE "file_failure_records" ADD COLUMN IF NOT EXISTS "lastSuccessfulAt" TIMESTAMP(3);
ALTER TABLE "file_failure_records" ALTER COLUMN "lastFailedAt" DROP NOT NULL;
