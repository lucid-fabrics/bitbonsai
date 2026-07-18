-- Segmented encode on by default: long files (> threshold) get resumable,
-- per-segment-verified encodes so an interruption loses at most one segment.
ALTER TABLE "settings" ALTER COLUMN "segmentedEncodeEnabled" SET DEFAULT TRUE;
UPDATE "settings" SET "segmentedEncodeEnabled" = TRUE;
