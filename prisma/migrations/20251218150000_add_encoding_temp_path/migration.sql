-- Add encodingTempPath field to nodes table
-- Per-node encoding cache configuration (eliminates ENCODING_TEMP_PATH env var)
ALTER TABLE "nodes" ADD COLUMN "encodingTempPath" TEXT;
