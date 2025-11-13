import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as os from 'os';
import {
  AccelerationType,
  CPUInfo,
  GPUInfo,
  GPUVendor,
  HardwareCapabilitiesDto,
  MemoryInfo,
} from './dto/hardware-capabilities.dto';

/**
 * HardwareDetectionService
 *
 * Detects GPU acceleration capabilities, CPU info, and memory info.
 * Results are cached for 5 minutes to avoid repeated detection overhead.
 *
 * Detection priority:
 * 1. NVIDIA (CUDA/NVENC) - nvidia-smi
 * 2. Intel Quick Sync - /dev/dri/renderD* and vainfo
 * 3. AMD (AMF) - lspci | grep VGA
 * 4. Apple Silicon (VideoToolbox) - M1/M2/M3/M4
 * 5. CPU-only fallback
 */
@Injectable()
export class HardwareDetectionService {
  private readonly logger = new Logger(HardwareDetectionService.name);
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private cachedResult: HardwareCapabilitiesDto | null = null;
  private cacheTimestamp = 0;

  /**
   * Detect all hardware capabilities
   * Results are cached for 5 minutes
   */
  async detectHardware(): Promise<HardwareCapabilitiesDto> {
    // Return cached result if still valid
    const now = Date.now();
    if (this.cachedResult && now - this.cacheTimestamp < this.CACHE_TTL_MS) {
      this.logger.debug('Returning cached hardware detection results');
      return this.cachedResult;
    }

    this.logger.log('🔍 Detecting hardware capabilities...');

    try {
      const [gpus, cpu, memory] = await Promise.all([
        this.detectGPUs(),
        this.detectCPU(),
        this.detectMemory(),
      ]);

      const accelerationType = this.determineAccelerationType(gpus);

      const result: HardwareCapabilitiesDto = {
        gpus,
        cpu,
        memory,
        platform: process.platform,
        accelerationType,
      };

      // Cache the result
      this.cachedResult = result;
      this.cacheTimestamp = now;

      this.logger.log(`✅ Hardware detection complete - Acceleration: ${accelerationType}`);
      return result;
    } catch (error) {
      this.logger.error('Failed to detect hardware:', error);
      throw error;
    }
  }

  /**
   * Clear hardware detection cache
   */
  clearCache(): void {
    this.cachedResult = null;
    this.cacheTimestamp = 0;
    this.logger.log('🗑️  Hardware detection cache cleared');
  }

  /**
   * Detect all GPUs on the system
   */
  private async detectGPUs(): Promise<GPUInfo[]> {
    const gpus: GPUInfo[] = [];

    try {
      // Try NVIDIA first (highest priority)
      const nvidiaGPU = await this.detectNvidiaGPU();
      if (nvidiaGPU) {
        gpus.push(nvidiaGPU);
      }

      // Try Intel Quick Sync
      const intelGPU = await this.detectIntelGPU();
      if (intelGPU) {
        gpus.push(intelGPU);
      }

      // Try AMD
      const amdGPU = await this.detectAMDGPU();
      if (amdGPU) {
        gpus.push(amdGPU);
      }

      // Try Apple Silicon
      const appleGPU = await this.detectAppleGPU();
      if (appleGPU) {
        gpus.push(appleGPU);
      }

      if (gpus.length === 0) {
        this.logger.warn('No GPU acceleration detected - falling back to CPU-only');
      }
    } catch (error) {
      this.logger.error('Error during GPU detection:', error);
    }

    return gpus;
  }

  /**
   * Detect NVIDIA GPU using nvidia-smi
   */
  private async detectNvidiaGPU(): Promise<GPUInfo | null> {
    try {
      const output = await this.executeCommand('nvidia-smi', [
        '--query-gpu=name,memory.total,driver_version',
        '--format=csv,noheader',
      ]);

      if (output) {
        const [model, memoryStr, driverVersion] = output.split(',').map((s) => s.trim());
        const memory = parseInt(memoryStr.replace(/\D/g, ''), 10); // Extract number from "24576 MiB"

        this.logger.log(`   ✓ NVIDIA GPU detected: ${model}`);

        return {
          vendor: GPUVendor.NVIDIA,
          model,
          memory,
          driverVersion,
        };
      }
    } catch (_error) {
      this.logger.debug('NVIDIA GPU not detected');
    }

    return null;
  }

  /**
   * Detect Intel Quick Sync
   */
  private async detectIntelGPU(): Promise<GPUInfo | null> {
    try {
      // Check for /dev/dri/renderD* on Linux
      if (process.platform === 'linux') {
        const lsOutput = await this.executeCommand('ls', ['/dev/dri/']);
        if (lsOutput?.includes('renderD')) {
          // Try to get more info from vainfo
          try {
            const vainfo = await this.executeCommand('vainfo', []);
            if (vainfo?.toLowerCase().includes('intel')) {
              // Extract driver version from vainfo output
              const driverMatch = vainfo.match(/Driver version: (.+)/);
              const driverVersion = driverMatch ? driverMatch[1].trim() : 'unknown';

              this.logger.log('   ✓ Intel Quick Sync detected');

              return {
                vendor: GPUVendor.INTEL,
                model: 'Intel Quick Sync',
                memory: 0, // Shared memory
                driverVersion,
              };
            }
          } catch {
            // vainfo not available, but renderD exists
            this.logger.log('   ✓ Intel Quick Sync detected (vainfo unavailable)');
            return {
              vendor: GPUVendor.INTEL,
              model: 'Intel Quick Sync',
              memory: 0,
              driverVersion: 'unknown',
            };
          }
        }
      }
    } catch (_error) {
      this.logger.debug('Intel Quick Sync not detected');
    }

    return null;
  }

  /**
   * Detect AMD GPU using lspci
   */
  private async detectAMDGPU(): Promise<GPUInfo | null> {
    try {
      if (process.platform === 'linux') {
        const output = await this.executeCommand('lspci', []);
        if (output) {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.toLowerCase().includes('vga') && line.toLowerCase().includes('amd')) {
              // Extract GPU model name
              const modelMatch = line.match(/:\s*(.+?)(?:\(|$)/);
              const model = modelMatch ? modelMatch[1].trim() : 'AMD GPU';

              this.logger.log(`   ✓ AMD GPU detected: ${model}`);

              return {
                vendor: GPUVendor.AMD,
                model,
                memory: 0, // Cannot easily detect without additional tools
                driverVersion: 'unknown',
              };
            }
          }
        }
      }
    } catch (_error) {
      this.logger.debug('AMD GPU not detected');
    }

    return null;
  }

  /**
   * Detect Apple Silicon GPU (M1/M2/M3/M4)
   */
  private async detectAppleGPU(): Promise<GPUInfo | null> {
    try {
      if (process.platform === 'darwin') {
        const cpuInfo = os.cpus()[0];
        if (cpuInfo) {
          const model = cpuInfo.model;
          // Check if it's Apple Silicon (M1/M2/M3/M4)
          if (model.toLowerCase().includes('apple')) {
            this.logger.log(`   ✓ Apple Silicon detected: ${model}`);

            return {
              vendor: GPUVendor.APPLE,
              model: `${model} (VideoToolbox)`,
              memory: 0, // Unified memory
              driverVersion: os.release(),
            };
          }
        }
      }
    } catch (_error) {
      this.logger.debug('Apple Silicon not detected');
    }

    return null;
  }

  /**
   * Detect CPU information
   */
  private async detectCPU(): Promise<CPUInfo> {
    const cpus = os.cpus();
    const model = cpus[0]?.model || 'Unknown';
    const cores = cpus.length;
    const speed = cpus[0]?.speed || 0;

    return {
      model,
      cores,
      speed,
    };
  }

  /**
   * Detect memory information
   */
  private async detectMemory(): Promise<MemoryInfo> {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;

    // Convert to MB
    const total = Math.floor(totalBytes / (1024 * 1024));
    const free = Math.floor(freeBytes / (1024 * 1024));
    const used = Math.floor(usedBytes / (1024 * 1024));

    return {
      total,
      free,
      used,
    };
  }

  /**
   * Determine primary acceleration type
   * Priority: NVIDIA > Intel QSV > AMD > Apple > CPU-only
   */
  private determineAccelerationType(gpus: GPUInfo[]): AccelerationType {
    if (gpus.length === 0) {
      return AccelerationType.CPU;
    }

    // Check for NVIDIA first (highest priority)
    if (gpus.some((gpu) => gpu.vendor === GPUVendor.NVIDIA)) {
      return AccelerationType.NVIDIA;
    }

    // Check for Intel Quick Sync
    if (gpus.some((gpu) => gpu.vendor === GPUVendor.INTEL)) {
      return AccelerationType.INTEL;
    }

    // Check for AMD
    if (gpus.some((gpu) => gpu.vendor === GPUVendor.AMD)) {
      return AccelerationType.AMD;
    }

    // Check for Apple Silicon
    if (gpus.some((gpu) => gpu.vendor === GPUVendor.APPLE)) {
      return AccelerationType.APPLE;
    }

    return AccelerationType.CPU;
  }

  /**
   * Execute a command and return stdout
   * Returns null if command fails or is not found
   */
  private executeCommand(command: string, args: string[] = []): Promise<string | null> {
    return new Promise((resolve) => {
      const child = spawn(command, args);
      let stdout = '';
      let _stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        _stderr += data.toString();
      });

      child.on('error', (error) => {
        // Command not found or execution error
        this.logger.debug(`Command '${command}' failed: ${error.message}`);
        resolve(null);
      });

      child.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          resolve(null);
        }
      });

      // Set timeout to prevent hanging
      setTimeout(() => {
        child.kill();
        resolve(null);
      }, 5000); // 5 second timeout
    });
  }
}
