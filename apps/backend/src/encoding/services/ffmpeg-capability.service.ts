import { spawn } from 'node:child_process';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

const PROBE_TIMEOUT_MS = 10_000;

/**
 * FfmpegCapabilityService
 *
 * Probes `ffmpeg -encoders` once at startup and caches the set of encoder
 * names the installed ffmpeg build actually supports. HardwareAccelerationService
 * uses this to skip selecting a hardware encoder (e.g. av1_qsv) that the codec
 * map assumes exists but this build doesn't ship, avoiding a wasted encode
 * attempt that would fail with "Unknown encoder".
 */
@Injectable()
export class FfmpegCapabilityService implements OnModuleInit {
  private readonly logger = new Logger(FfmpegCapabilityService.name);
  private encoders: Set<string> | null = null;

  async onModuleInit(): Promise<void> {
    this.encoders = await this.probeEncoders();
    if (this.encoders) {
      this.logger.log(`FFmpeg build reports ${this.encoders.size} encoder(s)`);
    } else {
      this.logger.warn(
        'Could not probe ffmpeg encoders (spawn failed or timed out) - capability gate is fail-open until the next probe'
      );
    }
  }

  /**
   * True when `name` is known to exist in this ffmpeg build. Fails open
   * (returns true) when the probe hasn't completed or failed, so a tooling
   * hiccup never blocks an encode that might otherwise succeed - the encode
   * itself is the ultimate check.
   */
  hasEncoder(name: string): boolean {
    if (!this.encoders) return true;
    return this.encoders.has(name);
  }

  /** Re-run the probe, e.g. after the ffmpeg binary changes underneath the process. */
  async refresh(): Promise<void> {
    this.encoders = await this.probeEncoders();
  }

  private probeEncoders(): Promise<Set<string> | null> {
    return new Promise((resolve) => {
      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn('ffmpeg', ['-hide_banner', '-encoders'], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        resolve(null);
        return;
      }

      let stdout = '';
      let settled = false;
      const finish = (result: Set<string> | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        finish(null);
      }, PROBE_TIMEOUT_MS);

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.on('error', () => finish(null));

      proc.on('close', (code) => {
        if (code !== 0) {
          finish(null);
          return;
        }
        finish(this.parseEncoderList(stdout));
      });
    });
  }

  /**
   * Parse `ffmpeg -encoders` output. Rows follow the header/separator with
   * a 6-character capability flag column, then the encoder name:
   *   V..... libx265              libx265 H.265 / HEVC (codec hevc)
   */
  private parseEncoderList(output: string): Set<string> {
    const names = new Set<string>();
    let pastSeparator = false;
    for (const line of output.split('\n')) {
      if (!pastSeparator) {
        if (line.trim().startsWith('---')) {
          pastSeparator = true;
        }
        continue;
      }
      const match = line.match(/^\s*[A-Z.]{6}\s+(\S+)/);
      if (match) names.add(match[1]);
    }
    return names;
  }
}
