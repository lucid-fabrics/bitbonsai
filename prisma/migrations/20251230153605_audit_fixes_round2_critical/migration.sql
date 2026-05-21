-- CreateTable
CREATE TABLE IF NOT EXISTS "metrics_processed_jobs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrics_processed_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "metrics_processed_jobs_jobId_key" ON "metrics_processed_jobs"("jobId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "metrics_processed_jobs_jobId_idx" ON "metrics_processed_jobs"("jobId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "metrics_processed_jobs_processedAt_idx" ON "metrics_processed_jobs"("processedAt");
