-- MEDIUM #4 FIX: Allow policy deletion by setting jobs to NULL
-- Prevents blocking policy deletion when jobs exist

-- Step 1: Make policyId nullable
ALTER TABLE "jobs" ALTER COLUMN "policyId" DROP NOT NULL;

-- Step 2: Drop existing foreign key constraint
ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_policyId_fkey";

-- Step 3: Add new constraint with SET NULL on delete
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE SET NULL;
