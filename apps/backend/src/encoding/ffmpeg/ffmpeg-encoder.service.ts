import { existsSync, promises as fs } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job, Policy } from '@prisma/client';
import { EncodingProgressUpdateEvent } from '../../common/events';
import { FfmpegFlagBuilderService } from '../ffmpeg-flag-builder.service';
import { FfprobeService } from '../ffprobe.service';
import {
  type HardwareAccelConfig,
  HardwareAccelerationService,
} from '../hardware-acceleration.service';
import { DiskSpaceGuardService } from '../services/disk-space-guard.service';
import { NfsHealthService } from '../services/nfs-health.service';
import { TempFileGuardService } from '../services/temp-file-guard.service';
import { FfmpegHealthMonitor } from './ffmpeg-health-monitor.service';
import { FfmpegProcessManager } from './ffmpeg-process-manager.service';
import { FfmpegProgressTracker } from './ffmpeg-progress-tracker.service';

/**
 * FfmpegEncoderService
 *
 * Owns video encoding logic: encodeFile, encodeSegment, encode,
 * plus encoding-related helpers (flag building, ffprobe delegation,
 * progress delegation, file validation, hw-accel detection).
 */
@Injectable()
export class FfmpegEncoderService {
  private readonly logger = new Logger(FfmpegEncoderService.name);

  constructor(
    private readonly processManager: FfmpegProcessManager,
    private readonly flagBuilder: FfmpegFlagBuilderService,
    private readonly ffprobe: FfprobeService,
    private readonly nfsHealth: NfsHealthService,
    private readonly diskSpaceGuard: DiskSpaceGuardService,
    private readonly tempFileGuard: TempFileGuardService,
    private readonly progressTracker: FfmpegProgressTracker,
    private readonly healthMonitor: FfmpegHealthMonitor,
    private readonly hardwareAcceleration: HardwareAccelerationService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  // ─── Codec / command helpers ───────────────────────────────────────────────

  buildFfmpegCommand(
    job: Job,
    policy: Policy,
    hwaccel: HardwareAccelConfig,
    outputPath: string,
    resumeFromTimestamp?: string
  ): string[] {
    return this.flagBuilder.buildFfmpegCommand(
      job,
      policy,
      hwaccel,
      outputPath,
      resumeFromTimestamp
    );
  }

  // ─── FFprobe helpers ───────────────────────────────────────────────────────

  cleanupFfprobeCodecCache(): void {
    this.ffprobe.cleanupCodecCache();
  }

  clearFfprobeCache(): void {
    this.ffprobe.clearCache();
  }

  async getVideoDuration(filePath: string): Promise<number> {
    return this.ffprobe.getVideoDuration(filePath);
  }

  async getVideoInfo(filePath: string): Promise<{ codec: string; container: string }> {
    return this.ffprobe.getVideoInfo(filePath);
  }

  async getVideoInfoCached(filePath: string): Promise<{ codec: string; container: string }> {
    return this.ffprobe.getVideoInfoCached(filePath);
  }

  // ─── Progress helpers ──────────────────────────────────────────────────────

  parseProgress(
    line: string
  ): Pick<
    { frame: number; fps: number; currentTime: string },
    'frame' | 'fps' | 'currentTime'
  > | null {
    return this.progressTracker.parseProgress(line);
  }

  formatSecondsToTimestamp(totalSeconds: number): string {
    return this.progressTracker.formatSecondsToTimestamp(totalSeconds);
  }

  clearAllProgressTrackers(): void {
    this.progressTracker.clearAllTrackers();
  }

  // ─── Hardware detection ────────────────────────────────────────────────────

  async detectHardwareAcceleration(): Promise<HardwareAccelConfig> {
    return this.hardwareAcceleration.detectHardwareAcceleration();
  }

  selectCodecForPolicy(targetCodec: string, hwType: string): string {
    return this.hardwareAcceleration.selectCodecForPolicy(targetCodec, hwType);
  }

  // ─── File validation / health ─────────────────────────────────────────────

  validateFilePath(filePath: string, libraryPath: string): void {
    this.healthMonitor.validateFilePath(filePath, libraryPath);
  }

  async verifyFile(filePath: string): Promise<{ isValid: boolean; error?: string }> {
    return this.healthMonitor.verifyFile(filePath);
  }

  // ─── Error interpretation ──────────────────────────────────────────────────

  interpretFfmpegExitCode(code: number, stderr: string, progress = 0, retryCount = 0): string {
    const {
      analyzeFfmpegError,
      formatErrorForDisplay,
      // eslint-disable-next-line @typescript-eslint/no-require-imports
    } = require('../utils/ffmpeg-error-analyzer.util');

    const analysis = analyzeFfmpegError(code, stderr, progress, retryCount);
    const formatted = formatErrorForDisplay(analysis);

    if (analysis.errorClass === 'FATAL') return `[FATAL] ${formatted}`;
    if (analysis.errorClass === 'RETRIABLE') return `[RETRIABLE] ${formatted}`;
    return formatted;
  }

  // ─── encodeFile ────────────────────────────────────────────────────────────

  async encodeFile(job: Job, policy: Policy, customOutputPath?: string): Promise<void> {
    this.logger.log(`Starting encoding for job ${job.id}: ${job.fileLabel}`);
    this.logger.debug(`[${job.id}] encodeFile() called - setting up FFmpeg`);

    const jobWithLibrary = job as Job & { library?: { id: string; name: string; path: string } };
    if (jobWithLibrary.library?.path) {
      try {
        this.healthMonitor.validateFilePath(job.filePath, jobWithLibrary.library.path);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[${job.id}] File path validation failed: ${message}`);
        throw new Error(`Security validation failed: ${message}`);
      }
    }

    if (!existsSync(job.filePath)) {
      throw new Error(`File not found: ${job.filePath}`);
    }

    const estimatedDurationSeconds = await this.ffprobe.getVideoDuration(job.filePath);
    this.logger.log(
      `[${job.id}] Using duration: ${estimatedDurationSeconds.toFixed(2)}s for progress calculation`
    );

    const jobWithResume = job as Job & {
      resumeTimestamp?: string | null;
      tempFilePath?: string | null;
    };

    let resumeFromSeconds = 0;
    let resumeFromPercent = 0;

    if (jobWithResume.resumeTimestamp && job.progress > 0) {
      resumeFromSeconds = this.progressTracker.parseTimestampToSeconds(
        jobWithResume.resumeTimestamp
      );
      resumeFromPercent = (resumeFromSeconds / estimatedDurationSeconds) * 100;
      this.logger.log(
        `🔄 TRUE RESUME: Job ${job.id} will resume from ${jobWithResume.resumeTimestamp} (${resumeFromPercent.toFixed(1)}%) - auto-healed from ${job.progress.toFixed(1)}%`
      );
    } else if (jobWithResume.tempFilePath && existsSync(jobWithResume.tempFilePath)) {
      const isValid = await this.healthMonitor.verifyPartialEncode(jobWithResume.tempFilePath);
      if (isValid) {
        this.logger.log(
          `🔄 TRUE RESUME: Found existing temp file for job ${job.id}, but no resumeTimestamp - restarting from 0%`
        );
      } else {
        this.logger.warn(
          `Temp file corrupted for job ${job.id}, restarting from 0%: ${jobWithResume.tempFilePath}`
        );
        try {
          await fs.unlink(jobWithResume.tempFilePath);
        } catch {
          // Ignore
        }
        this.eventEmitter.emit(
          EncodingProgressUpdateEvent.event,
          new EncodingProgressUpdateEvent(job.id, { progress: 0, etaSeconds: 0, fps: 0 })
        );
      }
    }

    const hwaccel = await this._detectHardwareAcceleration();

    const tempOutput = customOutputPath || jobWithResume.tempFilePath || `${job.filePath}.tmp.mp4`;
    this.logger.debug(`[${job.id}] Output path: ${tempOutput}`);

    await this.tempFileGuard.registerTempFile(job.id, tempOutput, job.nodeId);

    const resumeTimestampValue = jobWithResume.resumeTimestamp ?? undefined;
    const args = this.buildFfmpegCommand(
      job,
      policy,
      hwaccel,
      tempOutput,
      resumeFromSeconds > 0 ? resumeTimestampValue : undefined
    );

    const niceValue = this.processManager.getNiceValue(job.priority);
    const ffmpegProcess = this.processManager.spawnFfmpegProcess(args, niceValue);

    this.logger.debug(
      `[${job.id}] FFmpeg process spawned (PID: ${ffmpegProcess.pid}), attaching stderr listener...`
    );

    const activeEncoding = this.processManager.createActiveEncoding(job.id, ffmpegProcess);

    if (ffmpegProcess.pid) {
      this.nfsHealth.startMonitoring(job.id, job.filePath, ffmpegProcess.pid);
      this.diskSpaceGuard.startMonitoring(job.id, tempOutput, ffmpegProcess.pid);
    }

    return new Promise((resolve, reject) => {
      let fullStderr = '';

      ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        fullStderr += chunk;
        const filtered = fullStderr
          .split('\n')
          .filter(
            (l) =>
              !/^(frame|fps|out_time|out_time_ms|out_time_us|dup_frames|drop_frames|speed|bitrate|total_size|progress)=/.test(
                l.trim()
              )
          )
          .join('\n');
        fullStderr = filtered.length > 2000 ? filtered.slice(-2000) : filtered;
        activeEncoding.lastStderr = fullStderr;
        activeEncoding.lastOutputTime = new Date();
      });

      let stdoutBuffer = '';
      let currentFrame = 0;
      let currentFps = 0;
      let currentTime = '00:00:00.00';

      ffmpegProcess.stdout?.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.includes('=')) continue;

          const eqIdx = trimmed.indexOf('=');
          const key = trimmed.slice(0, eqIdx);
          const value = trimmed.slice(eqIdx + 1);

          switch (key) {
            case 'frame':
              currentFrame = Number.parseInt(value, 10) || 0;
              break;
            case 'fps':
              currentFps = Number.parseFloat(value) || 0;
              break;
            case 'out_time':
              currentTime = value;
              break;
            case 'out_time_us':
              if (!currentTime || currentTime === 'N/A') {
                const us = Number.parseInt(value, 10);
                if (!Number.isNaN(us) && us > 0) {
                  const totalSeconds = us / 1_000_000;
                  const hours = Math.floor(totalSeconds / 3600);
                  const minutes = Math.floor((totalSeconds % 3600) / 60);
                  const seconds = totalSeconds % 60;
                  currentTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toFixed(6).padStart(9, '0')}`;
                }
              }
              break;
            case 'progress':
              if ((currentFrame > 0 || currentTime !== '00:00:00.00') && currentFps >= 0) {
                activeEncoding.lastOutputTime = new Date();
                this.progressTracker.trackSpeedAnomaly(job.id, currentFps);
                this.progressTracker
                  .handleProgressUpdate(
                    { frame: currentFrame, fps: currentFps, currentTime },
                    job,
                    activeEncoding,
                    estimatedDurationSeconds,
                    tempOutput,
                    resumeFromPercent,
                    this.processManager.lastPreviewGeneration,
                    this.processManager.PREVIEW_THROTTLE_MS,
                    (jobId) => this.processManager.killProcess(jobId)
                  )
                  .catch((error: Error) => {
                    this.logger.error(`[${job.id}] Progress update error: ${error.message}`);
                  });
              }
              break;
          }
        }
      });

      ffmpegProcess.on('close', async (code, signal) => {
        const encoding = this.processManager.activeEncodings.get(job.id);
        if (encoding?.completionHandled) return;
        if (encoding) encoding.completionHandled = true;
        if (encoding?.isPauseOrCancelRequested) {
          this.processManager.activeEncodings.delete(job.id);
          this.processManager.lastPreviewGeneration.delete(job.id);
          resolve();
          return;
        }

        if (encoding?.lastStderr) {
          this.processManager.cacheStderr(job.id, encoding.lastStderr);
        }

        this.processManager.activeEncodings.delete(job.id);
        this.processManager.lastPreviewGeneration.delete(job.id);
        this.progressTracker.deleteSpeedTracker(job.id);
        this.nfsHealth.stopMonitoring(job.id);
        this.diskSpaceGuard.stopMonitoring(job.id);

        if (signal !== null && code === null) {
          const errorMessage = `FFmpeg killed by signal: ${signal}`;
          this.logger.error(`[${job.id}] ${errorMessage}`);
          await this.healthMonitor.handleEncodingFailure(
            job,
            tempOutput,
            errorMessage,
            false,
            this.processManager.lastPreviewGeneration
          );
          await this.tempFileGuard.cleanupJobTempFiles(job.id);
          reject(new Error(errorMessage));
          return;
        }

        if (code === 0) {
          try {
            await this.healthMonitor.handleEncodingSuccess(
              job,
              policy,
              tempOutput,
              this.processManager.lastPreviewGeneration
            );
            await this.tempFileGuard.markCleaned(tempOutput);
            resolve();
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await this.healthMonitor.handleEncodingFailure(
              job,
              tempOutput,
              errorMessage,
              false,
              this.processManager.lastPreviewGeneration
            );
            await this.tempFileGuard.cleanupJobTempFiles(job.id);
            reject(error);
          }
        } else {
          const stderr = encoding?.lastStderr || '';
          const progress = job.progress || 0;
          const retryCount = job.retryCount || 0;
          const errorMessage = this.interpretFfmpegExitCode(
            code ?? -1,
            stderr,
            progress,
            retryCount
          );
          const isDiskFull =
            stderr.includes('No space left on device') || stderr.includes('ENOSPC');
          if (isDiskFull && tempOutput) {
            this.logger.warn(
              `[${job.id}] Disk-full detected — cleaning up partial temp file: ${tempOutput}`
            );
            try {
              await fs.unlink(tempOutput);
              this.logger.warn(`[${job.id}] Partial temp file removed after disk-full`);
            } catch (unlinkErr) {
              const unlinkCode = (unlinkErr as NodeJS.ErrnoException).code;
              if (unlinkCode !== 'ENOENT') {
                this.logger.error(
                  `[${job.id}] Failed to remove partial temp file after disk-full: ${unlinkErr}`
                );
              }
            }
            await this.tempFileGuard.markCleaned(tempOutput);
          }
          await this.healthMonitor.handleEncodingFailure(
            job,
            tempOutput,
            errorMessage,
            false,
            this.processManager.lastPreviewGeneration
          );
          reject(new Error(errorMessage));
        }
      });

      ffmpegProcess.on('error', async (error) => {
        const encoding = this.processManager.activeEncodings.get(job.id);
        if (encoding?.completionHandled) return;
        if (encoding) encoding.completionHandled = true;
        if (encoding?.isPauseOrCancelRequested) {
          this.processManager.activeEncodings.delete(job.id);
          this.processManager.lastPreviewGeneration.delete(job.id);
          resolve();
          return;
        }

        if (encoding?.lastStderr) {
          this.processManager.cacheStderr(job.id, encoding.lastStderr);
        }

        this.processManager.activeEncodings.delete(job.id);
        this.processManager.lastPreviewGeneration.delete(job.id);
        this.progressTracker.deleteSpeedTracker(job.id);
        this.nfsHealth.stopMonitoring(job.id);
        this.diskSpaceGuard.stopMonitoring(job.id);

        let errorMessage = `FFmpeg Process Error: ${error.message}`;
        if (encoding?.lastStderr) {
          errorMessage += '\n\nLast output from ffmpeg:\n';
          const stderrLines = encoding.lastStderr.trim().split('\n');
          errorMessage += stderrLines.slice(-15).join('\n');
        }

        await this.healthMonitor.handleEncodingFailure(
          job,
          tempOutput,
          errorMessage,
          false,
          this.processManager.lastPreviewGeneration
        );
        await this.tempFileGuard.cleanupJobTempFiles(job.id);
        reject(error);
      });
    });
  }

  // ─── encodeSegment ─────────────────────────────────────────────────────────

  async encodeSegment(
    job: Job,
    policy: Policy,
    outputPath: string,
    startSeconds: number,
    durationSeconds: number,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    this.logger.log(
      `[${job.id}] encodeSegment() start=${startSeconds}s duration=${durationSeconds}s → ${outputPath}`
    );

    const hwaccel = await this._detectHardwareAcceleration();
    const args = this.buildFfmpegCommand(job, policy, hwaccel, outputPath, undefined);

    args.unshift('-ss', startSeconds.toString());

    const yIndex = args.lastIndexOf('-y');
    if (yIndex !== -1) {
      args.splice(yIndex, 0, '-t', durationSeconds.toString());
    }

    const cvIndex = args.indexOf('-c:v');
    if (cvIndex !== -1 && cvIndex + 1 < args.length) {
      args.splice(cvIndex + 2, 0, '-force_key_frames', 'expr:gte(t,0)');
    }

    const niceValue = this.processManager.getNiceValue(job.priority);
    const ffmpegProcess = this.processManager.spawnFfmpegProcess(args, niceValue);

    this.logger.debug(
      `[${job.id}] Segment FFmpeg PID=${ffmpegProcess.pid} args: ffmpeg ${args.join(' ')}`
    );

    const activeEncoding = this.processManager.createActiveEncoding(job.id, ffmpegProcess);

    if (ffmpegProcess.pid) {
      this.nfsHealth.startMonitoring(job.id, job.filePath, ffmpegProcess.pid);
      this.diskSpaceGuard.startMonitoring(job.id, outputPath, ffmpegProcess.pid);
    }

    return new Promise((resolve, reject) => {
      let fullStderr = '';

      ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        fullStderr += chunk;
        const filtered = fullStderr
          .split('\n')
          .filter(
            (l) =>
              !/^(frame|fps|out_time|out_time_ms|out_time_us|dup_frames|drop_frames|speed|bitrate|total_size|progress)=/.test(
                l.trim()
              )
          )
          .join('\n');
        fullStderr = filtered.length > 2000 ? filtered.slice(-2000) : filtered;
        activeEncoding.lastStderr = fullStderr;
        activeEncoding.lastOutputTime = new Date();
      });

      let stdoutBuffer = '';
      let currentTime = '00:00:00.00';
      let currentFps = 0;
      let currentFrame = 0;

      ffmpegProcess.stdout?.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.includes('=')) continue;

          const eqIdx = trimmed.indexOf('=');
          const key = trimmed.slice(0, eqIdx);
          const value = trimmed.slice(eqIdx + 1);

          switch (key) {
            case 'frame':
              currentFrame = Number.parseInt(value, 10) || 0;
              break;
            case 'fps':
              currentFps = Number.parseFloat(value) || 0;
              break;
            case 'out_time':
              currentTime = value;
              break;
            case 'progress':
              if (currentFrame > 0 || currentTime !== '00:00:00.00') {
                activeEncoding.lastOutputTime = new Date();
                if (onProgress) {
                  const pct = Math.min(
                    100,
                    this.progressTracker.calculateProgressPercentage(
                      currentTime,
                      durationSeconds
                    ) || 0
                  );
                  onProgress(pct);
                }
              }
              break;
          }
        }
        if (currentFps > 0) this.progressTracker.trackSpeedAnomaly(job.id, currentFps);
      });

      ffmpegProcess.on('close', async (code, signal) => {
        const encoding = this.processManager.activeEncodings.get(job.id);
        if (encoding?.completionHandled) return;
        if (encoding) encoding.completionHandled = true;

        if (encoding?.lastStderr) {
          this.processManager.cacheStderr(job.id, encoding.lastStderr);
        }

        this.processManager.activeEncodings.delete(job.id);
        this.processManager.lastPreviewGeneration.delete(job.id);
        this.nfsHealth.stopMonitoring(job.id);

        if (signal !== null && code === null) {
          reject(new Error(`Segment FFmpeg killed by signal: ${signal}`));
          return;
        }

        if (code === 0) {
          resolve();
        } else {
          const stderr = encoding?.lastStderr || '';
          reject(
            new Error(
              `Segment FFmpeg exited with code ${code ?? -1}. stderr: ${stderr.slice(-500)}`
            )
          );
        }
      });

      ffmpegProcess.on('error', async (error) => {
        const encoding = this.processManager.activeEncodings.get(job.id);
        if (encoding?.completionHandled) return;
        if (encoding) encoding.completionHandled = true;

        if (encoding?.lastStderr) {
          this.processManager.cacheStderr(job.id, encoding.lastStderr);
        }

        this.processManager.activeEncodings.delete(job.id);
        this.processManager.lastPreviewGeneration.delete(job.id);
        this.nfsHealth.stopMonitoring(job.id);

        reject(new Error(`Segment FFmpeg process error: ${error.message}`));
      });
    });
  }

  /**
   * Encode a file with custom options (simplified interface used by segmented-encode orchestrator).
   */
  async encode(
    jobId: string,
    options: {
      inputPath: string;
      outputPath: string;
      targetCodec: string;
      targetQuality: number;
      hwAccel?: string;
      advancedSettings?: Record<string, unknown>;
      startedFromSeconds?: number;
    }
  ): Promise<void> {
    let progress = 0;
    let resumeTimestamp: string | undefined;
    let tempFilePath: string | undefined;

    if (options.startedFromSeconds && options.startedFromSeconds > 0) {
      const durationSeconds = await this.ffprobe.getVideoDuration(options.inputPath);
      progress = (options.startedFromSeconds / durationSeconds) * 100;
      resumeTimestamp = this.progressTracker.formatSecondsToTimestamp(options.startedFromSeconds);
      tempFilePath = options.outputPath;

      this.logger.log(
        `TRUE RESUME: encode() called with startedFromSeconds=${options.startedFromSeconds}, progress=${progress.toFixed(1)}%, resumeTimestamp=${resumeTimestamp}`
      );
    }

    const job = {
      id: jobId,
      type: 'ENCODE',
      filePath: options.inputPath,
      fileLabel: '',
      sourceCodec: '',
      sourceContainer: null,
      targetCodec: options.targetCodec,
      targetContainer: null,
      stage: 'ENCODING' as const,
      progress,
      etaSeconds: null,
      fps: null,
      beforeSizeBytes: BigInt(0),
      afterSizeBytes: null,
      savedBytes: null,
      savedPercent: null,
      startedAt: new Date(),
      completedAt: null,
      failedAt: null,
      error: null,
      isBlacklisted: false,
      retryCount: 0,
      nextRetryAt: null,
      autoHealedAt: null,
      autoHealedProgress: null,
      healthStatus: 'UNKNOWN',
      healthScore: 0,
      healthMessage: null,
      healthCheckedAt: null,
      healthCheckStartedAt: null,
      healthCheckRetries: 0,
      decisionRequired: false,
      decisionIssues: null,
      decisionMadeAt: null,
      decisionData: null,
      priority: 0,
      prioritySetAt: null,
      pauseRequestedAt: null,
      pauseProcessedAt: null,
      cancelRequestedAt: null,
      cancelProcessedAt: null,
      tempFilePath: resumeTimestamp && tempFilePath ? tempFilePath : null,
      resumeTimestamp: resumeTimestamp || null,
      lastProgressUpdate: null,
      lastHeartbeat: null,
      heartbeatNodeId: null,
      lastStageChangeAt: null,
      previewImagePaths: null,
      keepOriginalRequested: false,
      originalBackupPath: null,
      originalSizeBytes: null,
      replacementAction: null,
      warning: null,
      resourceThrottled: false,
      resourceThrottleReason: null,
      ffmpegThreads: null,
      startedFromSeconds: null,
      healingPointSeconds: null,
      nodeId: '',
      libraryId: '',
      policyId: '',
      originalNodeId: null,
      manualAssignment: false,
      transferRequired: false,
      originalFilePath: null,
      transferProgress: 0,
      transferSpeedMBps: null,
      transferStartedAt: null,
      transferCompletedAt: null,
      transferLastProgressAt: null,
      transferError: null,
      remoteTempPath: null,
      transferRetryCount: 0,
      assignedAt: null,
      stickyUntil: null,
      migrationCount: 0,
      estimatedDuration: null,
      estimatedStartAt: null,
      estimatedCompleteAt: null,
      lastScoreBreakdown: null,
      assignmentReason: null,
      autoHealClaimedAt: null,
      autoHealClaimedBy: null,
      corruptedRequeueCount: 0,
      stuckRecoveryCount: 0,
      contentFingerprint: null,
      qualityMetrics: null,
      qualityMetricsAt: null,
      fencingToken: null,
      gpuAttempts: 0,
      codecOverride: null,
      ownershipLeaseExpiry: null,
      ownershipEpoch: 0,
      pendingCompletionData: null,
      pendingCompletionAt: null,
      totalAttempts: 0,
      circuitBroken: false,
      circuitBrokenAt: null,
      circuitBrokenReason: null,
      dlqEnteredAt: null,
      jobFingerprint: null,
      segmentedEncode: false,
      segmentCount: null,
      currentSegmentIndex: null,
      segmentDurationSecs: 300,
      segmentsDir: null,
      concatListPath: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Job;

    const policy = {
      id: '',
      name: '',
      preset: 'CUSTOM' as const,
      targetCodec: options.targetCodec,
      targetQuality: options.targetQuality,
      deviceProfiles: {},
      advancedSettings: options.advancedSettings || {},
      atomicReplace: false,
      verifyOutput: false,
      skipSeeding: false,
      libraryId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Policy;

    await this.encodeFile(job, policy, options.outputPath);
  }

  private async _detectHardwareAcceleration(): Promise<HardwareAccelConfig> {
    return this.hardwareAcceleration.detectHardwareAcceleration();
  }
}
