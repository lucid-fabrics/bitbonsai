import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import type { AccelerationType } from '@prisma/client';
import { FfmpegCapabilityService } from './services/ffmpeg-capability.service';
import { GpuHealthService } from './services/gpu-health.service';

/**
 * Hardware acceleration configuration for different platforms
 *
 * `flags` are INPUT-side options (before -i). `videoFilter` is an OUTPUT-side
 * -vf fragment some encoders require (e.g. VAAPI's format=nv12,hwupload);
 * the flag builder merges it into the single output -vf.
 */
export interface HardwareAccelConfig {
  type: AccelerationType;
  flags: string[];
  videoCodec: string;
  videoFilter?: string;
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

  constructor(
    private readonly gpuHealth: GpuHealthService,
    private readonly ffmpegCapability: FfmpegCapabilityService
  ) {}

  /**
   * Detect available hardware acceleration.
   *
   * @returns Hardware acceleration configuration
   */
  async detectHardwareAcceleration(): Promise<HardwareAccelConfig> {
    this.logger.log('Detecting hardware acceleration capabilities...');

    // GPU COOLDOWN: after a recorded GPU failure, skip all GPU branches for
    // 60s instead of hammering a crashed GPU with back-to-back jobs.
    if (!(await this.gpuHealth.isGpuHealthy())) {
      this.logger.warn('GPU unhealthy or in cooldown - falling back to CPU encoding');
      return { type: 'CPU', flags: [], videoCodec: 'libx265' };
    }

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
        // NOTE: no input-side "-c:v h264_qsv" here - that forced every source
        // to decode as h264 regardless of its actual codec, and contradicted
        // the hevc_qsv output codec below.
        type: 'INTEL_QSV',
        flags: ['-hwaccel', 'qsv'],
        videoCodec: 'hevc_qsv',
      };
    }

    // Check AMD VAAPI
    const vaapiDevice = '/dev/dri/renderD129';
    if (existsSync(vaapiDevice)) {
      this.logger.log('AMD GPU detected - using VAAPI acceleration');
      return {
        type: 'AMD',
        // NOTE: -vaapi_device must match the render node we just detected
        // (was hardcoded to renderD128, the Intel QSV node checked above).
        flags: ['-hwaccel', 'vaapi', '-vaapi_device', vaapiDevice],
        videoCodec: 'hevc_vaapi',
        // Required by hevc_vaapi/av1_vaapi. This is an OUTPUT option (-vf), so
        // it cannot live in `flags`, which land before -i where ffmpeg rejects it.
        videoFilter: 'format=nv12,hwupload',
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
    const cpuCodec = codecMap[targetCodec]?.CPU || 'libx265';
    let selectedCodec = codecMap[targetCodec]?.[hwType] || cpuCodec;

    // CAPABILITY GATE: don't hand off a hardware encoder this ffmpeg build
    // doesn't actually ship (e.g. av1_qsv on an older build) - that would
    // fail immediately with "Unknown encoder". Fall back to the CPU codec,
    // which the trial-encode preflight will still validate before committing
    // to the full-length encode.
    if (!this.ffmpegCapability.hasEncoder(selectedCodec) && selectedCodec !== cpuCodec) {
      this.logger.warn(
        `Encoder '${selectedCodec}' not found in this ffmpeg build - falling back to '${cpuCodec}'`
      );
      selectedCodec = cpuCodec;
    }

    this.logger.log(
      `Codec selection: ${targetCodec} (policy) + ${hwType} (hardware) = ${selectedCodec}`
    );

    return selectedCodec;
  }
}
