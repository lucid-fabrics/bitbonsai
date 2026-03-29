import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Quality metrics interface for VMAF/PSNR/SSIM results
 */
export interface QualityMetrics {
  vmaf?: number;
  psnr?: number;
  psnrY?: number;
  psnrU?: number;
  psnrV?: number;
  ssim?: number;
  calculatedAt: Date;
}

/**
 * Quality validation result
 */
export interface QualityValidationResult {
  passed: boolean;
  vmaf?: number;
  threshold: number;
  qualityLabel: string;
  reencodeTriggered: boolean;
}

/**
 * Quality Metrics Service
 *
 * Provides video quality assessment using industry-standard metrics:
 * - VMAF (Video Multimethod Assessment Fusion): Netflix-developed perceptual metric
 * - PSNR (Peak Signal-to-Noise Ratio): Traditional signal-based metric
 * - SSIM (Structural Similarity): Human perception-oriented metric
 *
 * These methods can be used to validate encoding quality after transcoding.
 */
@Injectable()
export class QualityMetricsService {
  private readonly logger = new Logger(QualityMetricsService.name);

  /**
   * Check if quality metrics calculation is available (FFmpeg libvmaf support)
   */
  async isAvailable(): Promise<boolean> {
    // Check if we can run FFmpeg with libvmaf
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-encoders'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      ffmpeg.stdout?.on('data', (data) => {
        output += data.toString();
      });

      ffmpeg.on('close', () => {
        resolve(output.includes('libvmaf') || output.includes('libvmaf_vmaf'));
      });

      ffmpeg.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Calculate VMAF (Video Multimethod Assessment Fusion) score between original and encoded video
   * VMAF is the industry-standard perceptual quality metric developed by Netflix
   * Score range: 0-100 (higher is better)
   *   - 80-100: Excellent quality
   *   - 60-80: Good quality
   *   - 40-60: Fair quality
   *   - 0-40: Poor quality
   *
   * @param originalPath - Path to original video file
   * @param encodedPath - Path to encoded video file
   * @returns VMAF score or null if calculation fails
   */
  async calculateVmaf(originalPath: string, encodedPath: string): Promise<number | null> {
    return new Promise((resolve) => {
      // Check if VMAF models exist (FFmpeg looks for them in default paths)
      // Use libvmaf for VMAF calculation
      const ffmpeg = spawn(
        'ffmpeg',
        [
          '-i',
          originalPath,
          '-i',
          encodedPath,
          '-lavfi',
          '[0:v][1:v]libvmaf=model_path=/usr/local/share/model/vmaf_v0.6.1.json:log_path=/dev/stderr',
          '-f',
          'null',
          '-',
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      let stderr = '';

      ffmpeg.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0 && code !== null) {
          // VMAF might not be available, try without model path (uses built-in default)
          this.calculateVmafSimple(originalPath, encodedPath)
            .then(resolve)
            .catch(() => resolve(null));
          return;
        }

        // Extract VMAF score from stderr
        // FFmpeg outputs: libvmaf            NLOGLI INFO ...
        // Or in JSON format via log_path
        const vmafMatch =
          stderr.match(/VMAF score:\s*(\d+\.?\d*)/i) ||
          stderr.match(/nlohmann_json.*?vmaf.*?(\d+\.?\d*)/i);

        if (vmafMatch) {
          const vmafScore = parseFloat(vmafMatch[1]);
          this.logger.log(
            `VMAF score: ${vmafScore.toFixed(2)} (quality: ${this.qualifyVmafScore(vmafScore)})`
          );
          resolve(vmafScore);
        } else {
          // Try alternative parsing for different FFmpeg versions
          const altMatch = stderr.match(/score:\s*(\d+\.?\d*)/);
          if (altMatch) {
            resolve(parseFloat(altMatch[1]));
          } else {
            resolve(null);
          }
        }
      });

      ffmpeg.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * Simplified VMAF calculation without custom model path
   */
  private async calculateVmafSimple(
    originalPath: string,
    encodedPath: string
  ): Promise<number | null> {
    return new Promise((resolve) => {
      const ffmpeg = spawn(
        'ffmpeg',
        [
          '-i',
          originalPath,
          '-i',
          encodedPath,
          '-lavfi',
          '[0:v][1:v]libvmaf=log_path=/dev/null',
          '-f',
          'null',
          '-',
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      let stderr = '';

      ffmpeg.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', () => {
        const match = stderr.match(/VMAF score:\s*(\d+\.?\d*)/i);
        resolve(match ? parseFloat(match[1]) : null);
      });

      ffmpeg.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * Calculate PSNR (Peak Signal-to-Noise Ratio) between original and encoded
   * Higher PSNR = better quality
   *   - >40 dB: Excellent
   *   - 30-40 dB: Good
   *   - 20-30 dB: Fair
   *   - <20 dB: Poor
   *
   * @param originalPath - Path to original video
   * @param encodedPath - Path to encoded video
   * @returns PSNR score or null if calculation fails
   */
  async calculatePsnr(originalPath: string, encodedPath: string): Promise<number | null> {
    return new Promise((resolve) => {
      const ffmpeg = spawn(
        'ffmpeg',
        ['-i', originalPath, '-i', encodedPath, '-lavfi', 'psnr', '-f', 'null', '-'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      let stderr = '';

      ffmpeg.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', () => {
        // Extract average PSNR: "psnr_avg:XX.XX"
        const match = stderr.match(/psnr_avg:(\d+\.?\d*)/);
        if (match) {
          const psnr = parseFloat(match[1]);
          this.logger.log(`PSNR: ${psnr.toFixed(2)} dB`);
          resolve(psnr);
        } else {
          resolve(null);
        }
      });

      ffmpeg.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * Calculate SSIM (Structural Similarity) between original and encoded
   * SSIM is better at capturing human perception than PSNR
   * Score range: 0-1 (higher is better)
   *   - 0.96-1.00: Excellent
   *   - 0.90-0.96: Good
   *   - 0.80-0.90: Fair
   *   - <0.80: Poor
   *
   * @param originalPath - Path to original video
   * @param encodedPath - Path to encoded video
   * @returns SSIM score or null if calculation fails
   */
  async calculateSsim(originalPath: string, encodedPath: string): Promise<number | null> {
    return new Promise((resolve) => {
      const ffmpeg = spawn(
        'ffmpeg',
        ['-i', originalPath, '-i', encodedPath, '-lavfi', 'ssim', '-f', 'null', '-'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      let stderr = '';

      ffmpeg.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', () => {
        // Extract SSIM: "ssim_avg:0.XXXXX"
        const match = stderr.match(/ssim_avg:(\d+\.?\d*)/);
        if (match) {
          const ssim = parseFloat(match[1]);
          this.logger.log(`SSIM: ${ssim.toFixed(4)}`);
          resolve(ssim);
        } else {
          resolve(null);
        }
      });

      ffmpeg.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * Calculate all quality metrics (VMAF, PSNR, SSIM) between original and encoded
   * This is a comprehensive quality assessment
   *
   * @param originalPath - Path to original video
   * @param encodedPath - Path to encoded video
   * @returns Quality metrics object
   */
  async calculateAllQualityMetrics(
    originalPath: string,
    encodedPath: string
  ): Promise<QualityMetrics> {
    this.logger.log(`Calculating quality metrics for ${encodedPath}...`);

    const [vmaf, psnr, ssim] = await Promise.all([
      this.calculateVmaf(originalPath, encodedPath).catch(() => null),
      this.calculatePsnr(originalPath, encodedPath).catch(() => null),
      this.calculateSsim(originalPath, encodedPath).catch(() => null),
    ]);

    const metrics: QualityMetrics = {
      calculatedAt: new Date(),
    };

    if (vmaf !== null) metrics.vmaf = vmaf;
    if (psnr !== null) metrics.psnr = psnr;
    if (ssim !== null) metrics.ssim = ssim;

    this.logger.log(
      `Quality metrics: VMAF=${metrics.vmaf?.toFixed(2) ?? 'N/A'}, ` +
        `PSNR=${metrics.psnr?.toFixed(2) ?? 'N/A'} dB, ` +
        `SSIM=${metrics.ssim?.toFixed(4) ?? 'N/A'}`
    );

    return metrics;
  }

  /**
   * Convert VMAF score to human-readable quality label
   */
  private qualifyVmafScore(score: number): string {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Poor';
  }

  /**
   * Validate quality metrics against threshold
   *
   * @param metrics - Quality metrics to validate
   * @param threshold - VMAF threshold (default: 85)
   * @returns Validation result with re-encode recommendation
   */
  validateQuality(metrics: QualityMetrics, threshold = 85): QualityValidationResult {
    const vmaf = metrics.vmaf;

    if (vmaf === undefined || vmaf === null) {
      // Cannot validate without VMAF score - assume pass but log warning
      this.logger.warn('Cannot validate quality: VMAF score not available');
      return {
        passed: true,
        threshold,
        qualityLabel: 'Unknown',
        reencodeTriggered: false,
      };
    }

    const passed = vmaf >= threshold;
    const qualityLabel = this.qualifyVmafScore(vmaf);

    this.logger.log(
      `Quality validation: VMAF=${vmaf.toFixed(2)}, threshold=${threshold}, ` +
        `label=${qualityLabel}, passed=${passed}`
    );

    return {
      passed,
      vmaf,
      threshold,
      qualityLabel,
      reencodeTriggered: !passed,
    };
  }

  /**
   * Convert quality metrics to JSON string for database storage
   *
   * @param metrics - Quality metrics object
   * @returns JSON string for storage
   */
  toJsonString(metrics: QualityMetrics): string {
    return JSON.stringify({
      vmaf: metrics.vmaf,
      psnr: metrics.psnr,
      ssim: metrics.ssim,
      calculatedAt: metrics.calculatedAt.toISOString(),
    });
  }

  /**
   * Parse quality metrics from JSON string
   *
   * @param json - JSON string from database
   * @returns QualityMetrics object or null if parsing fails
   */
  fromJsonString(json: string | null): QualityMetrics | null {
    if (!json) return null;

    try {
      const parsed = JSON.parse(json);
      return {
        vmaf: parsed.vmaf,
        psnr: parsed.psnr,
        ssim: parsed.ssim,
        calculatedAt: parsed.calculatedAt ? new Date(parsed.calculatedAt) : new Date(),
      };
    } catch {
      this.logger.warn(`Failed to parse quality metrics from JSON: ${json}`);
      return null;
    }
  }
}
