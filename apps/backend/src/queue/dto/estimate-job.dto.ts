/**
 * Job Estimation DTO
 *
 * Provides pre-encoding estimates for informed decision-making.
 */

export class EstimateJobDto {
  /** Job ID to estimate */
  jobId?: string;

  /** Source file size in bytes */
  sourceSizeBytes!: string | number | bigint;

  /** Source file codec (e.g., "h264", "hevc") */
  sourceCodec?: string;

  /** Target codec (e.g., "hevc", "av1") */
  targetCodec!: string;

  /** Target CRF value (e.g., "23", "hevc-23") */
  targetCrf?: string;

  /** Video duration in seconds */
  durationSeconds?: number;
}

export class JobEstimateResponseDto {
  /** Estimated output file size in bytes */
  estimatedSizeBytes!: string;

  /** Estimated savings in bytes */
  estimatedSavingsBytes!: string;

  /** Percentage saved */
  estimatedSavingsPercent!: number;

  /** Human-readable estimated size */
  estimatedSizeFormatted!: string;

  /** Human-readable savings */
  estimatedSavingsFormatted!: string;

  /** Estimated encoding time in minutes */
  estimatedEncodingMinutes?: number;

  /** Codec used for estimation */
  targetCodec!: string;

  /** Quality preset used */
  targetCrf?: string;
}
