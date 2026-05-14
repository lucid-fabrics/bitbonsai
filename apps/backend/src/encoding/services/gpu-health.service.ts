import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { Injectable, Logger } from '@nestjs/common';

const NVDIA_SMI_TIMEOUT_MS = 5_000;
const GPU_COOLDOWN_MS = 60_000;
const VAAPI_DEVICE = '/dev/dri/renderD128';

/**
 * GpuHealthService
 *
 * Pre-dispatch GPU health probe. Prevents hammering a crashed GPU with
 * back-to-back jobs by enforcing a 60-second cooldown after a recorded failure.
 *
 * Detection order:
 * 1. nvidia-smi — NVIDIA GPU (NVENC)
 * 2. /dev/dri/renderD128 — VAAPI/Intel/AMD GPU
 * 3. Neither found — CPU-only node, always healthy
 */
@Injectable()
export class GpuHealthService {
  private readonly logger = new Logger(GpuHealthService.name);

  private gpuCooldownUntil = 0;

  /**
   * Returns false only when:
   * - A cooldown is active (GPU recently failed), OR
   * - nvidia-smi returns a non-zero exit code on an NVIDIA node
   *
   * Returns true when:
   * - VAAPI device is accessible (no deep probe — assume healthy), OR
   * - No GPU hardware detected at all (CPU encode always healthy)
   */
  async isGpuHealthy(): Promise<boolean> {
    if (Date.now() < this.gpuCooldownUntil) {
      const remainingSec = Math.ceil((this.gpuCooldownUntil - Date.now()) / 1000);
      this.logger.warn(`GPU in cooldown — ${remainingSec}s remaining, deferring GPU job`);
      return false;
    }

    // 1. Try nvidia-smi
    const nvidiaResult = await this.probeNvidiaSmi();
    if (nvidiaResult === 'healthy') return true;
    if (nvidiaResult === 'unhealthy') return false;

    // 2. Try VAAPI device (nvidiaResult === 'not_found' — fall through)
    try {
      await access(VAAPI_DEVICE);
      this.logger.debug('VAAPI device accessible — GPU assumed healthy');
      return true;
    } catch {
      // Not accessible or not present — no GPU
    }

    // 3. CPU-only node — always healthy
    return true;
  }

  /**
   * Record a GPU failure and activate cooldown.
   * Called from encoding-processor when GPU encoding fails.
   */
  recordGpuFailure(reason: string): void {
    this.gpuCooldownUntil = Date.now() + GPU_COOLDOWN_MS;
    this.logger.warn(
      `GPU failure recorded: ${reason}. Cooldown active for ${GPU_COOLDOWN_MS / 1000}s`
    );
  }

  /**
   * Probe nvidia-smi with a 5-second timeout.
   *
   * @returns 'healthy' | 'unhealthy' | 'not_found'
   */
  private probeNvidiaSmi(): Promise<'healthy' | 'unhealthy' | 'not_found'> {
    return new Promise((resolve) => {
      let proc: ReturnType<typeof spawn>;

      try {
        proc = spawn('nvidia-smi', ['--query-gpu=pstate', '--format=csv,noheader,nounits'], {
          timeout: NVDIA_SMI_TIMEOUT_MS,
        });
      } catch {
        resolve('not_found');
        return;
      }

      let stdout = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
        this.logger.warn('nvidia-smi probe timed out');
        resolve('unhealthy');
      }, NVDIA_SMI_TIMEOUT_MS);

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          resolve('not_found');
        } else {
          this.logger.warn(`nvidia-smi probe error: ${err.message}`);
          resolve('unhealthy');
        }
      });

      proc.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (timedOut) return;

        if (code !== 0) {
          this.logger.warn(`nvidia-smi exited with code ${code}`);
          resolve('unhealthy');
          return;
        }

        // stdout contains pstate (P0-P15) when GPU is present and running
        if (stdout.trim().length > 0) {
          this.logger.debug(`nvidia-smi probe OK (pstate: ${stdout.trim()})`);
          resolve('healthy');
        } else {
          this.logger.warn('nvidia-smi returned empty output');
          resolve('unhealthy');
        }
      });
    });
  }
}
