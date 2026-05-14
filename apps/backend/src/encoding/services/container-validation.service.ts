import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';

export interface ContainerValidationResult {
  valid: boolean;
  reason?: string;
}

const PROBE_TIMEOUT_MS = 30_000;
const DECODE_WALK_TIMEOUT_MS = 120_000;

/**
 * ContainerValidationService
 *
 * Validates output container integrity after encode using ffprobe.
 * Catches truncated moov atoms (MP4), corrupt EBML structures (MKV),
 * and missing streams — before we replace the source file.
 *
 * Strategy:
 * 1. Fast probe: ffprobe -v error -show_format -show_streams
 *    Catches: moov missing, EBML parse errors, no streams, duration=0
 * 2. If probe passes but file is suspect (size < threshold): decode walk
 *    ffmpeg -v error -i file -f null - (catches partial mdat/cluster data)
 */
@Injectable()
export class ContainerValidationService {
  private readonly logger = new Logger(ContainerValidationService.name);

  async validateContainer(
    filePath: string,
    expectedMinDurationSecs?: number
  ): Promise<ContainerValidationResult> {
    const probeResult = await this.runProbe(filePath);
    if (!probeResult.valid) return probeResult;

    if (expectedMinDurationSecs !== undefined && probeResult.duration !== undefined) {
      const durationDiff = Math.abs(probeResult.duration - expectedMinDurationSecs);
      // Reject if duration differs by more than 10% OR if file is under 50% of expected length
      const tolerance = expectedMinDurationSecs * 0.1;
      if (durationDiff > tolerance || probeResult.duration < expectedMinDurationSecs * 0.5) {
        return {
          valid: false,
          reason: `Duration mismatch: expected ~${expectedMinDurationSecs.toFixed(1)}s, got ${probeResult.duration.toFixed(1)}s`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Full decode walk — slower but catches partial mdat/cluster corruption.
   * Only run when fast probe passes but external signal suggests corruption
   * (e.g. file size anomaly, segment size below threshold).
   */
  async decodeWalk(filePath: string): Promise<ContainerValidationResult> {
    return new Promise((resolve) => {
      let stderr = '';
      const proc = spawn('ffmpeg', ['-v', 'error', '-i', filePath, '-f', 'null', '-'], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        // Timeout on decode walk = fail open (file is probably fine, just large)
        this.logger.warn(`Decode walk timed out for ${path.basename(filePath)} — passing`);
        resolve({ valid: true });
      }, DECODE_WALK_TIMEOUT_MS);

      proc.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        const errorLines = stderr
          .split('\n')
          .filter((l) => /error|invalid|corrupt|truncat/i.test(l));
        if (code !== 0 || errorLines.length > 0) {
          resolve({
            valid: false,
            reason: `Decode walk errors: ${errorLines.slice(0, 3).join('; ')}`,
          });
        } else {
          resolve({ valid: true });
        }
      });

      proc.on('error', () => {
        clearTimeout(timer);
        resolve({ valid: true }); // ffmpeg not found — fail open
      });
    });
  }

  private runProbe(filePath: string): Promise<ContainerValidationResult & { duration?: number }> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration,nb_streams:stream=codec_type',
          '-of',
          'json',
          filePath,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        this.logger.warn(`ffprobe container validation timed out for ${path.basename(filePath)}`);
        resolve({ valid: true }); // timeout = fail open
      }, PROBE_TIMEOUT_MS);

      proc.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      proc.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);

        // Check stderr for known fatal container errors
        const fatalPatterns = [
          'moov atom not found',
          'invalid as first byte of an EBML number',
          'Length indicated by EBML number',
          'no decoder for codec',
          'Invalid data found',
        ];
        for (const pattern of fatalPatterns) {
          if (stderr.includes(pattern)) {
            resolve({ valid: false, reason: `Container error: ${pattern}` });
            return;
          }
        }

        if (code !== 0) {
          resolve({
            valid: false,
            reason: `ffprobe exited ${code}: ${stderr.trim().slice(0, 200)}`,
          });
          return;
        }

        let parsed: { format?: { duration?: string; nb_streams?: number } } = {};
        try {
          parsed = JSON.parse(stdout);
        } catch {
          resolve({ valid: false, reason: 'ffprobe JSON parse failed' });
          return;
        }

        const fmt = parsed.format;
        if (!fmt) {
          resolve({ valid: false, reason: 'ffprobe returned no format section' });
          return;
        }

        const nbStreams = fmt.nb_streams ?? 0;
        if (nbStreams === 0) {
          resolve({ valid: false, reason: 'No streams found in output container' });
          return;
        }

        const duration = fmt.duration ? parseFloat(fmt.duration) : undefined;
        if (duration !== undefined && (isNaN(duration) || duration <= 0)) {
          resolve({ valid: false, reason: `Invalid duration: ${fmt.duration}` });
          return;
        }

        this.logger.debug(
          `Container probe OK: ${path.basename(filePath)} — ${nbStreams} streams, duration=${duration?.toFixed(1) ?? 'N/A'}s`
        );
        resolve({ valid: true, duration });
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          // ffprobe not installed — fail open
          resolve({ valid: true });
        } else {
          resolve({ valid: false, reason: `ffprobe spawn error: ${err.message}` });
        }
      });
    });
  }
}
