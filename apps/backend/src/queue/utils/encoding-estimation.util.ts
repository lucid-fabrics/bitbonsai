/**
 * Encoding Estimation Utilities
 *
 * Provides pre-encoding size and time estimates to help users make informed decisions.
 * Based on typical compression ratios per codec and quality presets.
 */

/**
 * Typical compression ratios by target codec (source → target)
 * These are conservative estimates based on real-world data.
 */
export enum CompressionRatios {
  /** H.264 → HEVC: typically 40-50% smaller */
  H264_TO_HEVC = 0.45,
  /** H.264 → AV1: typically 50-60% smaller */
  H264_TO_AV1 = 0.4,
  /** HEVC → HEVC (re-encode): typically 10-20% smaller */
  HEVC_TO_HEVC = 0.85,
  /** HEVC → AV1: typically 20-30% smaller */
  HEVC_TO_AV1 = 0.75,
  /** Any → same codec: minimal savings */
  SAME_CODEC = 0.95,
}

/**
 * CRF-to-quality mapping (lower CRF = higher quality = larger file)
 * Using x264/x265/AV1 equivalent quality points.
 */
export const CRF_QUALITY_MAP: Record<string, number> = {
  // x264/AVC presets (lower = better quality)
  '18': 95, // High quality
  '20': 90, // Good quality
  '23': 85, // Default
  '25': 80,
  '28': 70, // Aggressive
  // x265/HEVC (tends to produce smaller files at same CRF)
  'hevc-18': 90,
  'hevc-20': 85,
  'hevc-23': 80,
  'hevc-25': 75,
  'hevc-28': 65,
  // AV1 (tends to produce smallest files)
  'av1-18': 88,
  'av1-20': 83,
  'av1-23': 78,
  'av1-25': 72,
  'av1-28': 60,
};

/**
 * Get compression ratio based on source and target codecs
 * @param sourceCodec Source codec (e.g., "H.264", "hevc")
 * @param targetCodec Target codec (e.g., "HEVC", "av1")
 * @returns Ratio multiplier (0.45 = 45% of original size)
 */
export function getCompressionRatio(sourceCodec: string, targetCodec: string): number {
  const source = sourceCodec.toLowerCase();
  const target = targetCodec.toLowerCase();

  // Exact same codec = minimal savings (except HEVC re-encode which benefits from codec improvements)
  if (source === target) {
    // HEVC re-encode benefits from encoder improvements even with same codec
    if (source === 'hevc' || source.includes('265')) {
      return CompressionRatios.HEVC_TO_HEVC;
    }
    return CompressionRatios.SAME_CODEC;
  }

  // H.264/AVC → HEVC
  if (source === 'h.264' || source === 'avc' || source.includes('264')) {
    if (target.includes('265') || target === 'hevc') {
      return CompressionRatios.H264_TO_HEVC;
    }
    if (target === 'av1') {
      return CompressionRatios.H264_TO_AV1;
    }
  }

  // HEVC → AV1
  if (source === 'hevc' || source.includes('265')) {
    if (target === 'av1') {
      return CompressionRatios.HEVC_TO_AV1;
    }
    // HEVC to any other = moderate savings
    return CompressionRatios.HEVC_TO_HEVC;
  }

  // Default: moderate savings
  return 0.65;
}

/**
 * Estimate output file size
 * @param sourceSizeBytes Original file size in bytes
 * @param sourceCodec Source codec
 * @param targetCodec Target codec
 * @param crf Optional CRF value for more accurate estimation
 * @returns Estimated output size in bytes
 */
export function estimateOutputSize(
  sourceSizeBytes: bigint | number,
  sourceCodec: string,
  targetCodec: string,
  crf?: string
): bigint {
  const ratio = getCompressionRatio(sourceCodec, targetCodec);

  // Adjust ratio based on CRF if provided
  let adjustedRatio = ratio;
  if (crf) {
    const quality = CRF_QUALITY_MAP[crf.toLowerCase()] ?? CRF_QUALITY_MAP[crf];
    if (quality) {
      // Scale ratio: higher quality (higher CRF number) = larger file = higher ratio
      const qualityMultiplier = quality / 85; // normalize around default CRF 23
      adjustedRatio = Math.max(0.3, Math.min(0.95, ratio * qualityMultiplier));
    }
  }

  const sourceNum = typeof sourceSizeBytes === 'bigint' ? Number(sourceSizeBytes) : sourceSizeBytes;

  return BigInt(Math.round(sourceNum * adjustedRatio));
}

/**
 * Calculate estimated savings percentage
 * @param sourceSizeBytes Original size
 * @param estimatedSizeBytes Estimated output size
 * @returns Percentage saved (positive = smaller)
 */
export function estimateSavingsPercent(
  sourceSizeBytes: bigint | number,
  estimatedSizeBytes: bigint | number
): number {
  const source = typeof sourceSizeBytes === 'bigint' ? Number(sourceSizeBytes) : sourceSizeBytes;
  const estimated =
    typeof estimatedSizeBytes === 'bigint' ? Number(estimatedSizeBytes) : estimatedSizeBytes;

  return Math.round(((source - estimated) / source) * 100);
}

/**
 * Format bytes to human-readable string
 * @param bytes Size in bytes
 * @returns Formatted string (e.g., "2.5 GB")
 */
export function formatSize(bytes: bigint | number): string {
  const num = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let value = num;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  // No decimals for B/KB, 1 decimal for MB+, remove trailing zeros
  const decimals = unitIndex <= 1 ? 0 : 1;
  const formatted =
    decimals > 0 ? value.toFixed(decimals).replace(/\.?0+$/, '') : String(Math.round(value));
  return `${formatted} ${units[unitIndex]}`;
}

/**
 * Estimate encoding time based on file properties
 * @param durationSeconds Video duration in seconds
 * @param resolution Video resolution (e.g., "1920x1080")
 * @param targetCodec Target codec
 * @returns Estimated encoding time in minutes
 */
export function estimateEncodingTime(
  durationSeconds: number,
  resolution: string,
  targetCodec: string
): number {
  // Base time: ~1 minute encode per 1 minute of video at 1080p, CPU encoding
  const baseMinutes = durationSeconds / 60;

  // Resolution multiplier
  const [width, height] = resolution.split('x').map(Number);
  const pixels = (width * height) / (1920 * 1080); // Normalize to 1080p

  // Codec complexity multiplier
  let codecMultiplier = 1.0;
  const codec = targetCodec.toLowerCase();
  if (codec.includes('hevc') || codec.includes('265')) {
    codecMultiplier = 3.0; // HEVC is slower
  } else if (codec.includes('av1')) {
    codecMultiplier = 8.0; // AV1 is significantly slower
  }

  return Math.round(baseMinutes * pixels * codecMultiplier);
}
