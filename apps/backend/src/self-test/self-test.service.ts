import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TargetCodec } from '@prisma/client';
import { NodeConfigService } from '../core/services/node-config.service';
import { EncodingPreviewService } from '../encoding/encoding-preview.service';
import { FfmpegService } from '../encoding/ffmpeg.service';
import { DiscordNotificationService } from '../notifications/integrations/discord.service';
import { EmailNotificationService } from '../notifications/integrations/email.service';
import { SlackNotificationService } from '../notifications/integrations/slack.service';
import { WebhookNotificationService } from '../queue/services/webhook-notification.service';
import { createMockJob, createMockPolicy } from '../testing/mock-factories';
import {
  generateSelfTestVideo,
  type SelfTestVideoOptions,
} from './self-test-fixture-generator';

interface CorpusItem {
  name: string;
  video: SelfTestVideoOptions;
  targetCodec: TargetCodec;
}

export interface SelfTestSummary {
  ranAt: Date;
  total: number;
  passed: number;
  failed: number;
  successRate: number;
  failures: Array<{ name: string; error: string }>;
}

// Below this pass rate, alert - a single flaky fixture shouldn't page
// anyone, but a broad regression across the corpus should.
const ALERT_THRESHOLD_PERCENT = 80;
const SHORT_DURATION_SECONDS = 8;
const SMALL_TARGET_SIZE_MB = 5;

/**
 * SelfTestService
 *
 * Nightly regression harness for the encoding pipeline itself: generates a
 * small corpus of synthetic fixtures covering codec/bit-depth/HDR/subtitle
 * combinations, runs each through the REAL FfmpegService (the same encoder
 * used for real jobs), and alerts if the pass rate drops. Unit tests mock
 * ffmpeg entirely, so they can't catch a real regression in command
 * construction or filter chains - this is what actually proves "just works"
 * stays true after a code change.
 *
 * Deliberately bypasses the Job/Queue system: these are throwaway synthetic
 * files, not real user jobs, and creating real Job rows for them would
 * pollute production success-rate analytics with no way to filter them back
 * out (Job has no isTest/source column). encodeFile() does still make two
 * kinds of DB touches keyed to the fake job id - TempFileGuardService's temp
 * file registration and QueueService's progress/failure event listeners -
 * both fail on the nonexistent Job row and both fail safely (caught,
 * logged, never thrown), so this doesn't crash anything. The practical cost
 * is that crash-recovery doesn't apply to a self-test's own temp file if the
 * backend restarts mid-run; that's fine since the next night's run
 * overwrites the same fixed filename anyway. Job ids are prefixed
 * `self-test-` so this is easy to recognize if it ever shows up in logs.
 */
@Injectable()
export class SelfTestService {
  private readonly logger = new Logger(SelfTestService.name);
  private lastSummary: SelfTestSummary | null = null;
  // Re-entrancy guard, same pattern as HealthCheckWorker's hourly cron:
  // @Cron alone doesn't prevent overlapping runs, and buildCorpus() uses
  // fixed (non-timestamped) filenames, so two overlapping runs would race
  // on the same scratch files.
  private running = false;

  constructor(
    private readonly ffmpegService: FfmpegService,
    private readonly nodeConfig: NodeConfigService,
    private readonly previewService: EncodingPreviewService,
    private readonly discord: DiscordNotificationService,
    private readonly slack: SlackNotificationService,
    private readonly email: EmailNotificationService,
    private readonly webhook: WebhookNotificationService
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runNightlySelfTest(): Promise<void> {
    // MAIN only - a LINKED node running this too would just duplicate the
    // same regression signal against the same codebase.
    if (!this.nodeConfig.isMainNode()) return;
    await this.runCorpus();
  }

  getLastSummary(): SelfTestSummary | null {
    return this.lastSummary;
  }

  async runCorpus(): Promise<SelfTestSummary> {
    if (this.running) {
      this.logger.warn('Self-test corpus already running, skipping this trigger');
      return (
        this.lastSummary ?? {
          ranAt: new Date(),
          total: 0,
          passed: 0,
          failed: 0,
          successRate: 100,
          failures: [],
        }
      );
    }
    this.running = true;

    try {
      return await this.runCorpusUnguarded();
    } finally {
      this.running = false;
    }
  }

  private async runCorpusUnguarded(): Promise<SelfTestSummary> {
    const scratchDir = this.getScratchDir();
    const corpus = this.buildCorpus();
    const failures: Array<{ name: string; error: string }> = [];
    let passed = 0;

    this.logger.log(`Starting nightly self-test corpus (${corpus.length} fixtures)`);

    for (const item of corpus) {
      try {
        await this.runOne(item, scratchDir);
        passed++;
        this.logger.debug(`[self-test] ${item.name}: passed`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ name: item.name, error: message });
        this.logger.warn(`[self-test] ${item.name}: failed - ${message}`);
      }
    }

    const total = corpus.length;
    const successRate = total > 0 ? (passed / total) * 100 : 100;
    const summary: SelfTestSummary = {
      ranAt: new Date(),
      total,
      passed,
      failed: failures.length,
      successRate,
      failures,
    };
    this.lastSummary = summary;

    this.logger.log(
      `Self-test corpus complete: ${passed}/${total} passed (${successRate.toFixed(0)}%)`
    );

    if (successRate < ALERT_THRESHOLD_PERCENT) {
      await this.alert(summary);
    }

    return summary;
  }

  private getScratchDir(): string {
    const dir = path.join(os.tmpdir(), 'bitbonsai-self-test');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private async runOne(item: CorpusItem, scratchDir: string): Promise<void> {
    const jobId = `self-test-${item.name}-${Date.now()}`;
    let sourcePath: string | undefined;
    let outputPath: string | undefined;

    try {
      sourcePath = await generateSelfTestVideo(item.video, scratchDir);
      outputPath = `${sourcePath}.out.mkv`;

      const job = createMockJob({
        id: jobId,
        filePath: sourcePath,
        fileLabel: item.video.filename,
        targetCodec: item.targetCodec,
        targetContainer: 'mkv',
      });
      const policy = createMockPolicy({
        targetCodec: item.targetCodec,
        targetContainer: 'mkv',
      });

      await this.ffmpegService.encodeFile(job, policy, outputPath);
    } finally {
      // Progress events during the encode can trigger preview generation
      // keyed to jobId; that directory is never reclaimed by anything else
      // since this job was never persisted, so always sweep it here
      // regardless of whether previews were actually generated.
      await this.previewService.cleanupPreviews(jobId);

      for (const file of [sourcePath, outputPath].filter((f): f is string => Boolean(f))) {
        try {
          if (fs.existsSync(file)) fs.unlinkSync(file);
        } catch (cleanupError: unknown) {
          this.logger.warn(`[self-test] Failed to clean up ${file}:`, cleanupError);
        }
      }
    }
  }

  private buildCorpus(): CorpusItem[] {
    const base = {
      duration: SHORT_DURATION_SECONDS,
      targetSizeMB: SMALL_TARGET_SIZE_MB,
    };

    return [
      {
        name: 'h264-to-hevc-baseline',
        video: { ...base, filename: 'self-test-baseline.mkv', codec: 'h264', audio: 'aac' },
        targetCodec: TargetCodec.HEVC,
      },
      {
        name: 'hevc-10bit-passthrough',
        video: {
          ...base,
          filename: 'self-test-10bit.mkv',
          codec: 'hevc',
          audio: 'aac',
          pixFmt: 'yuv420p10le',
        },
        targetCodec: TargetCodec.HEVC,
      },
      {
        name: 'hevc-hdr10',
        video: { ...base, filename: 'self-test-hdr-hevc.mkv', codec: 'hevc', audio: 'aac', hdr: true },
        targetCodec: TargetCodec.HEVC,
      },
      {
        name: 'av1-hdr10',
        video: { ...base, filename: 'self-test-hdr-av1.mkv', codec: 'av1', audio: 'aac', hdr: true },
        targetCodec: TargetCodec.AV1,
      },
      {
        name: 'bitmap-subs',
        video: {
          ...base,
          filename: 'self-test-bitmap-subs.mkv',
          codec: 'h264',
          audio: 'aac',
          bitmapSubtitles: true,
        },
        targetCodec: TargetCodec.HEVC,
      },
      {
        name: 'ac3-audio',
        video: { ...base, filename: 'self-test-ac3.mkv', codec: 'h264', audio: 'ac3' },
        targetCodec: TargetCodec.HEVC,
      },
    ];
  }

  private async alert(summary: SelfTestSummary): Promise<void> {
    const failedNames = summary.failures.map((f) => f.name).join(', ') || 'none';
    const message =
      `Nightly encoding self-test: ${summary.passed}/${summary.total} passed ` +
      `(${summary.successRate.toFixed(0)}%). Failed: ${failedNames}`;

    const results = await Promise.allSettled([
      this.discord.sendHealthAlert({ type: 'SELF_TEST_CORPUS', message, severity: 'critical' }),
      this.slack.sendHealthAlert({ type: 'SELF_TEST_CORPUS', message, severity: 'critical' }),
      this.email.sendHealthAlert({ type: 'SELF_TEST_CORPUS', message, severity: 'critical' }),
      this.webhook.sendHealthAlert('SELF_TEST_CORPUS', message, {
        passed: summary.passed,
        total: summary.total,
        successRate: summary.successRate,
        failures: summary.failures,
      }),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(`[self-test] Alert channel failed: ${result.reason}`);
      }
    }
  }
}
