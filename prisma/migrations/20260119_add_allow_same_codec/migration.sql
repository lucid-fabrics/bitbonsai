-- Add allowSameCodec field to policies table
-- This allows source and destination codec to be the same without triggering NEEDS_DECISION
ALTER TABLE "policies" ADD COLUMN "allowSameCodec" BOOLEAN NOT NULL DEFAULT false;
