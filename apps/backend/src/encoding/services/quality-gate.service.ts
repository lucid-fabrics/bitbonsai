import { spawn } from 'node:child_process';
import { Injectable, Logger } from '@nestjs/common';
import { type Job } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QualityMetrics, QualityMetricsService } from '../quality-metrics.service';

export interface QualityGateResult {
  passed: boolean;
  score: number | null;
  threshold: number;
  forcedPass: boolean;
}

const QUALITY_GATE_WARNING_PREFIX = 'Quality gate:';
const MAX_QUALITY_GATE_RETRIES = 3;

/**
 * Quality Gate Service
 *
 * Evaluates whether a completed encode meets the configured VMAF quality threshold.
 * Uses the VMAF score already stored on the job when available; falls back to probing
 * the output file with a 60-second sample when no score is present.
 *
 * Design:
 * - Non-blocking on VMAF tool absence (libvmaf not compiled in → always passes)
 * - Guards against infinite retry loops: if quality-gate retries >= MAX_QUALITY_GATE_RETRIES,
 *   the gate is force-passed with a warning rather than re-queuing forever
 * - Threshold is read from the Settings table (vmafThreshold column, default 85)
 * - If qualityMetricsEnabled is false in settings, threshold is forced to 0 (always pass)
 */
@Injectable()
export class QualityGateService {
  private readonly logger = new Logger(QualityGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qualityMetricsService: QualityMetricsService
  ) {}

  /**
   * Check whether the encoded output meets the VMAF quality threshold.
   *
   * Flow:
   * 1. Count prior quality-gate retries on this job — if >= MAX, force pass with warning
   * 2. Parse qualityMetrics JSON from the job record; if VMAF is present, use it
   * 3. If no stored VMAF: probe the output file against the original (60-second sample)
   * 4. Compare score to threshold and return the result
   */
  async checkQuality(
    job: Job,
    outputPath: string,
    storedMetrics?: QualityMetrics | null
  ): Promise<QualityGateResult> {
    const threshold = await this.getThreshold();

    // Force pass when threshold is 0 (feature disabled)
    if (threshold === 0) {
      return { passed: true, score: null, threshold, forcedPass: true };
    }

    // Guard: if this job has already been re-queued by the quality gate enough times,
    // force-pass to avoid an infinite retry loop.
    const priorQualityGateRetries = this.countQualityGateRetries(job);
    if (priorQualityGateRetries >= MAX_QUALITY_GATE_RETRIES) {
      this.logger.warn(
        `Quality gate retry limit reached for job ${job.id} ` +
          `(${priorQualityGateRetries} prior retries) — accepting result regardless of VMAF`
      );
      return { passed: true, score: null, threshold, forcedPass: true };
    }

    // PSNR pre-gate: 10-20x faster than VMAF, catches catastrophically bad encodes early
    const psnrResult = await this.runPsnrPreGate(outputPath, job.filePath);
    if (!psnrResult.passed) {
      this.logger.warn(
        `Quality gate: PSNR pre-gate failed for job ${job.id} — PSNR=${psnrResult.psnr?.toFixed(2) ?? 'N/A'} < 28.0 (skipping VMAF)`
      );
      return { passed: false, score: psnrResult.psnr, threshold: 28, forcedPass: false };
    }

    // Resolve the VMAF score: prefer already-computed stored value to avoid running ffmpeg twice
    let score: number | null = storedMetrics?.vmaf ?? null;

    if (score === null) {
      score = await this.probeVmaf(job.filePath, outputPath);
    }

    if (score === null) {
      // libvmaf unavailable or probe timed out — fail open
      this.logger.warn(
        `Quality gate: VMAF score unavailable for job ${job.id} — passing without score`
      );
      return { passed: true, score: null, threshold, forcedPass: true };
    }

    const passed = score >= threshold;

    this.logger.log(
      `Quality gate: job ${job.id} VMAF=${score.toFixed(2)}, threshold=${threshold}, passed=${passed}`
    );

    return { passed, score, threshold, forcedPass: false };
  }

  /**
   * Read the VMAF threshold from settings.
   * Returns 0 when quality metrics are disabled (always-pass semantics).
   */
  async getThreshold(): Promise<number> {
    try {
      const settings = await this.prisma.settings.findFirst({
        where: {},
        select: { vmafThreshold: true, qualityMetricsEnabled: true },
      });

      if (settings?.qualityMetricsEnabled === false) {
        return 0; // Disabled → always pass
      }

      return settings?.vmafThreshold ?? Number(process.env['VMAF_THRESHOLD'] ?? '85');
    } catch {
      return Number(process.env['VMAF_THRESHOLD'] ?? '85');
    }
  }

  /**
   * Count how many times this job has already been re-queued by the quality gate.
   * We detect this by looking for the quality-gate warning prefix in job.warning.
   */
  private countQualityGateRetries(job: Job): number {
    if (!job.warning) return 0;
    // Each quality-gate retry appends one warning line with the prefix
    const lines = job.warning.split('\n');
    return lines.filter((l) => l.startsWith(QUALITY_GATE_WARNING_PREFIX)).length;
  }

  /**
   * PSNR fast pre-gate — runs before full VMAF to catch catastrophically bad encodes.
   * PSNR is 10-20x faster than VMAF. Threshold is deliberately liberal (28 dB) to only
   * block truly broken encodes while passing everything else through to VMAF.
   *
   * Samples every 10th frame to keep runtime short (~5-10s typical).
   * Returns { passed: true, psnr: null } on any ffmpeg error or timeout (fail-open).
   */
  private runPsnrPreGate(
    outputPath: string,
    sourcePath: string
  ): Promise<{ passed: boolean; psnr: number | null }> {
    const PSNR_FAIL_THRESHOLD = 28.0;
    const TIMEOUT_MS = 30_000;

    return new Promise((resolve) => {
      const args = [
        '-i',
        sourcePath,
        '-i',
        outputPath,
        '-lavfi',
        "[0:v]select='not(mod(n,10))'[ref];[1:v]select='not(mod(n,10))'[dist];[ref][dist]psnr",
        '-f',
        'null',
        '-',
      ];

      let stderr = '';
      const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

      const timeoutId = setTimeout(() => {
        ffmpeg.kill('SIGKILL');
        this.logger.debug('PSNR pre-gate timed out — failing open');
        resolve({ passed: true, psnr: null });
      }, TIMEOUT_MS);

      ffmpeg.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        clearTimeout(timeoutId);
        ffmpeg.stderr?.destroy();

        if (code !== 0) {
          // ffmpeg error (unsupported filter, missing stream, etc.) — fail open
          resolve({ passed: true, psnr: null });
          return;
        }

        // Parse "PSNR y:XX.XX " from stderr output
        const match = /PSNR\s+y:([\d.]+)/.exec(stderr);
        if (!match) {
          resolve({ passed: true, psnr: null });
          return;
        }

        const psnr = Number.parseFloat(match[1]);
        if (Number.isNaN(psnr)) {
          resolve({ passed: true, psnr: null });
          return;
        }

        resolve({ passed: psnr >= PSNR_FAIL_THRESHOLD, psnr });
      });

      ffmpeg.on('error', () => {
        clearTimeout(timeoutId);
        resolve({ passed: true, psnr: null });
      });
    });
  }

  /**
   * Run a VMAF probe using a 60-second sample from the start of the file.
   * Returns null if libvmaf is not available or if the probe times out/fails.
   */
  private probeVmaf(inputPath: string, outputPath: string): Promise<number | null> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 120_000);
    });
    const vmaf = this.qualityMetricsService
      .calculateVmaf(inputPath, outputPath)
      .finally(() => clearTimeout(timer));
    return Promise.race([vmaf, timeout]);
  }
}

export { QUALITY_GATE_WARNING_PREFIX };
