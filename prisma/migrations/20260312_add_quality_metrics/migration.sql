-- Add quality metrics fields to Job table (VMAF/PSNR/SSIM post-encoding analysis)
ALTER TABLE "Job" ADD COLUMN "qualityMetrics" JSONB;
ALTER TABLE "Job" ADD COLUMN "qualityMetricsAt" TIMESTAMP(3);

-- Add quality metrics toggle to Settings table (opt-in, CPU-intensive)
ALTER TABLE "Settings" ADD COLUMN "qualityMetricsEnabled" BOOLEAN NOT NULL DEFAULT false;
