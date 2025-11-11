-- CreateIndex
CREATE INDEX "jobs_failedAt_idx" ON "jobs"("failedAt");

-- CreateIndex
CREATE INDEX "jobs_autoHealedAt_idx" ON "jobs"("autoHealedAt");

-- CreateIndex
CREATE INDEX "jobs_nextRetryAt_idx" ON "jobs"("nextRetryAt");

-- CreateIndex
CREATE INDEX "jobs_stage_retryCount_nextRetryAt_idx" ON "jobs"("stage", "retryCount", "nextRetryAt");

-- CreateIndex
CREATE INDEX "node_registration_requests_createdAt_idx" ON "node_registration_requests"("createdAt");

-- CreateIndex
CREATE INDEX "node_registration_requests_tokenExpiresAt_status_idx" ON "node_registration_requests"("tokenExpiresAt", "status");
