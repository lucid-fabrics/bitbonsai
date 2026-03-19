import { spawn } from 'node:child_process';
import { Injectable, Logger } from '@nestjs/common';

/**
 * FfprobeService
 *
 * Pure, stateless service for all ffprobe operations:
 * - Video duration extraction (stream + format fallback)
 * - Codec/container detection with TTL cache
 * - File integrity verification
 */
@Injectable()
export class FfprobeService {
  private readonly logger = new Logger(FfprobeService.name);

  // PERFORMANCE: FFprobe result caching (filePath -> video info)
  private readonly codecCache = new Map<
    string,
    { codec: string; container: string; timestamp: Date }
  >();
  private readonly CODEC_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  private readonly CODEC_CACHE_MAX_SIZE = 5000;
  private readonly CODEC_CACHE_CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  private lastCacheCleanup = 0;

  /**
   * Get video duration using stream duration (more accurate for VFR videos).
   * Falls back to format/container duration, then 3600s if both fail.
   *
   * @param filePath - Path to video file
   * @returns Duration in seconds, or 3600 if unable to determine
   */
  async getVideoDuration(filePath: string): Promise<number> {
    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);

      let output = '';

      ffprobe.stdout?.on('data', (data) => {
        output += data.toString();
      });

      const timeoutId = setTimeout(() => {
        ffprobe.kill();
        this.logger.warn(`[${filePath}] FFprobe timeout, using fallback 3600s`);
        resolve(3600);
      }, 10000);

      ffprobe.on('close', (code) => {
        clearTimeout(timeoutId);
        ffprobe.stdout?.destroy();
        ffprobe.stderr?.destroy();

        if (code === 0 && output.trim()) {
          try {
            const duration = Number.parseFloat(output.trim());
            if (!Number.isNaN(duration) && duration > 0) {
              this.logger.debug(
                `[${filePath}] FFprobe detected stream duration: ${duration.toFixed(2)}s`
              );
              resolve(duration);
              return;
            }
          } catch {
            // Fall through to format duration fallback
          }
        }

        this.logger.debug(
          `[${filePath}] Stream duration not available (code: ${code}), trying format duration`
        );
        this.getFormatDuration(filePath).then(resolve);
      });

      ffprobe.on('error', (err) => {
        clearTimeout(timeoutId);
        ffprobe.stdout?.destroy();
        ffprobe.stderr?.destroy();
        this.logger.warn(`[${filePath}] FFprobe error: ${err.message}, using fallback 3600s`);
        resolve(3600);
      });
    });
  }

  /**
   * Get format/container duration as fallback when stream duration unavailable.
   * Some containers (MKV, certain MP4) only store duration at the container level.
   *
   * @param filePath - Path to video file
   * @returns Duration in seconds, or 3600 if unable to determine
   */
  private async getFormatDuration(filePath: string): Promise<number> {
    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);

      let output = '';

      ffprobe.stdout?.on('data', (data) => {
        output += data.toString();
      });

      const timeoutId = setTimeout(() => {
        ffprobe.kill();
        this.logger.warn(`[${filePath}] FFprobe format duration timeout, using fallback 3600s`);
        resolve(3600);
      }, 10000);

      ffprobe.on('close', (code) => {
        clearTimeout(timeoutId);
        ffprobe.stdout?.destroy();
        ffprobe.stderr?.destroy();

        if (code === 0 && output.trim()) {
          try {
            const duration = Number.parseFloat(output.trim());
            if (!Number.isNaN(duration) && duration > 0) {
              this.logger.debug(
                `[${filePath}] FFprobe detected format duration: ${duration.toFixed(2)}s`
              );
              resolve(duration);
              return;
            }
          } catch {
            // Fall through to default
          }
        }

        this.logger.warn(
          `[${filePath}] Failed to get format duration from ffprobe (code: ${code}), using fallback 3600s`
        );
        resolve(3600);
      });

      ffprobe.on('error', (err) => {
        clearTimeout(timeoutId);
        ffprobe.stdout?.destroy();
        ffprobe.stderr?.destroy();
        this.logger.warn(
          `[${filePath}] FFprobe format duration error: ${err.message}, using fallback 3600s`
        );
        resolve(3600);
      });
    });
  }

  /**
   * Get video codec and container information using ffprobe.
   *
   * @param filePath - Path to video file
   * @returns Object with codec name and container format
   */
  async getVideoInfo(filePath: string): Promise<{ codec: string; container: string }> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name:format=format_name',
        '-of',
        'json',
        filePath,
      ]);

      let output = '';

      ffprobe.stdout?.on('data', (data) => {
        output += data.toString();
      });

      const timeoutId = setTimeout(() => {
        ffprobe.kill();
        reject(new Error('FFprobe timeout'));
      }, 10000);

      ffprobe.on('close', (code) => {
        clearTimeout(timeoutId);
        ffprobe.stdout?.destroy();
        ffprobe.stderr?.destroy();

        if (code === 0 && output.trim()) {
          try {
            const data = JSON.parse(output);
            const codec = data.streams?.[0]?.codec_name || 'unknown';
            const container = data.format?.format_name?.split(',')[0] || 'unknown';

            resolve({ codec, container });
            return;
          } catch {
            reject(new Error('Failed to parse ffprobe output'));
          }
        }

        reject(new Error(`FFprobe failed with code ${code}`));
      });

      ffprobe.on('error', (err) => {
        clearTimeout(timeoutId);
        ffprobe.stdout?.destroy();
        ffprobe.stderr?.destroy();
        reject(err);
      });
    });
  }

  /**
   * Get video info with caching (1-hour TTL).
   * Reduces repeated FFprobe calls for the same file.
   *
   * @param filePath - Path to video file
   * @returns Object with codec name and container format
   */
  async getVideoInfoCached(filePath: string): Promise<{ codec: string; container: string }> {
    const cached = this.codecCache.get(filePath);
    if (cached) {
      const age = Date.now() - cached.timestamp.getTime();
      if (age < this.CODEC_CACHE_TTL_MS) {
        this.logger.debug(`[CACHE HIT] Using cached codec info for: ${filePath}`);
        return { codec: cached.codec, container: cached.container };
      }
      this.codecCache.delete(filePath);
    }

    this.logger.debug(`[CACHE MISS] Fetching codec info via FFprobe: ${filePath}`);
    const result = await this.getVideoInfo(filePath);

    // Enforce max cache size with LRU eviction (remove oldest entry)
    if (this.codecCache.size >= this.CODEC_CACHE_MAX_SIZE) {
      const oldestKey = this.codecCache.keys().next().value;
      if (oldestKey) {
        this.codecCache.delete(oldestKey);
        this.logger.debug(`Cache full - evicted oldest entry: ${oldestKey}`);
      }
    }

    this.codecCache.set(filePath, {
      codec: result.codec,
      container: result.container,
      timestamp: new Date(),
    });

    // Periodic cleanup (only every 15 minutes instead of per-write)
    const now = Date.now();
    if (now - this.lastCacheCleanup > this.CODEC_CACHE_CLEANUP_INTERVAL_MS) {
      this.cleanupCodecCache();
      this.lastCacheCleanup = now;
    }

    return result;
  }

  /**
   * Verify that an encoded file is valid and playable using ffprobe.
   *
   * @param filePath - Path to file to verify
   * @returns Object with isValid flag and optional error details
   */
  async verifyFile(filePath: string): Promise<{ isValid: boolean; error?: string }> {
    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);

      let output = '';
      let stderrOutput = '';

      ffprobe.stdout?.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.stderr?.on('data', (data) => {
        stderrOutput += data.toString();
      });

      // Increased timeout from 30s to 60s for large NFS files
      const VERIFY_TIMEOUT_MS = 60000;
      const timeoutId = setTimeout(() => {
        ffprobe.kill('SIGKILL');
        resolve({
          isValid: false,
          error: `File verification timed out after ${VERIFY_TIMEOUT_MS / 1000} seconds`,
        });
      }, VERIFY_TIMEOUT_MS);

      ffprobe.on('close', (code) => {
        clearTimeout(timeoutId);
        ffprobe.stdout?.destroy();
        ffprobe.stderr?.destroy();

        if (code !== 0 || !output.trim()) {
          let errorMessage = `File verification failed (exit code ${code})`;

          if (stderrOutput.trim()) {
            errorMessage += `\n\nffprobe error output:\n${stderrOutput.trim()}`;
          } else {
            errorMessage += '\n\nNo duration metadata found - file may be corrupted or incomplete';
          }

          resolve({ isValid: false, error: errorMessage });
        } else {
          resolve({ isValid: true });
        }
      });

      ffprobe.on('error', (err) => {
        clearTimeout(timeoutId);
        ffprobe.stdout?.destroy();
        ffprobe.stderr?.destroy();
        resolve({
          isValid: false,
          error: `Failed to run ffprobe: ${err.message}`,
        });
      });
    });
  }

  /**
   * Cleanup stale codec cache entries (TTL + max size enforcement).
   */
  cleanupCodecCache(): void {
    const now = Date.now();
    let removed = 0;

    for (const [filePath, entry] of this.codecCache.entries()) {
      if (now - entry.timestamp.getTime() > this.CODEC_CACHE_TTL_MS) {
        this.codecCache.delete(filePath);
        removed++;
      }
    }

    if (this.codecCache.size > this.CODEC_CACHE_MAX_SIZE) {
      const entries = Array.from(this.codecCache.entries());
      entries.sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());

      const toRemove = this.codecCache.size - this.CODEC_CACHE_MAX_SIZE;
      for (let i = 0; i < toRemove; i++) {
        this.codecCache.delete(entries[i][0]);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug(
        `Cleaned ${removed} codec cache entries (size: ${this.codecCache.size}/${this.CODEC_CACHE_MAX_SIZE})`
      );
    }
  }

  /**
   * Clear codec cache (called on module destroy).
   */
  clearCache(): void {
    this.codecCache.clear();
  }
}
