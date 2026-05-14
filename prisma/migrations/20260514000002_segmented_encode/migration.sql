-- Segmented encode: Job columns
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "segmentedEncode" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "segmentCount" INTEGER;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "currentSegmentIndex" INTEGER;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "segmentDurationSecs" INTEGER NOT NULL DEFAULT 300;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "segmentsDir" TEXT;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "concatListPath" TEXT;
CREATE INDEX IF NOT EXISTS "jobs_segmentedEncode_idx" ON "jobs"("segmentedEncode");

-- Segmented encode: Settings columns
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "segmentedEncodeEnabled" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "segmentedEncodeThresholdMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "segmentDurationSeconds" INTEGER NOT NULL DEFAULT 300;

-- JobSegment table
CREATE TABLE IF NOT EXISTS "job_segments" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "segmentIndex" INTEGER NOT NULL,
  "startSeconds" DOUBLE PRECISION NOT NULL,
  "endSeconds" DOUBLE PRECISION NOT NULL,
  "durationSeconds" DOUBLE PRECISION NOT NULL,
  "tempPath" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "durationVerified" DOUBLE PRECISION,
  "sizeBytes" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "job_segments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "job_segments_jobId_segmentIndex_key" UNIQUE ("jobId", "segmentIndex"),
  CONSTRAINT "job_segments_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "job_segments_jobId_idx" ON "job_segments"("jobId");
CREATE INDEX IF NOT EXISTS "job_segments_jobId_completedAt_idx" ON "job_segments"("jobId", "completedAt");
CREATE INDEX IF NOT EXISTS "job_segments_nodeId_idx" ON "job_segments"("nodeId");
