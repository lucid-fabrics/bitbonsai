import { Injectable } from '@nestjs/common';

/**
 * Compression ratios for different codecs vs H.264
 * Based on typical real-world results:
 * - HEVC (H.265): 40-60% size reduction (0.4-0.6x)
 * - AV1: 30-50% size reduction (0.3-0.5x)
 * - VP9: 30-45% size reduction (0.3-0.55x)
 */
const COMPRESSION_RATIOS: Record<string, number> = {
  // Target codec -> compression ratio vs H.264
  HEVC: 0.5, // 50% of original size (50% savings)
  AV1: 0.4, // 40% of original size (60% savings)
  VP9: 0.55, // 55% of original size (45% savings)
  H264: 1.0, // No change
};

/**
 * Quality preset CRF impact on file size
 * Lower CRF = higher quality = larger file
 */
const CRF_IMPACT: Record<string, number> = {
  // preset -> multiplier relative to default (CRF 23 for HEVC)
  ultraFast: 1.3, // Lower compression, faster encoding
  superFast: 1.25,
  veryFast: 1.15,
  faster: 1.1,
  fast: 1.05,
  medium: 1.0, // Default
  slow: 0.9,
  slower: 0.8,
  verySlow: 0.7,
};

/**
 * Hardware acceleration speedup impact on compression efficiency
 * Hardware encoders typically produce slightly larger files for same quality
 */
const HW_ACCEL_IMPACT: Record<string, number> = {
  NVIDIA: 1.1, // NVENC produces ~10% larger files
  INTEL_QSV: 1.05, // QSV produces ~5% larger files
  AMD: 1.1, // VAAPI produces ~10% larger files
  APPLE_M: 1.0, // VideoToolbox is efficient
  CPU: 1.0, // Baseline
};

/**
 * Estimated output size calculation result
 */
export interface EstimatedSize {
  estimatedSizeBytes: string;
  estimatedSizeFormatted: string;
  savingsPercent: number;
  confidence: 'high' | 'medium' | 'low';
  factors: string[];
}

/**
 * FileSizeEstimationService
 *
 * Estimates output file size before encoding based on:
 * - Source file bitrate (if available)
 * - Target codec and quality preset
 * - Duration
 * - Hardware acceleration type
 *
 * Uses a combination of:
 * 1. Source bitrate analysis (most accurate)
 * 2. Duration-based estimation (fallback)
 * 3. Codec-specific compression ratios
 */
@Injectable()
export class FileSizeEstimationService {
  /**
   * Estimate output file size for an encoding job
   *
   * @param sourceSizeBytes - Original file size in bytes
   * @param sourceBitrateKbps - Source video bitrate in kbps (optional, for higher accuracy)
   * @param durationSeconds - Video duration in seconds
   * @param targetCodec - Target codec (HEVC, AV1, VP9, H264)
   * @param qualityPreset - Encoding speed preset (ultraFast to verySlow)
   * @param hwAccelType - Hardware acceleration type (NVIDIA, INTEL_QSV, AMD, APPLE_M, CPU)
   * @returns Estimated output size with confidence level
   */
  estimateOutputSize(
    sourceSizeBytes: number | string,
    sourceBitrateKbps: number | null,
    durationSeconds: number,
    targetCodec: string,
    qualityPreset = 'medium',
    hwAccelType = 'CPU'
  ): EstimatedSize {
    const sourceBytes =
      typeof sourceSizeBytes === 'string' ? parseInt(sourceSizeBytes, 10) : sourceSizeBytes;

    if (Number.isNaN(sourceBytes) || sourceBytes <= 0) {
      return this.createLowConfidenceEstimate(0, targetCodec, 'Invalid source size');
    }

    const factors: string[] = [];
    let estimatedBytes: number;

    // Method 1: Source bitrate-based estimation (most accurate)
    if (sourceBitrateKbps && sourceBitrateKbps > 0 && durationSeconds > 0) {
      // Calculate expected output bitrate based on codec
      const codecRatio = COMPRESSION_RATIOS[targetCodec] || 0.5;
      const presetMultiplier = CRF_IMPACT[qualityPreset] || 1.0;
      const hwMultiplier = HW_ACCEL_IMPACT[hwAccelType] || 1.0;

      const outputBitrateKbps = sourceBitrateKbps * codecRatio * presetMultiplier * hwMultiplier;
      estimatedBytes = (outputBitrateKbps * durationSeconds * 1000) / 8; // kbps to bytes

      factors.push(`Source bitrate: ${sourceBitrateKbps} kbps`);
      factors.push(`Target bitrate: ~${outputBitrateKbps.toFixed(0)} kbps`);
      factors.push(`Codec ratio: ${(codecRatio * 100).toFixed(0)}%`);
    } else {
      // Method 2: File size-based estimation
      const codecRatio = COMPRESSION_RATIOS[targetCodec] || 0.5;
      const presetMultiplier = CRF_IMPACT[qualityPreset] || 1.0;
      const hwMultiplier = HW_ACCEL_IMPACT[hwAccelType] || 1.0;

      estimatedBytes = sourceBytes * codecRatio * presetMultiplier * hwMultiplier;

      factors.push(`Based on file size: ${this.formatBytes(sourceBytes)}`);
    }

    factors.push(`Quality preset: ${qualityPreset}`);
    if (hwAccelType !== 'CPU') {
      factors.push(`Hardware: ${hwAccelType}`);
    }

    // Determine confidence based on available data
    const confidence: 'high' | 'medium' | 'low' = sourceBitrateKbps ? 'high' : 'medium';

    const savingsPercent = Math.round(((sourceBytes - estimatedBytes) / sourceBytes) * 100);

    return {
      estimatedSizeBytes: estimatedBytes.toString(),
      estimatedSizeFormatted: this.formatBytes(estimatedBytes),
      savingsPercent: Math.max(0, Math.min(95, savingsPercent)),
      confidence,
      factors,
    };
  }

  /**
   * Parse bitrate from ffprobe output
   *
   * @param bitrateString - Bitrate string from ffprobe (e.g., "10.5M" or "10500k")
   * @returns Bitrate in kbps, or null if parsing fails
   */
  parseBitrate(bitrateString: string): number | null {
    if (!bitrateString) return null;

    const trimmed = bitrateString.trim().toUpperCase();

    // Match patterns like "10.5M", "10500k" (explicit suffix)
    const mMatch = trimmed.match(/^([\d.]+)M$/);
    if (mMatch) {
      return parseFloat(mMatch[1]) * 1000; // Convert Mbps to kbps
    }

    const kMatch = trimmed.match(/^([\d.]+)K$/);
    if (kMatch) {
      return parseFloat(kMatch[1]);
    }

    // Plain number (assume bits per second if >= 10000, else kbps)
    const num = parseFloat(trimmed);
    if (!Number.isNaN(num)) {
      // If large (>= 10 Mbps in bits), convert to kbps
      return num >= 10000 ? num / 1000 : num;
    }

    return null;
  }

  /**
   * Get compression ratio for a codec
   *
   * @param codec - Target codec
   * @returns Compression ratio (lower = more compression)
   */
  getCompressionRatio(codec: string): number {
    return COMPRESSION_RATIOS[codec] || 0.5;
  }

  /**
   * Get typical savings percentage for a codec
   *
   * @param codec - Target codec
   * @returns Typical savings percentage
   */
  getTypicalSavings(codec: string): number {
    const ratio = this.getCompressionRatio(codec);
    return Math.round((1 - ratio) * 100);
  }

  /**
   * Create a low confidence estimate with fallback values
   */
  private createLowConfidenceEstimate(
    estimatedBytes: number,
    targetCodec: string,
    reason: string
  ): EstimatedSize {
    const savings = this.getTypicalSavings(targetCodec);

    return {
      estimatedSizeBytes: estimatedBytes.toString(),
      estimatedSizeFormatted: this.formatBytes(estimatedBytes),
      savingsPercent: savings,
      confidence: 'low' as const,
      factors: [`Warning: ${reason}`, `Typical ${targetCodec} savings: ${savings}%`],
    };
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / k ** i).toFixed(2)} ${units[i]}`;
  }
}
