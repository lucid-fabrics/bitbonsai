import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import type { AccelerationType } from '@prisma/client';

/**
 * Hardware acceleration configuration for different platforms
 */
export interface HardwareAccelConfig {
  type: AccelerationType;
  flags: string[];
  videoCodec: string;
}

/**
 * HardwareAccelerationService
 *
 * Detects available GPU/hardware encoder capabilities and maps
 * policy codec preferences to hardware-accelerated FFmpeg codec names.
 *
 * Detection order:
 * 1. NVIDIA GPU (nvidia-smi)
 * 2. Intel QSV (/dev/dri/renderD128)
 * 3. AMD GPU (VAAPI via /dev/dri/renderD129)
 * 4. Apple M (macOS VideoToolbox)
 * 5. CPU (fallback)
 */
@Injectable()
export class HardwareAccelerationService {
  private readonly logger = new Logger(HardwareAccelerationService.name);

  /**
   * Detect available hardware acceleration.
   *
   * @returns Hardware acceleration configuration
   */
  async detectHardwareAcceleration(): Promise<HardwareAccelConfig> {
    this.logger.log('Detecting hardware acceleration capabilities...');

    // Check NVIDIA GPU
    try {
      const nvidiaSmi = spawn('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']);

      const timeoutId = setTimeout(() => {
        nvidiaSmi.kill('SIGKILL');
      }, 5000);

      const nvidiaAvailable = await new Promise<boolean>((resolve) => {
        nvidiaSmi.on('error', () => {
          clearTimeout(timeoutId);
          nvidiaSmi.stdout?.destroy();
          nvidiaSmi.stderr?.destroy();
          resolve(false);
        });
        nvidiaSmi.on('close', (code) => {
          clearTimeout(timeoutId);
          nvidiaSmi.stdout?.destroy();
          nvidiaSmi.stderr?.destroy();
          resolve(code === 0);
        });
      });

      if (nvidiaAvailable) {
        this.logger.log('NVIDIA GPU detected - using NVENC acceleration');
        return {
          type: 'NVIDIA',
          flags: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
          videoCodec: 'hevc_nvenc',
        };
      }
    } catch {
      // NVIDIA not available
    }

    // Check Intel QSV
    if (existsSync('/dev/dri/renderD128')) {
      this.logger.log('Intel QSV detected - using Quick Sync Video acceleration');
      return {
        type: 'INTEL_QSV',
        flags: ['-hwaccel', 'qsv', '-c:v', 'h264_qsv'],
        videoCodec: 'hevc_qsv',
      };
    }

    // Check AMD VAAPI
    if (existsSync('/dev/dri/renderD129')) {
      this.logger.log('AMD GPU detected - using VAAPI acceleration');
      return {
        type: 'AMD',
        flags: ['-hwaccel', 'vaapi', '-vaapi_device', '/dev/dri/renderD128'],
        videoCodec: 'hevc_vaapi',
      };
    }

    // Check Apple M (macOS)
    if (process.platform === 'darwin') {
      this.logger.log('macOS detected - using VideoToolbox acceleration');
      return {
        type: 'APPLE_M',
        flags: ['-hwaccel', 'videotoolbox'],
        videoCodec: 'hevc_videotoolbox',
      };
    }

    // Fallback to CPU
    this.logger.log('No hardware acceleration detected - using CPU encoding');
    return {
      type: 'CPU',
      flags: [],
      videoCodec: 'libx265',
    };
  }

  /**
   * Maps policy codec preferences (HEVC, AV1, VP9, H264) to hardware-accelerated
   * variants when available, falling back to software encoding if needed.
   *
   * @param targetCodec - Target codec from encoding policy (HEVC, AV1, VP9, H264)
   * @param hwType - Hardware acceleration type (NVIDIA, INTEL_QSV, AMD, APPLE_M, CPU)
   * @returns FFmpeg codec name (e.g., hevc_nvenc, libx265, av1_nvenc, etc.)
   */
  selectCodecForPolicy(targetCodec: string, hwType: string): string {
    // Codec mapping: policy codec -> hardware type -> FFmpeg codec name
    const codecMap: Record<string, Record<string, string>> = {
      HEVC: {
        NVIDIA: 'hevc_nvenc',
        INTEL_QSV: 'hevc_qsv',
        AMD: 'hevc_vaapi',
        APPLE_M: 'hevc_videotoolbox',
        CPU: 'libx265',
      },
      AV1: {
        NVIDIA: 'av1_nvenc', // Available on RTX 40 series and newer
        INTEL_QSV: 'av1_qsv', // Available on Arc and 12th gen Intel
        AMD: 'av1_vaapi', // Limited hardware support
        APPLE_M: 'libaom-av1', // No native AV1 hardware encoder, use CPU
        CPU: 'libaom-av1',
      },
      VP9: {
        NVIDIA: 'libvpx-vp9', // No hardware support, use CPU
        INTEL_QSV: 'vp9_qsv', // Limited QSV support
        AMD: 'libvpx-vp9', // No hardware support, use CPU
        APPLE_M: 'libvpx-vp9', // No hardware support, use CPU
        CPU: 'libvpx-vp9',
      },
      H264: {
        NVIDIA: 'h264_nvenc',
        INTEL_QSV: 'h264_qsv',
        AMD: 'h264_vaapi',
        APPLE_M: 'h264_videotoolbox',
        CPU: 'libx264',
      },
    };

    // Get the codec for this combination, with fallbacks
    const selectedCodec =
      codecMap[targetCodec]?.[hwType] || codecMap[targetCodec]?.CPU || 'libx265';

    this.logger.log(
      `Codec selection: ${targetCodec} (policy) + ${hwType} (hardware) = ${selectedCodec}`
    );

    return selectedCodec;
  }
}
