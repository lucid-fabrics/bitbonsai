-- Trial-encode preflight: tracks when the currently selected codec last
-- passed a short sample encode, so retries with an unchanged codec skip
-- re-validating.
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "trialEncodeValidatedAt" TIMESTAMP(3);
