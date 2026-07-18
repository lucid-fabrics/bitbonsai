-- Per-stream inventory captured at health check (codec/type/pix_fmt per
-- stream) so the ffmpeg command builder can make container-safe mapping,
-- subtitle, audio-transcode, and bit-depth decisions.
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "streamInfo" JSONB;
