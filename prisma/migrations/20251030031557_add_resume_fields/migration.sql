-- AlterTable
ALTER TABLE "jobs" ADD COLUMN "lastProgressUpdate" DATETIME;
ALTER TABLE "jobs" ADD COLUMN "resumeTimestamp" TEXT;
ALTER TABLE "jobs" ADD COLUMN "tempFilePath" TEXT;
