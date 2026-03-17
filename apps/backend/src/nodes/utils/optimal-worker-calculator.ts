import type { AccelerationType } from '@prisma/client';

/**
 * Recommended worker configuration based on hardware analysis
 */
export interface OptimalWorkerConfig {
  recommendedMaxWorkers: number;
  reasoning: string;
  cpuCoresPerJob: number;
  estimatedLoadAverage: number;
}

/**
 * Calculate optimal number of concurrent workers based on hardware specs
 *
 * Strategy:
 * - CPU encoding: Allocate 6-8 cores per job for optimal performance
 * - GPU encoding: Can handle more jobs (GPU does heavy lifting)
 * - Reserve cores for system overhead (OS, other services)
 *
 * @param cpuCores - Total CPU cores available
 * @param acceleration - Hardware acceleration type
 * @param ramGb - Total system RAM in GB (optional, for future use)
 * @returns Recommended worker configuration
 */
export function calculateOptimalWorkers(
  cpuCores: number,
  acceleration: AccelerationType,
  ramGb?: number
): OptimalWorkerConfig {
  // Minimum cores required for encoding (reserve some for system)
  const MIN_CORES_FOR_SYSTEM = 2;
  const availableCores = Math.max(cpuCores - MIN_CORES_FOR_SYSTEM, 1);

  let recommendedMaxWorkers: number;
  let cpuCoresPerJob: number;
  let reasoning: string;

  switch (acceleration) {
    case 'NVIDIA':
    case 'INTEL_QSV':
    case 'AMD':
    case 'APPLE_M':
      // GPU acceleration: Can handle more concurrent jobs
      // GPU does heavy lifting, CPU just manages I/O and muxing
      cpuCoresPerJob = 2; // Minimal CPU usage per job
      recommendedMaxWorkers = Math.floor(availableCores / cpuCoresPerJob);
      // Cap at 8 for GPU (most GPUs handle 4-8 streams well)
      recommendedMaxWorkers = Math.min(recommendedMaxWorkers, 8);
      reasoning = `GPU acceleration detected. Each job uses ~${cpuCoresPerJob} CPU cores. GPU can handle ${recommendedMaxWorkers} concurrent streams efficiently.`;
      break;
    default:
      // CPU encoding: More CPU-intensive
      // AV1 decoding + HEVC encoding requires substantial CPU power
      if (cpuCores >= 32) {
        // High-core systems (32+): Allocate 8 cores per job
        cpuCoresPerJob = 8;
        recommendedMaxWorkers = Math.floor(availableCores / cpuCoresPerJob);
        reasoning = `High-core CPU system (${cpuCores} cores). Allocating ${cpuCoresPerJob} cores per job for optimal AV1→HEVC transcoding performance.`;
      } else if (cpuCores >= 16) {
        // Mid-range systems (16-31): Allocate 6 cores per job
        cpuCoresPerJob = 6;
        recommendedMaxWorkers = Math.floor(availableCores / cpuCoresPerJob);
        reasoning = `Mid-range CPU system (${cpuCores} cores). Allocating ${cpuCoresPerJob} cores per job for balanced performance.`;
      } else if (cpuCores >= 8) {
        // Low-end systems (8-15): Allocate 4 cores per job
        cpuCoresPerJob = 4;
        recommendedMaxWorkers = Math.floor(availableCores / cpuCoresPerJob);
        reasoning = `Standard CPU system (${cpuCores} cores). Allocating ${cpuCoresPerJob} cores per job.`;
      } else {
        // Very low-end systems (<8): Single job only
        cpuCoresPerJob = availableCores;
        recommendedMaxWorkers = 1;
        reasoning = `Limited CPU resources (${cpuCores} cores). Running single job to ensure completion.`;
      }
      break;
  }

  // Ensure at least 1 worker
  recommendedMaxWorkers = Math.max(recommendedMaxWorkers, 1);

  // Calculate estimated load average (cores per job * workers)
  const estimatedLoadAverage = cpuCoresPerJob * recommendedMaxWorkers;

  return {
    recommendedMaxWorkers,
    reasoning,
    cpuCoresPerJob,
    estimatedLoadAverage,
  };
}

/**
 * Get human-readable recommendation summary
 */
export function getRecommendationSummary(
  currentWorkers: number,
  config: OptimalWorkerConfig
): string {
  if (currentWorkers === config.recommendedMaxWorkers) {
    return `✅ Your configuration is optimal (${currentWorkers} workers)`;
  }

  if (currentWorkers > config.recommendedMaxWorkers) {
    return `⚠️ Consider reducing from ${currentWorkers} → ${config.recommendedMaxWorkers} workers to prevent CPU overload and job failures`;
  }

  return `💡 You could increase from ${currentWorkers} → ${config.recommendedMaxWorkers} workers for better throughput`;
}
