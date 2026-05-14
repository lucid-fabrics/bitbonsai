import { Injectable, Logger } from '@nestjs/common';
import type { Job } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const GPU_CODECS = new Set(['hevc_nvenc', 'h264_nvenc', 'hevc_vaapi', 'h264_vaapi', 'av1_nvenc']);

const GPU_ERROR_KEYWORDS = [
  'nvenc',
  'vaapi',
  'cuda',
  'nvcuvid',
  'hwaccel',
  'hw_frames_ctx',
  'no capable devices found',
  'device open failed',
  'cannot load nvcuda.dll',
  'error initializing output stream',
  'encoder not supported',
  'failed querying',
  'vk_physical_device',
];

const CPU_FALLBACK_MAP: Record<string, string> = {
  hevc_nvenc: 'libx265',
  h264_nvenc: 'libx264',
  hevc_vaapi: 'libx265',
  h264_vaapi: 'libx264',
  av1_nvenc: 'libsvtav1',
};

@Injectable()
export class CodecFallbackService {
  private readonly logger = new Logger(CodecFallbackService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Determine whether a GPU→CPU fallback should be triggered for a failed job.
   *
   * Returns true when ALL of the following hold:
   * 1. The job's targetCodec is a GPU-accelerated codec
   * 2. The error message contains GPU-related keywords
   *
   * The previous `gpuAttempts >= 1` branch was removed: it caused non-GPU errors
   * (e.g. disk-full on a second attempt) to incorrectly trigger a CPU fallback.
   */
  shouldFallback(job: Job, errorMessage: string): boolean {
    // If a CPU fallback is already active, never re-trigger the fallback loop
    if (job.codecOverride) {
      return false;
    }

    if (!GPU_CODECS.has(job.targetCodec)) {
      return false;
    }

    const errorLower = errorMessage.toLowerCase();
    const hasGpuError = GPU_ERROR_KEYWORDS.some((kw) => errorLower.includes(kw));

    return hasGpuError;
  }

  /**
   * Increment gpuAttempts and set codecOverride to the CPU equivalent so the
   * next queue pick-up uses a software encoder.
   */
  async applyFallback(jobId: string, targetCodec: string): Promise<void> {
    const cpuCodec = CPU_FALLBACK_MAP[targetCodec];
    if (!cpuCodec) {
      this.logger.warn(`No CPU fallback mapping for codec "${targetCodec}" — skipping fallback`);
      return;
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        gpuAttempts: { increment: 1 },
        codecOverride: cpuCodec,
      },
      select: { gpuAttempts: true },
    });

    this.logger.log(
      `GPU encoding failed after ${updated.gpuAttempts} attempt(s), falling back to ${cpuCodec}`
    );
  }

  /**
   * Clear the codecOverride field after a successful encode so subsequent jobs
   * are not forced onto a CPU codec indefinitely.
   */
  async clearFallback(jobId: string): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: { codecOverride: null },
    });
  }
}
