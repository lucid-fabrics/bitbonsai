import { Injectable } from '@nestjs/common';
import { FileHealthStatus } from '@prisma/client';
import { FfmpegService } from '../../encoding/ffmpeg.service';
import {
  HealthCheckIssue,
  HealthCheckIssueCategory,
  HealthCheckIssueSeverity,
  HealthCheckSuggestedAction,
} from '../models/health-check-issue.model';

@Injectable()
export class HealthCheckCodecAnalyzerService {
  constructor(private readonly ffmpegService: FfmpegService) {}

  checkCodecMatch(sourceCodec: string, targetCodec: string): HealthCheckIssue | null {
    const normalizedSource = this.ffmpegService.normalizeCodec(sourceCodec);
    const normalizedTarget = this.ffmpegService.normalizeCodec(targetCodec);

    if (normalizedSource === normalizedTarget) {
      const codecDisplayName = this.getCodecDisplayName(normalizedSource);

      const suggestedActions: HealthCheckSuggestedAction[] = [
        {
          id: 'skip_encoding',
          label: 'Skip Encoding',
          description: `Mark this job as completed without encoding - the file is already in ${codecDisplayName} format`,
          impact: 'Job will be marked as COMPLETED with no changes to the file',
          recommended: true,
          config: {
            action: 'skip',
            reason: 'codec_already_matches',
          },
        },
        {
          id: 'force_reencode',
          label: 'Force Re-encode Anyway',
          description: `Re-encode the file from ${codecDisplayName} to ${codecDisplayName} (same codec)`,
          impact:
            'File will be re-encoded, potentially resulting in quality loss with no size benefit',
          recommended: false,
          config: {
            action: 'force_encode',
            reason: 'user_requested',
          },
        },
        {
          id: 'cancel_job',
          label: 'Cancel Job',
          description: 'Remove this job from the queue entirely',
          impact: 'Job will be cancelled and the file left unchanged',
          recommended: false,
          config: {
            action: 'cancel',
            reason: 'codec_already_matches',
          },
        },
      ];

      return {
        category: HealthCheckIssueCategory.CODEC,
        severity: HealthCheckIssueSeverity.BLOCKER,
        code: 'CODEC_ALREADY_MATCHES_TARGET',
        message: `This file is already encoded in ${codecDisplayName} format`,
        technicalDetails: `
Source codec: ${sourceCodec} (normalized: ${normalizedSource})
Target codec: ${targetCodec} (normalized: ${normalizedTarget})

The file's current codec matches the target codec for this job. This typically happens when:
• The encoding policy was changed after the job was created
• The file was already optimized and re-added to the queue
• The policy's target codec was set incorrectly

Re-encoding a file to the same codec offers no benefit and may actually increase file size or reduce quality.
`.trim(),
        suggestedActions,
        metadata: {
          sourceCodec: normalizedSource,
          targetCodec: normalizedTarget,
          codecMatch: true,
        },
      };
    }

    return null;
  }

  /**
   * Get user-friendly display name for a codec
   */
  getCodecDisplayName(codec: string): string {
    const displayNames: Record<string, string> = {
      hevc: 'HEVC (H.265)',
      h264: 'H.264 (AVC)',
      av1: 'AV1',
      vp9: 'VP9',
    };
    return displayNames[codec.toLowerCase()] || codec.toUpperCase();
  }

  /**
   * Calculate expected savings percentage based on codec compression ratios
   *
   * Uses typical compression ratios between codecs:
   * - H.264 → HEVC: ~30-50% savings
   * - H.264 → AV1: ~40-60% savings
   * - HEVC → AV1: ~20-30% savings
   * - Same codec: ~0-5% savings (minimal)
   */
  calculateExpectedSavingsPercent(
    sourceCodec: string,
    targetCodec: string,
    _beforeSizeBytes: bigint
  ): number {
    const normalizedSource = this.ffmpegService.normalizeCodec(sourceCodec);
    const normalizedTarget = this.ffmpegService.normalizeCodec(targetCodec);

    // Same codec typically yields minimal savings
    if (normalizedSource === normalizedTarget) {
      return 5; // Conservative estimate for same-codec re-encoding
    }

    // Compression ratio estimates (conservative)
    const compressionRatios: Record<string, Record<string, number>> = {
      h264: {
        hevc: 35, // H.264 → HEVC: ~35% savings
        av1: 50, // H.264 → AV1: ~50% savings
        vp9: 30, // H.264 → VP9: ~30% savings
      },
      hevc: {
        av1: 25, // HEVC → AV1: ~25% savings
        vp9: 10, // HEVC → VP9: ~10% savings
        h264: -30, // HEVC → H.264: negative savings (quality loss)
      },
      av1: {
        hevc: -10, // AV1 → HEVC: negative savings
        vp9: 0, // AV1 → VP9: similar
        h264: -50, // AV1 → H.264: significant increase
      },
      vp9: {
        hevc: 10, // VP9 → HEVC: ~10% savings
        av1: 20, // VP9 → AV1: ~20% savings
        h264: -20, // VP9 → H.264: negative savings
      },
    };

    return compressionRatios[normalizedSource]?.[normalizedTarget] ?? 0;
  }

  /**
   * Check codec match with savings threshold - creates a BLOCKER issue
   * when expected savings is below the policy's minimum threshold
   */
  checkCodecMatchWithThreshold(
    sourceCodec: string,
    targetCodec: string,
    expectedSavings: number,
    minSavingsThreshold: number
  ): HealthCheckIssue | null {
    const normalizedSource = this.ffmpegService.normalizeCodec(sourceCodec);
    const normalizedTarget = this.ffmpegService.normalizeCodec(targetCodec);
    const codecDisplayName = this.getCodecDisplayName(normalizedTarget);

    const suggestedActions: HealthCheckSuggestedAction[] = [
      {
        id: 'skip_encoding',
        label: 'Skip Encoding',
        description: `Skip this job - expected savings (${expectedSavings}%) is below the ${minSavingsThreshold}% threshold`,
        impact: 'Job will be marked as COMPLETED with no changes to the file',
        recommended: true,
        config: {
          action: 'skip',
          reason: 'savings_below_threshold',
        },
      },
      {
        id: 'force_reencode',
        label: 'Force Re-encode Anyway',
        description: `Re-encode despite low expected savings (${expectedSavings}%)`,
        impact: `File will be re-encoded but savings may be less than ${minSavingsThreshold}%`,
        recommended: false,
        config: {
          action: 'force_encode',
          reason: 'user_requested',
        },
      },
      {
        id: 'cancel_job',
        label: 'Cancel Job',
        description: 'Remove this job from the queue entirely',
        impact: 'Job will be cancelled and the file left unchanged',
        recommended: false,
        config: {
          action: 'cancel',
          reason: 'savings_below_threshold',
        },
      },
    ];

    return {
      category: HealthCheckIssueCategory.CODEC,
      severity: HealthCheckIssueSeverity.BLOCKER,
      code: 'SAVINGS_BELOW_THRESHOLD',
      message: `Expected savings (${expectedSavings}%) is below the policy threshold (${minSavingsThreshold}%)`,
      technicalDetails: `
Source codec: ${sourceCodec} (normalized: ${normalizedSource})
Target codec: ${targetCodec} (normalized: ${normalizedTarget})
Expected savings: ${expectedSavings}%
Policy threshold: ${minSavingsThreshold}%

The expected file size reduction from encoding this file to ${codecDisplayName} is below your policy's minimum savings threshold.

This typically means the encoding would take significant time with minimal space benefit.
`.trim(),
      suggestedActions,
      metadata: {
        sourceCodec: normalizedSource,
        targetCodec: normalizedTarget,
        expectedSavings,
        minSavingsThreshold,
      },
    };
  }

  /**
   * Build a user-friendly health message
   *
   * @param result - Health check result
   * @returns Formatted health message
   */
  buildHealthMessage(result: {
    status: FileHealthStatus;
    score: number;
    issues: string[];
    warnings: string[];
  }): string {
    const parts: string[] = [];

    // Add status emoji
    const emoji = {
      [FileHealthStatus.HEALTHY]: '✅',
      [FileHealthStatus.WARNING]: '⚠️',
      [FileHealthStatus.AT_RISK]: '⚠️',
      [FileHealthStatus.CORRUPTED]: '❌',
      [FileHealthStatus.UNKNOWN]: '❓',
    };

    parts.push(`${emoji[result.status]} Score: ${result.score}/100`);

    // Add issues
    if (result.issues.length > 0) {
      parts.push(`Issues: ${result.issues.join('; ')}`);
    }

    // Add warnings
    if (result.warnings.length > 0) {
      parts.push(`Warnings: ${result.warnings.join('; ')}`);
    }

    return parts.join(' | ');
  }
}
