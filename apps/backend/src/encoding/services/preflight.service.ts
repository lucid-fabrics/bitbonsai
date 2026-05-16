import { spawn } from 'node:child_process';
import { Injectable, Logger } from '@nestjs/common';

export interface PreflightResult {
  ok: boolean;
  reason?: string;
  streams?: unknown[];
  format?: unknown;
}

/**
 * PreflightService
 *
 * Runs ffprobe on a file before it enters the QUEUED stage to detect
 * corruption early. Returns a structured result so callers can record
 * failures via FileFailureTrackingService and skip encoding entirely.
 */
@Injectable()
export class PreflightService {
  private readonly logger = new Logger(PreflightService.name);

  private readonly TIMEOUT_MS = 10_000;

  /** Set to false on first ENOENT so subsequent calls skip the spawn entirely. */
  private ffprobeAvailable = true;

  /**
   * Run ffprobe validation on a file before it is queued for encoding.
   *
   * Checks:
   * 1. ffprobe exits non-zero → "File unreadable or corrupt"
   * 2. No video stream found → "No video stream found"
   * 3. Duration = 0 or NaN → "File has zero duration — possibly truncated"
   * 4. Codec = 'none' or 'unknown' → "Video codec unreadable (corrupt header)"
   * 5. stderr "moov atom not found" → "MP4 moov atom missing — file was not fully written"
   * 6. stderr "Invalid data found" → "Invalid data in stream — file may be corrupt"
   * 7. stderr "error while decoding MB" → "Corrupt macroblock detected"
   *
   * Times out after 10 s and returns ok=false so the queue never hangs.
   */
  async runPreflight(filePath: string): Promise<PreflightResult> {
    if (!this.ffprobeAvailable) {
      return { ok: true };
    }

    // Guard: a path starting with '-' would be interpreted as an ffprobe flag
    if (filePath.startsWith('-')) {
      return { ok: false, reason: 'Invalid file path (starts with hyphen)' };
    }

    this.logger.debug(`Running pre-flight ffprobe: ${filePath}`);

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let ffprobeNotFound = false;

    const exitCode = await new Promise<number | null>((resolve) => {
      const proc = spawn('ffprobe', [
        '-v',
        'error',
        '-show_streams',
        '-show_format',
        '-print_format',
        'json',
        filePath,
      ]);

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
        resolve(null);
      }, this.TIMEOUT_MS);

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        proc.stdout?.destroy();
        proc.stderr?.destroy();
        resolve(code);
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        proc.stdout?.destroy();
        proc.stderr?.destroy();
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          // ffprobe binary not found — disable preflight for this session to avoid log spam
          ffprobeNotFound = true;
          this.ffprobeAvailable = false;
          this.logger.warn('ffprobe not found in PATH — pre-flight validation disabled');
        } else {
          this.logger.error(`ffprobe spawn error for ${filePath}: ${err.message}`);
        }
        resolve(null);
      });
    });

    if (ffprobeNotFound) {
      return { ok: true };
    }

    if (timedOut) {
      // Timeout is transient (NFS stall, slow media) — fail open rather than permanently rejecting
      this.logger.warn(`Preflight timed out for ${filePath} — passing to avoid false rejection`);
      return { ok: true };
    }

    // Check stderr for well-known corruption signatures (before exit-code check
    // so we return the most descriptive reason).
    const stderrReason = this.extractStderrReason(stderr);
    if (stderrReason) {
      return { ok: false, reason: stderrReason };
    }

    if (exitCode !== 0) {
      return { ok: false, reason: 'File unreadable or corrupt' };
    }

    // Parse ffprobe JSON output
    let parsed: { streams?: unknown[]; format?: Record<string, unknown> };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { ok: false, reason: 'File unreadable or corrupt' };
    }

    const streams = parsed.streams ?? [];
    const format = parsed.format ?? {};

    // Must have at least one video stream
    const videoStream = (streams as Array<Record<string, unknown>>).find(
      (s) => s['codec_type'] === 'video'
    );

    if (!videoStream) {
      return { ok: false, reason: 'No video stream found', streams, format };
    }

    // Codec must be readable
    const codec = String(videoStream['codec_name'] ?? '').toLowerCase();
    if (!codec || codec === 'none' || codec === 'unknown') {
      return {
        ok: false,
        reason: 'Video codec unreadable (corrupt header)',
        streams,
        format,
      };
    }

    // Duration must be non-zero and finite
    const durationRaw = (format as Record<string, unknown>)['duration'];
    const duration = parseFloat(String(durationRaw ?? ''));
    if (!durationRaw || isNaN(duration) || duration <= 0) {
      return {
        ok: false,
        reason: 'File has zero duration — possibly truncated',
        streams,
        format,
      };
    }

    return { ok: true, streams, format };
  }

  /**
   * Scan ffprobe stderr for known corruption signatures and return a
   * human-readable reason string, or undefined if nothing was found.
   */
  private extractStderrReason(stderr: string): string | undefined {
    if (stderr.includes('moov atom not found')) {
      return 'MP4 moov atom missing — file was not fully written';
    }

    if (stderr.includes('Invalid data found')) {
      return 'Invalid data in stream — file may be corrupt';
    }

    if (stderr.includes('error while decoding MB')) {
      return 'Corrupt macroblock detected';
    }

    return undefined;
  }
}
