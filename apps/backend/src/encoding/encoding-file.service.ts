import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { Job, Policy } from '@prisma/client';
import { JobRepository } from '../common/repositories/job.repository';
import { SettingsRepository } from '../common/repositories/settings.repository';
import { FileRelocatorService } from '../core/services/file-relocator.service';
import { LibrariesService } from '../libraries/libraries.service';
import { QueueService } from '../queue/queue.service';
import { FileFailureTrackingService } from '../queue/services/file-failure-tracking.service';
import { EncodingFileReplacementService } from './encoding-file-replacement.service';
import { EncodingOutputVerificationService } from './encoding-output-verification.service';
import { FfmpegService } from './ffmpeg.service';
import { type QualityMetrics, QualityMetricsService } from './quality-metrics.service';
import { CodecFallbackService } from './services/codec-fallback.service';
import { ContainerValidationService } from './services/container-validation.service';
import { GpuHealthService } from './services/gpu-health.service';
import { QualityGateService } from './services/quality-gate.service';
import { SegmentedEncodeService } from './services/segmented-encode.service';
import { TempFileGuardService } from './services/temp-file-guard.service';
import { SystemResourceService } from './system-resource.service';

export interface JobWithPolicy extends Job {
  policy?: Policy;
}

export interface JobResult {
  beforeSizeBytes: bigint;
  afterSizeBytes: bigint;
  savedBytes: bigint;
  savedPercent: number;
}

// Constants
const TEMP_FILE_CHECK_DELAY_MS = 2000;
const TEMP_FILE_MAX_RETRIES = 10;
// Trial-encode preflight: skip for files too short for a meaningful sample,
// and cap the sample itself so validation stays fast.
const TRIAL_ENCODE_MIN_SOURCE_SECONDS = 60;
const TRIAL_ENCODE_SAMPLE_SECONDS = 10;

/**
 * EncodingFileService
 *
 * Handles file-level encoding operations: encoding, verification,
 * validation, atomic replacement, and library stats updates.
 * Extracted from EncodingProcessorService to separate concerns.
 */
@Injectable()
export class EncodingFileService {
  private readonly logger = new Logger(EncodingFileService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly settingsRepository: SettingsRepository,
    private readonly ffmpegService: FfmpegService,
    private readonly librariesService: LibrariesService,
    readonly _fileRelocatorService: FileRelocatorService,
    private readonly systemResourceService: SystemResourceService,
    private readonly queueService: QueueService,
    private readonly qualityMetricsService: QualityMetricsService,
    readonly fileReplacement: EncodingFileReplacementService,
    readonly outputVerification: EncodingOutputVerificationService,
    private readonly segmentedEncode: SegmentedEncodeService,
    private readonly containerValidation: ContainerValidationService,
    private readonly qualityGate: QualityGateService,
    private readonly codecFallback: CodecFallbackService,
    private readonly gpuHealth: GpuHealthService,
    private readonly tempFileGuard: TempFileGuardService,
    private readonly fileFailureTracking: FileFailureTrackingService
  ) {}

  /**
   * Check if temp file exists with retry logic for NFS mount recovery
   */
  async checkTempFileWithRetry(tempFilePath: string | null): Promise<boolean> {
    if (!tempFilePath) {
      this.logger.log('  ℹ️  TRUE RESUME: No temp file path provided, skipping check');
      return false;
    }

    this.logger.log(`  🔍 TRUE RESUME: Checking if temp file exists: ${tempFilePath}`);

    for (let attempt = 1; attempt <= TEMP_FILE_MAX_RETRIES; attempt++) {
      try {
        if (fs.existsSync(tempFilePath)) {
          this.logger.log(
            `  ✅ TRUE RESUME: Temp file found on attempt ${attempt}/${TEMP_FILE_MAX_RETRIES}`
          );
          return true;
        }
        this.logger.log(
          `  ⏳ TRUE RESUME: Temp file not found (attempt ${attempt}/${TEMP_FILE_MAX_RETRIES}), retrying...`
        );
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `  ⚠️  TRUE RESUME: Error checking temp file (attempt ${attempt}/${TEMP_FILE_MAX_RETRIES}): ${errorMsg}`
        );
      }

      if (attempt < TEMP_FILE_MAX_RETRIES) {
        await this.sleep(TEMP_FILE_CHECK_DELAY_MS);
      }
    }

    this.logger.warn(
      `  ❌ TRUE RESUME: Temp file not found after ${TEMP_FILE_MAX_RETRIES} attempts - will restart from 0%`
    );
    return false;
  }

  /**
   * Encode a file according to its job policy
   */
  async encodeFile(job: JobWithPolicy): Promise<JobResult> {
    const originalFilePath = job.filePath;
    const beforeSizeBytes = BigInt(fs.statSync(job.filePath).size);

    // Create temporary output path
    // CRITICAL: Use stable temp filename (job.id only) so TRUE RESUME works across restarts
    const outputName = path.basename(job.filePath);

    // PERF: Use cache pool (SSD) for temp files if available, otherwise use source directory
    const tempBase = this.systemResourceService.getEncodingTempPath();
    const tmpPath = tempBase
      ? path.join(tempBase, `.${outputName}.tmp-${job.id}`)
      : path.join(path.dirname(job.filePath), `.${outputName}.tmp-${job.id}`);

    let usedSegmentedEncode = false;

    try {
      const policy = job.policy;
      if (!policy) {
        throw new Error('Job policy not loaded');
      }

      // PER-FILE SUCCESS MEMORY: if this exact file has previously succeeded
      // on a different codec than the one currently selected (typically a
      // GPU->CPU fallback learned on a prior job for this file), route
      // straight to it instead of relearning it via a failed GPU attempt.
      // REMUX jobs stream-copy - no codec selection to override.
      if (job.type !== 'REMUX' && !job.codecOverride) {
        const knownGoodCodec = await this.fileFailureTracking.getLastSuccessfulCodec(
          originalFilePath,
          job.libraryId,
          job.contentFingerprint ?? undefined
        );
        if (knownGoodCodec && knownGoodCodec !== job.targetCodec) {
          this.logger.log(
            `[${job.id}] Per-file memory: routing straight to ${knownGoodCodec} (last known-good codec for this file)`
          );
          job.codecOverride = knownGoodCodec;
          await this.queueService.update(job.id, { codecOverride: knownGoodCodec });
        }
      }

      // REMUX-REPAIR: health-check found the original unreadable and repaired
      // it (see health-check.worker.ts attemptRemuxRepair). Read from the
      // repaired copy for the actual encode; the original stays untouched
      // until the replace-on-success step below swaps job.filePath back.
      const usingRepairedSource = Boolean(
        job.repairedSourcePath && fs.existsSync(job.repairedSourcePath)
      );
      if (usingRepairedSource) {
        this.logger.log(`[${job.id}] Encoding from remux-repaired source: ${job.repairedSourcePath}`);
        job.filePath = job.repairedSourcePath as string;
      }

      // Persist temp path so orphan cleanup and the temp-file guard can find it.
      // MULTI-NODE: Use QueueService proxy to support LINKED nodes
      await this.queueService.update(job.id, { tempFilePath: tmpPath });

      // A leftover temp from a previous interrupted run is always stale:
      // input-seek resume produced truncated outputs, so recovery restarts
      // clean. Segmented jobs keep their real resume state in JobSegment
      // rows, not in this file.
      if (fs.existsSync(tmpPath)) {
        this.logger.log(`Deleting stale temp file from previous run: ${tmpPath}`);
        fs.unlinkSync(tmpPath);
      }

      // CRITICAL: Get original duration BEFORE encoding for validation
      const originalDuration = await this.ffmpegService.getVideoDuration(job.filePath);
      this.logger.log(`Original file duration: ${originalDuration.toFixed(2)}s`);

      // TRIAL-ENCODE PREFLIGHT: validate the built ffmpeg command on a short
      // sample before committing to a potentially multi-hour full encode.
      // REMUX jobs stream-copy (no codec selection to validate) and skip it.
      if (
        job.type !== 'REMUX' &&
        originalDuration >= TRIAL_ENCODE_MIN_SOURCE_SECONDS &&
        !job.trialEncodeValidatedAt
      ) {
        await this.runTrialEncode(job, policy, originalDuration);
      }

      // SEGMENTED ENCODE: long files are encoded in verified 5-minute
      // segments and concatenated, so an interruption loses at most one
      // segment of work instead of the whole encode.
      const settings = await this.settingsRepository.findFirst();
      usedSegmentedEncode = this.segmentedEncode.shouldUseSegmentedEncode(
        originalDuration,
        settings?.segmentedEncodeEnabled ?? false,
        settings?.segmentedEncodeThresholdMinutes ?? 30
      );

      if (usedSegmentedEncode) {
        await this.performSegmentedEncoding(job, policy, tmpPath, originalDuration);
      } else {
        await this.performEncoding(job, tmpPath, policy);
      }

      // Verify output if enabled
      if (policy.verifyOutput) {
        await this.outputVerification.verifyEncodedFile(tmpPath);
      }

      // CRITICAL FIX: Validate output duration matches original to prevent truncated files
      // This prevents catastrophic data loss from incomplete/interrupted encodings
      // originalFilePath (not job.filePath): a duration-mismatch error must name
      // the real library file, not an ephemeral remux-repaired copy.
      await this.outputVerification.validateOutputDuration(
        tmpPath,
        originalDuration,
        originalFilePath
      );

      // Container-level integrity check (moov/EBML structure, stream presence)
      // catches structurally broken outputs the duration probe can miss.
      const containerCheck = await this.containerValidation.validateContainer(
        tmpPath,
        originalDuration
      );
      if (!containerCheck.valid) {
        throw new Error(`Output container invalid: ${containerCheck.reason}`);
      }

      // Calculate file size changes
      const afterSizeBytes = BigInt(fs.statSync(tmpPath).size);
      const { savedBytes, savedPercent } = this.calculateSavings(beforeSizeBytes, afterSizeBytes);

      // CRITICAL FIX: Size sanity check - encoded file shouldn't be suspiciously small
      // This catches edge cases where duration might pass but file is clearly incomplete
      this.validateOutputSize(beforeSizeBytes, afterSizeBytes, originalDuration, originalFilePath);

      // AUDIT FIX: Capture file stats for integrity check before replacement
      // This detects if file was modified between validation and replacement (race condition)
      const preReplaceStats = fs.statSync(tmpPath);
      const preReplaceMtime = preReplaceStats.mtimeMs;
      const preReplaceSize = preReplaceStats.size;

      // HIGH PRIORITY FIX: Verify disk space before atomic replacement
      // During atomic replacement, we temporarily have BOTH original + encoded file
      // So we need space for both files simultaneously
      await this.fileReplacement.verifyDiskSpaceForReplacement(
        job.filePath,
        tmpPath,
        beforeSizeBytes,
        afterSizeBytes
      );

      // AUDIT FIX: Verify file wasn't modified during disk space check (race condition protection)
      const postCheckStats = fs.statSync(tmpPath);
      if (postCheckStats.mtimeMs !== preReplaceMtime || postCheckStats.size !== preReplaceSize) {
        throw new Error(
          `CRITICAL: Temp file was modified between validation and replacement!\n` +
            `Before: mtime=${preReplaceMtime}, size=${preReplaceSize}\n` +
            `After: mtime=${postCheckStats.mtimeMs}, size=${postCheckStats.size}\n` +
            `This could indicate file corruption or a race condition.\n` +
            `The original file will NOT be replaced to prevent data loss.`
        );
      }

      // Calculate quality metrics if enabled (before replacement, while both files exist)
      const qualityMetrics = await this.calculateQualityMetricsIfEnabled(
        job,
        job.filePath,
        tmpPath
      );

      // VMAF quality gate: reject encodes below the configured threshold.
      // Throwing here routes through the retry strategy; the gate force-passes
      // after its retry cap, so this cannot loop forever.
      const gateResult = await this.qualityGate.checkQuality(job, tmpPath, qualityMetrics);
      if (!gateResult.passed) {
        throw new Error(
          `Quality gate failed: VMAF ${gateResult.score} below threshold ${gateResult.threshold}`
        );
      }

      // REMUX-REPAIR: replacement must target the real library path, not the
      // repaired temp copy - restore before the swap-in happens.
      const repairedSourceToClean = job.repairedSourcePath;
      job.filePath = originalFilePath;

      // Replace original file with encoded version (with Keep Original support)
      await this.fileReplacement.replaceFile(job, tmpPath, policy.atomicReplace);

      // Segments served their purpose once the concat output replaced the
      // original; reclaim the disk space.
      if (usedSegmentedEncode) {
        await this.segmentedEncode.cleanupSegments(job.id, `${tmpPath}.segments`);
      }

      // The repaired copy did its job once the real file has been replaced
      // with a successful encode - clean it up like any other temp file.
      if (repairedSourceToClean) {
        if (fs.existsSync(repairedSourceToClean)) {
          try {
            fs.unlinkSync(repairedSourceToClean);
          } catch (cleanupError: unknown) {
            this.logger.warn(`Failed to clean repaired-source copy:`, cleanupError);
          }
        }
        await this.tempFileGuard.markCleaned(repairedSourceToClean);
        await this.queueService.update(job.id, { repairedSourcePath: null });
        job.repairedSourcePath = null;
      }

      return {
        beforeSizeBytes,
        afterSizeBytes,
        savedBytes,
        savedPercent,
      };
    } finally {
      // Always restore the in-memory job identity - a thrown error above the
      // restore line must not leak the repaired-copy path to retry/logging
      // code that expects job.filePath to mean the real library file.
      job.filePath = originalFilePath;

      // Single-pass temps have no resume value (input-seek resume produced
      // truncated outputs and was removed), and a successful replaceFile has
      // already renamed the temp away. Anything still here is garbage.
      // Segmented resume state lives in the segments dir, which is kept on
      // failure so the next attempt skips verified segments.
      if (tmpPath && fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
          this.logger.debug(`Cleaned up temp file: ${tmpPath}`);
        } catch (cleanupError: unknown) {
          this.logger.warn(`Failed to clean temp file ${tmpPath}:`, cleanupError);
        }
      }
    }
  }

  /**
   * Perform FFmpeg encoding on a file
   *
   * Passes the REAL job and policy through to the encoder. The previous
   * options-object path rebuilt a synthetic Job that silently dropped
   * codecOverride, healthMessage, type (REMUX), targetContainer, decision
   * config, and thread throttling.
   */
  async performEncoding(
    job: JobWithPolicy,
    tmpPath: string,
    policy: JobWithPolicy['policy']
  ): Promise<void> {
    if (!policy) {
      throw new Error('Policy is required for encoding');
    }

    await this.ffmpegService.encodeFile(job, policy, tmpPath);
  }

  /**
   * Trial-encode preflight: run the same ffmpeg command the full encode will
   * use on a short sample from the middle of the source. Catches a missing
   * encoder, a broken hardware path, or a bad filter chain in seconds instead
   * of after a multi-hour full-length attempt.
   *
   * On a GPU-class failure, applies the existing codec fallback and retries
   * the sample once on the CPU codec so the full encode starts on a path
   * already proven to work. Any other failure (or a failed fallback retry)
   * throws immediately, which routes through the normal retry strategy
   * instead of wasting the full encode duration on a doomed command.
   */
  private async runTrialEncode(
    job: JobWithPolicy,
    policy: Policy,
    originalDuration: number
  ): Promise<void> {
    // Match the real target container so the sample exercises the same
    // container-specific audio-transcode/subtitle-mapping logic the full
    // encode will use (MP4's incompatible-audio-to-AAC and text-subs-only
    // rules are otherwise silently skipped by a trial that always used MKV).
    const targetContainer = job.targetContainer || 'mkv';
    const trialPath = `${job.filePath}.trial-${job.id}.${targetContainer}`;
    const sampleSeconds = Math.min(TRIAL_ENCODE_SAMPLE_SECONDS, Math.floor(originalDuration / 2));
    const startSeconds = Math.max(0, Math.floor(originalDuration / 2) - sampleSeconds / 2);

    this.logger.log(
      `[${job.id}] Trial-encode preflight: sampling ${sampleSeconds}s at ${startSeconds.toFixed(0)}s`
    );

    // Track the trial temp file the same way the real encode's temp is
    // tracked, so a crash mid-trial doesn't leave it orphaned next to the
    // source file forever - TempFileGuardService's startup sweep deletes it.
    await this.tempFileGuard.registerTempFile(job.id, trialPath, job.nodeId);

    try {
      try {
        await this.ffmpegService.encodeSegment(
          job,
          policy,
          trialPath,
          startSeconds,
          sampleSeconds,
          undefined,
          targetContainer
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[${job.id}] Trial encode failed: ${message}`);

        if (!this.codecFallback.shouldFallback(job, message)) {
          throw error;
        }

        this.logger.warn(`[${job.id}] GPU-class trial failure - falling back to CPU and retrying`);
        this.gpuHealth.recordGpuFailure(message);
        await this.codecFallback.applyFallback(job.id, job.targetCodec);
        const updated = await this.jobRepository.findById(job.id);
        job.codecOverride = updated?.codecOverride ?? job.codecOverride;

        // One retry on the fallback codec. If this also fails, surface the
        // error as-is - the full encode would fail the same way.
        await this.ffmpegService.encodeSegment(
          job,
          policy,
          trialPath,
          startSeconds,
          sampleSeconds,
          undefined,
          targetContainer
        );
      }
    } finally {
      if (fs.existsSync(trialPath)) {
        try {
          fs.unlinkSync(trialPath);
        } catch (cleanupError: unknown) {
          this.logger.warn(`[${job.id}] Failed to clean trial-encode temp file:`, cleanupError);
        }
      }
      await this.tempFileGuard.markCleaned(trialPath);
    }

    job.trialEncodeValidatedAt = new Date();
    await this.queueService.update(job.id, { trialEncodeValidatedAt: job.trialEncodeValidatedAt });
    this.logger.log(`[${job.id}] Trial-encode preflight passed`);
  }

  /**
   * Segmented encoding orchestration: plan (or reload) segments, resume from
   * the last verified one, encode + verify each, then concat into tmpPath.
   */
  private async performSegmentedEncoding(
    job: JobWithPolicy,
    policy: Policy,
    tmpPath: string,
    originalDuration: number
  ): Promise<void> {
    const segmentsDir = `${tmpPath}.segments`;
    await fs.promises.mkdir(segmentsDir, { recursive: true });

    // Existing JobSegment rows mean a previous attempt was interrupted:
    // reuse the plan so verified segments are skipped (true resume).
    let segments = await this.segmentedEncode.getSegments(job.id);
    let concatListPath = job.concatListPath;

    if (segments.length === 0) {
      const segmentDurationSecs = job.segmentDurationSecs || 300;
      const plan = this.segmentedEncode.planSegments(
        job.id,
        originalDuration,
        segmentsDir,
        segmentDurationSecs
      );
      await this.segmentedEncode.persistSegmentPlan(job.id, plan);
      await this.queueService.update(job.id, {
        segmentedEncode: true,
        segmentCount: plan.totalSegments,
        segmentsDir,
        concatListPath: plan.concatListPath,
      });
      segments = plan.segments;
      concatListPath = plan.concatListPath;
      this.logger.log(
        `Segmented encode: ${plan.totalSegments} segments of ${segmentDurationSecs}s for ${job.fileLabel}`
      );
    } else {
      this.logger.log(
        `Segmented encode: resuming with ${segments.length} existing segments for ${job.fileLabel}`
      );
    }

    const { lastVerifiedIndex, partialSegmentIndex } = await this.segmentedEncode.findResumePoint(
      job.id
    );
    if (partialSegmentIndex !== null) {
      const partial = segments.find((s) => s.index === partialSegmentIndex);
      if (partial) {
        await this.segmentedEncode.resetPartialSegment(
          job.id,
          partialSegmentIndex,
          partial.tempPath
        );
      }
    }
    if (lastVerifiedIndex >= 0) {
      this.logger.log(
        `Segmented encode: segments 0-${lastVerifiedIndex} already verified, resuming at ${lastVerifiedIndex + 1}`
      );
    }

    const totalSegments = segments.length;
    let lastReportedProgress = -1;

    for (const segment of segments) {
      if (segment.index <= lastVerifiedIndex) continue;

      await this.queueService.update(job.id, { currentSegmentIndex: segment.index });

      await this.ffmpegService.encodeSegment(
        job,
        policy,
        segment.tempPath,
        segment.startSeconds,
        segment.durationSeconds,
        (segmentPercent) => {
          const overall = ((segment.index + segmentPercent / 100) / totalSegments) * 100;
          const rounded = Math.floor(overall);
          if (rounded > lastReportedProgress) {
            lastReportedProgress = rounded;
            this.queueService
              .update(job.id, { progress: overall })
              .catch((err: unknown) => this.logger.warn(`Segment progress update failed: ${err}`));
          }
        }
      );

      await this.segmentedEncode.markSegmentCompleted(job.id, segment.index);
      const actualDuration = await this.segmentedEncode.verifySegment(
        segment.tempPath,
        segment.durationSeconds
      );
      await this.segmentedEncode.markSegmentVerified(
        job.id,
        segment.index,
        actualDuration,
        segment.tempPath
      );
    }

    await this.segmentedEncode.concatSegments(
      concatListPath || path.join(segmentsDir, 'concat.txt'),
      segments.map((s) => s.tempPath),
      tmpPath,
      job.filePath
    );
  }

  /**
   * Sleep helper for retries and delays
   */
  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculate space savings from encoding
   */
  calculateSavings(
    beforeSizeBytes: bigint,
    afterSizeBytes: bigint
  ): { savedBytes: bigint; savedPercent: number } {
    const savedBytes = beforeSizeBytes - afterSizeBytes;
    const savedPercent = Number((savedBytes * BigInt(10000)) / beforeSizeBytes) / 100;
    return { savedBytes, savedPercent };
  }

  /**
   * AUDIT FIX: Get adaptive duration tolerance based on file length
   */
  getAdaptiveDurationTolerance(durationSeconds: number): number {
    return this.outputVerification.getAdaptiveDurationTolerance(durationSeconds);
  }

  // ── Delegations to extracted services (kept for backward-compat with callers/tests) ──

  async verifyEncodedFile(tmpPath: string): Promise<void> {
    return this.outputVerification.verifyEncodedFile(tmpPath);
  }

  async validateOutputDuration(
    outputPath: string,
    originalDuration: number,
    originalPath: string
  ): Promise<void> {
    return this.outputVerification.validateOutputDuration(
      outputPath,
      originalDuration,
      originalPath
    );
  }

  async verifyDiskSpaceForReplacement(
    originalPath: string,
    tmpPath: string,
    originalSize: bigint,
    tmpSize: bigint
  ): Promise<void> {
    return this.fileReplacement.verifyDiskSpaceForReplacement(
      originalPath,
      tmpPath,
      originalSize,
      tmpSize
    );
  }

  crossFsSafeRenameSync(sourcePath: string, destPath: string): void {
    this.fileReplacement.crossFsSafeRenameSync(sourcePath, destPath);
  }

  async atomicReplaceFileWithVerification(originalPath: string, tmpPath: string): Promise<void> {
    return this.fileReplacement.atomicReplaceFileWithVerification(originalPath, tmpPath);
  }

  async replaceFile(job: JobWithPolicy, tmpPath: string, atomicReplace: boolean): Promise<void> {
    return this.fileReplacement.replaceFile(job, tmpPath, atomicReplace);
  }

  /**
   * CRITICAL FIX: Validate output file size is not suspiciously small
   *
   * @param beforeSizeBytes - Original file size
   * @param afterSizeBytes - Encoded file size
   * @param durationSeconds - Video duration in seconds
   * @param filePath - Path to file (for error messages)
   * @throws Error if file size is suspiciously small
   */
  validateOutputSize(
    beforeSizeBytes: bigint,
    afterSizeBytes: bigint,
    durationSeconds: number,
    filePath: string
  ): void {
    // AUDIT FIX: Use bigint throughout to prevent precision loss on huge files (>9PB)
    // Calculate minimum reasonable size based on duration
    // Minimum bitrate: 200kbps (absolute floor for any watchable video)
    // Formula: size_bytes = bitrate_bps * duration_seconds / 8
    const minBitrateKbps = 200n;
    const durationBigInt = BigInt(Math.floor(durationSeconds));
    const minReasonableBytes = (minBitrateKbps * 1000n * durationBigInt) / 8n;

    if (afterSizeBytes < minReasonableBytes) {
      // Convert to Number only for display formatting (safe for display purposes)
      const afterSizeMB = Number(afterSizeBytes / 1024n / 1024n);
      const minSizeMB = Number(minReasonableBytes / 1024n / 1024n);
      const beforeSizeMB = Number(beforeSizeBytes / 1024n / 1024n);

      const errorMsg =
        `CRITICAL: Output file size is suspiciously small!\n\n` +
        `Original size: ${beforeSizeMB.toFixed(2)} MB\n` +
        `Output size: ${afterSizeMB.toFixed(2)} MB\n` +
        `Minimum expected: ${minSizeMB.toFixed(2)} MB (for ${durationSeconds.toFixed(0)}s @ ${minBitrateKbps}kbps)\n\n` +
        `The output file is smaller than any reasonable encoding could produce.\n` +
        `This usually indicates a corrupted or incomplete file.\n` +
        `The original file will NOT be replaced to prevent data loss.\n\n` +
        `File: ${filePath}`;

      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Also check for extreme compression (>95% reduction is suspicious for video)
    // Normal HEVC encoding typically saves 30-70%, not 95%+
    // AUDIT FIX: Use bigint for all comparisons to prevent precision loss
    const savedBytes = beforeSizeBytes - afterSizeBytes;
    const reductionPercent =
      beforeSizeBytes > 0n ? Number((savedBytes * 100n) / beforeSizeBytes) : 0;
    const hundredMB = 100n * 1024n * 1024n;
    const oneGB = 1024n * 1024n * 1024n;

    // AUDIT FIX: Block extreme compression (was just warning before)
    // 95%+ reduction with output <100MB and original >1GB is almost always corruption
    if (reductionPercent > 95 && afterSizeBytes < hundredMB && beforeSizeBytes > oneGB) {
      const afterSizeMB = Number(afterSizeBytes / 1024n / 1024n);
      const beforeSizeMB = Number(beforeSizeBytes / 1024n / 1024n);

      const errorMsg =
        `CRITICAL: Extreme compression detected - likely corruption!\n\n` +
        `Original size: ${beforeSizeMB.toFixed(2)} MB\n` +
        `Output size: ${afterSizeMB.toFixed(2)} MB\n` +
        `Reduction: ${reductionPercent.toFixed(1)}%\n\n` +
        `A ${reductionPercent.toFixed(0)}% reduction from ${beforeSizeMB.toFixed(0)}MB to ${afterSizeMB.toFixed(0)}MB ` +
        `is not possible with legitimate encoding.\n` +
        `This usually indicates the output file is corrupted or incomplete.\n` +
        `The original file will NOT be replaced to prevent data loss.\n\n` +
        `File: ${filePath}`;

      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Warn (but allow) for edge cases: small files or moderate compression
    if (reductionPercent > 90 && afterSizeBytes < hundredMB) {
      const afterSizeMB = Number(afterSizeBytes / 1024n / 1024n);
      const beforeSizeMB = Number(beforeSizeBytes / 1024n / 1024n);

      this.logger.warn(
        `⚠️  High compression detected: ${beforeSizeMB.toFixed(2)}MB → ${afterSizeMB.toFixed(2)}MB ` +
          `(${reductionPercent.toFixed(1)}% reduction). File: ${filePath}`
      );
    }
  }

  private async calculateQualityMetricsIfEnabled(
    job: JobWithPolicy,
    originalPath: string,
    encodedPath: string
  ): Promise<QualityMetrics | null> {
    try {
      const settings = await this.settingsRepository.findFirst();
      if (!settings?.qualityMetricsEnabled) return null;

      this.logger.log(`Calculating quality metrics for job ${job.id}...`);
      const metrics = await this.qualityMetricsService.calculateAllQualityMetrics(
        originalPath,
        encodedPath
      );

      await this.jobRepository.updateById(job.id, {
        qualityMetrics: {
          vmaf: metrics.vmaf,
          psnr: metrics.psnr,
          ssim: metrics.ssim,
        },
        qualityMetricsAt: metrics.calculatedAt,
      });

      return metrics;
    } catch (error: unknown) {
      this.logger.warn(
        `Quality metrics calculation failed for job ${job.id}, continuing: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  async updateLibraryStats(libraryId: string, savedBytes: bigint): Promise<void> {
    try {
      const library = await this.librariesService.findOne(libraryId);

      // Calculate new total size
      const newTotalSize = library.totalSizeBytes - savedBytes;

      await this.librariesService.update(libraryId, {
        totalSizeBytes: newTotalSize,
      });
    } catch (error: unknown) {
      this.logger.error(`Failed to update library stats for ${libraryId}:`, error);
      // Don't throw - library stats update failure shouldn't fail job
    }
  }
}
