-- Add advancedModeEnabled column to settings table
-- Default: false (minimal mode for simpler UX)
ALTER TABLE "settings" ADD COLUMN "advancedModeEnabled" BOOLEAN NOT NULL DEFAULT false;
