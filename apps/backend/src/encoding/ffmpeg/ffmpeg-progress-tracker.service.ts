import { existsSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job } from '@prisma/client';
import { EncodingPreviewUpdateEvent, EncodingProgressUpdateEvent } from '../../common/events';
import { JobRepository } from '../../common/repositories/job.repository';
import type { EncodingProgressDto } from '../dto/encoding-progress.dto';
import { EncodingPreviewService } from '../encoding-preview.service';
import { FfmpegProgressParserService } from '../ffmpeg-progress-parser.service';
import type { ActiveEncoding } from './ffmpeg-process-manager.service';

/**
 * Per-job FPS speed anomaly tracking
 */
interface SpeedTracker {
  samples: number[];
  anomalyStart: number | null;
}

/**
 * FfmpegProgressTracker
 *
 * Owns progress parsing, speed anomaly detection, and sample tracking.
 */
@Injectable()
export class FfmpegProgressTracker {
  readonly logger = new Logger(FfmpegProgressTracker.name);
  readonly speedTrackers = new Map<string, SpeedTracker>();

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly progressParser: FfmpegProgressParserService,
    private readonly previewService: EncodingPreviewService
  ) {}

  parseProgress(line: string): Pick<EncodingProgressDto, 'frame' | 'fps' | 'currentTime'> | null {
    return this.progressParser.parseProgress(line);
  }

  calculateProgressPercentage(currentTime: string, totalDurationSeconds: number): number {
    return this.progressParser.calculateProgressPercentage(currentTime, totalDurationSeconds);
  }

  parseTimestampToSeconds(timestamp: string): number {
    return this.progressParser.parseTimestampToSeconds(timestamp);
  }

  formatSecondsToTimestamp(totalSeconds: number): string {
    return this.progressParser.formatSecondsToTimestamp(totalSeconds);
  }

  deleteSpeedTracker(jobId: string): void {
    this.speedTrackers.delete(jobId);
  }

  clearAllTrackers(): void {
    this.speedTrackers.clear();
  }

  trackSpeedAnomaly(jobId: string, currentFps: number): void {
    const MAX_SAMPLES = 12;
    const MIN_SAMPLES_FOR_BASELINE = 6;
    const ANOMALY_THRESHOLD_RATIO = 0.15;
    const ANOMALY_DURATION_MS = 30_000;

    if (!this.speedTrackers.has(jobId)) {
      this.speedTrackers.set(jobId, { samples: [], anomalyStart: null });
    }

    const tracker = this.speedTrackers.get(jobId) ?? { samples: [], anomalyStart: null };
    this.speedTrackers.set(jobId, tracker);

    if (currentFps > 0) {
      tracker.samples.push(currentFps);
      if (tracker.samples.length > MAX_SAMPLES) {
        tracker.samples.shift();
      }
    }

    if (tracker.samples.length < MIN_SAMPLES_FOR_BASELINE) return;

    const rollingAvg = tracker.samples.reduce((a, b) => a + b, 0) / tracker.samples.length;
    const isAnomaly = currentFps > 0 && currentFps < rollingAvg * ANOMALY_THRESHOLD_RATIO;

    if (isAnomaly) {
      if (tracker.anomalyStart === null) {
        tracker.anomalyStart = Date.now();
      } else if (Date.now() - tracker.anomalyStart >= ANOMALY_DURATION_MS) {
        this.logger.warn(
          `Encode speed anomaly: job ${jobId} fps dropped from ${rollingAvg.toFixed(1)} to ${currentFps.toFixed(1)} — possible disk stall or NFS hang`
        );
        tracker.anomalyStart = Date.now();
      }
    } else {
      tracker.anomalyStart = null;
    }
  }

  async handleProgressUpdate(
    progressData: Pick<EncodingProgressDto, 'frame' | 'fps' | 'currentTime'>,
    job: Job,
    activeEncoding: ActiveEncoding,
    estimatedDurationSeconds: number,
    tempOutput: string,
    resumeFromPercent: number,
    lastPreviewGeneration: Map<string, number>,
    previewThrottleMs: number,
    killProcessFn: (jobId: string) => Promise<boolean | void>
  ): Promise<void> {
    const jobStatus = await this.jobRepository.findStatusFields(job.id);
    if (jobStatus?.pauseRequestedAt && !jobStatus.pauseProcessedAt) {
      this.logger.warn(`[${job.id}] Pause requested, killing FFmpeg gracefully...`);
      activeEncoding.isPauseOrCancelRequested = true;
      await killProcessFn(job.id);
      return;
    }
    if (jobStatus?.cancelRequestedAt && !jobStatus.cancelProcessedAt) {
      this.logger.warn(`[${job.id}] Cancel requested, killing FFmpeg gracefully...`);
      activeEncoding.isPauseOrCancelRequested = true;
      await killProcessFn(job.id);
      return;
    }

    let currentProgress = this.calculateProgressPercentage(
      progressData.currentTime,
      estimatedDurationSeconds
    );

    if (currentProgress === 0 && progressData.frame > 0 && estimatedDurationSeconds > 0) {
      const assumedSourceFps = 24;
      const estimatedTotalFrames = estimatedDurationSeconds * assumedSourceFps;

      if (estimatedTotalFrames > 0) {
        currentProgress = Math.min(100, (progressData.frame / estimatedTotalFrames) * 100);
        this.logger.debug(
          `[${job.id}] Frame-based progress fallback: ${currentProgress.toFixed(2)}% (${progressData.frame}/${Math.round(estimatedTotalFrames)} frames, out_time=${progressData.currentTime})`
        );
      }
    }

    const adjustedProgress = Math.min(100, Math.max(resumeFromPercent, currentProgress));

    const elapsed = Date.now() - activeEncoding.startTime.getTime();
    const remainingPercent = 100 - adjustedProgress;
    const eta =
      adjustedProgress > resumeFromPercent
        ? Math.round(((elapsed / (adjustedProgress - resumeFromPercent)) * remainingPercent) / 1000)
        : 0;

    const progressDto: EncodingProgressDto = {
      jobId: job.id,
      frame: progressData.frame,
      fps: progressData.fps,
      currentTime: progressData.currentTime,
      progress: adjustedProgress,
      eta,
    };

    this.eventEmitter.emit('encoding.progress', progressDto);

    const isFirstProgressEvent = activeEncoding.lastProgress === 0 && progressData.frame > 0;
    if (adjustedProgress - activeEncoding.lastProgress >= 0.1 || isFirstProgressEvent) {
      this.logger.debug(
        `[${job.id}] Updating database: ${adjustedProgress.toFixed(2)}% @ ${progressData.currentTime} (ETA: ${eta}s)${isFirstProgressEvent ? ' [FIRST]' : ''}`
      );
      this.eventEmitter.emit(
        EncodingProgressUpdateEvent.event,
        new EncodingProgressUpdateEvent(job.id, {
          progress: Math.round(adjustedProgress * 100) / 100,
          etaSeconds: eta,
          fps: progressData.fps,
          resumeTimestamp: progressData.currentTime,
          tempFilePath: tempOutput,
        })
      );
      activeEncoding.lastProgress = adjustedProgress;

      const now = Date.now();
      const lastGeneration = lastPreviewGeneration.get(job.id) || 0;
      if (now - lastGeneration >= previewThrottleMs && tempOutput && existsSync(tempOutput)) {
        lastPreviewGeneration.set(job.id, now);
        this.logger.debug(
          `[${job.id}] Generating encoding previews at ${adjustedProgress.toFixed(2)}%`
        );

        this.previewService
          .generatePreviews(job.id, tempOutput, estimatedDurationSeconds, adjustedProgress)
          .then((previewPaths) => {
            if (previewPaths.length > 0) {
              this.eventEmitter.emit(
                EncodingPreviewUpdateEvent.event,
                new EncodingPreviewUpdateEvent(job.id, previewPaths)
              );
              this.logger.debug(`[${job.id}] Generated ${previewPaths.length} preview screenshots`);
            }
          })
          .catch((error) => {
            this.logger.warn(`Failed to generate previews for job ${job.id}: ${error.message}`);
          });
      }
    }
  }
}
