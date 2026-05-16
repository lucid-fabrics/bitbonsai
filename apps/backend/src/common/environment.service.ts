import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import type {
  DefaultPathsDto,
  EnvironmentInfoDto,
  HardwareAccelerationDto,
  SystemInfoDto,
} from './dto/environment-info.dto';

const execAsync = promisify(exec);

@Injectable()
export class EnvironmentService {
  private readonly logger = new Logger(EnvironmentService.name);
  private cachedEnvironment: 'UNRAID' | 'DOCKER' | 'BARE_METAL' | null = null;
  private cachedHardwareInfo: {
    acceleration: HardwareAccelerationDto;
    systemInfo: SystemInfoDto;
  } | null = null;

  /**
   * Detect the runtime environment
   * @returns Environment type: UNRAID, DOCKER, or BARE_METAL
   */
  async detectEnvironment(): Promise<'UNRAID' | 'DOCKER' | 'BARE_METAL'> {
    if (this.cachedEnvironment) {
      return this.cachedEnvironment;
    }

    // Check Unraid first (Unraid runs Docker, so check this before Docker)
    if (await this.isUnraid()) {
      this.cachedEnvironment = 'UNRAID';
      this.logger.log('Environment detected: UNRAID');
      return 'UNRAID';
    }

    // Check Docker
    if (await this.isDocker()) {
      this.cachedEnvironment = 'DOCKER';
      this.logger.log('Environment detected: DOCKER');
      return 'DOCKER';
    }

    // Default to bare metal
    this.cachedEnvironment = 'BARE_METAL';
    this.logger.log('Environment detected: BARE_METAL');
    return 'BARE_METAL';
  }

  /**
   * Check if running on Unraid OS
   * @returns True if Unraid is detected
   */
  async isUnraid(): Promise<boolean> {
    try {
      // Check for Unraid version file
      if (fs.existsSync('/etc/unraid-version')) {
        return true;
      }

      // Additional check: Unraid-specific directories
      if (fs.existsSync('/boot/config') && fs.existsSync('/usr/local/emhttp')) {
        return true;
      }

      return false;
    } catch (error: unknown) {
      this.logger.debug('Unraid detection failed', error);
      return false;
    }
  }

  /**
   * Check if running in Docker container
   * @returns True if Docker environment is detected
   */
  async isDocker(): Promise<boolean> {
    try {
      // Method 1: Check for .dockerenv file
      if (fs.existsSync('/.dockerenv')) {
        return true;
      }

      // Method 2: Check /proc/1/cgroup for docker or containerd
      if (fs.existsSync('/proc/1/cgroup')) {
        const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
        if (
          cgroup.includes('docker') ||
          cgroup.includes('containerd') ||
          cgroup.includes('kubepods')
        ) {
          return true;
        }
      }

      // Method 3: Check /proc/self/mountinfo for docker
      if (fs.existsSync('/proc/self/mountinfo')) {
        const mountinfo = fs.readFileSync('/proc/self/mountinfo', 'utf8');
        if (mountinfo.includes('docker')) {
          return true;
        }
      }

      return false;
    } catch (error: unknown) {
      this.logger.debug('Docker detection failed', error);
      return false;
    }
  }

  /**
   * Get Unraid version if running on Unraid
   * @returns Unraid version string or undefined
   */
  async getUnraidVersion(): Promise<string | undefined> {
    try {
      if (!fs.existsSync('/etc/unraid-version')) {
        return undefined;
      }

      const version = fs.readFileSync('/etc/unraid-version', 'utf8').trim();
      return version.replace('version=', '').replace(/"/g, '');
    } catch (error: unknown) {
      this.logger.debug('Failed to read Unraid version', error);
      return undefined;
    }
  }

  /**
   * Detect container runtime (docker, containerd, podman)
   * @returns Container runtime name or undefined
   */
  async getContainerRuntime(): Promise<string | undefined> {
    try {
      if (!(await this.isDocker())) {
        return undefined;
      }

      // Check for podman
      if (fs.existsSync('/run/.containerenv')) {
        return 'podman';
      }

      // Check cgroup for runtime type
      if (fs.existsSync('/proc/1/cgroup')) {
        const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');

        if (cgroup.includes('docker')) {
          return 'docker';
        }
        if (cgroup.includes('containerd')) {
          return 'containerd';
        }
        if (cgroup.includes('crio')) {
          return 'cri-o';
        }
      }

      return 'docker'; // Default fallback
    } catch (error: unknown) {
      this.logger.debug('Failed to detect container runtime', error);
      return undefined;
    }
  }

  /**
   * Get environment-specific default storage paths
   * @returns Default paths for media, downloads, and config
   */
  async getStoragePaths(): Promise<DefaultPathsDto> {
    const environment = await this.detectEnvironment();

    switch (environment) {
      case 'UNRAID':
        return {
          mediaPath: '/mnt/user/media',
          downloadsPath: '/mnt/user/Downloads',
          configPath: '/mnt/user/appdata/bitbonsai',
        };

      case 'DOCKER':
        return {
          mediaPath: '/media',
          downloadsPath: '/media', // Single mount point in simplified deployment
          configPath: '/config',
        };

      default:
        return {
          mediaPath: '/var/lib/bitbonsai/media',
          downloadsPath: '/var/lib/bitbonsai/downloads',
          configPath: '/etc/bitbonsai',
        };
    }
  }

  /**
   * Detect hardware acceleration capabilities
   * @returns Hardware acceleration availability
   */
  async detectHardwareAcceleration(): Promise<HardwareAccelerationDto> {
    if (this.cachedHardwareInfo) {
      return this.cachedHardwareInfo.acceleration;
    }

    const acceleration: HardwareAccelerationDto = {
      nvidia: await this.detectNvidia(),
      intelQsv: await this.detectIntelQsv(),
      amd: await this.detectAmd(),
      appleVideoToolbox: await this.detectAppleVideoToolbox(),
    };

    return acceleration;
  }

  /**
   * Detect NVIDIA GPU availability
   * @returns True if NVIDIA GPU is available
   */
  private async detectNvidia(): Promise<boolean> {
    try {
      // Check for nvidia-smi command
      await execAsync('which nvidia-smi');
      const { stdout } = await execAsync('nvidia-smi --query-gpu=name --format=csv,noheader', {
        timeout: 5000,
      });

      if (stdout.trim()) {
        this.logger.log(`NVIDIA GPU detected: ${stdout.trim()}`);
        return true;
      }
      return false;
    } catch (error: unknown) {
      this.logger.debug('NVIDIA GPU not detected', error);
      return false;
    }
  }

  /**
   * Detect Intel Quick Sync Video availability
   * @returns True if Intel QSV is available
   */
  private async detectIntelQsv(): Promise<boolean> {
    try {
      // Check for Intel GPU render devices
      const renderDevices = fs.readdirSync('/dev/dri').filter((file) => file.startsWith('renderD'));

      if (renderDevices.length === 0) {
        return false;
      }

      // Verify it's an Intel GPU
      if (fs.existsSync('/sys/class/drm/card0/device/vendor')) {
        const vendor = fs.readFileSync('/sys/class/drm/card0/device/vendor', 'utf8').trim();
        if (vendor === '0x8086') {
          // Intel vendor ID
          this.logger.log('Intel QSV detected');
          return true;
        }
      }

      return false;
    } catch (error: unknown) {
      this.logger.debug('Intel QSV not detected', error);
      return false;
    }
  }

  /**
   * Detect AMD GPU availability
   * @returns True if AMD GPU is available
   */
  private async detectAmd(): Promise<boolean> {
    try {
      // Check lspci for AMD GPU
      const { stdout } = await execAsync('lspci | grep -i amd | grep -i vga', {
        timeout: 5000,
      });

      if (stdout.trim()) {
        this.logger.log(`AMD GPU detected: ${stdout.trim()}`);
        return true;
      }

      // Alternative: Check /sys for AMD GPU
      if (fs.existsSync('/sys/class/drm/card0/device/vendor')) {
        const vendor = fs.readFileSync('/sys/class/drm/card0/device/vendor', 'utf8').trim();
        if (vendor === '0x1002') {
          // AMD vendor ID
          this.logger.log('AMD GPU detected via sysfs');
          return true;
        }
      }

      return false;
    } catch (error: unknown) {
      this.logger.debug('AMD GPU not detected', error);
      return false;
    }
  }

  /**
   * Detect Apple VideoToolbox (Apple Silicon)
   * @returns True if Apple Silicon is available
   *
   * Note: VideoToolbox requires native macOS access and does NOT work in Docker,
   * even when running on Apple Silicon hardware. Only detects when running
   * directly on macOS (not containerized).
   */
  private async detectAppleVideoToolbox(): Promise<boolean> {
    try {
      // Only available when running natively on macOS (not in Docker/containers)
      if (os.platform() !== 'darwin') {
        return false;
      }

      // Check for ARM64 architecture (Apple Silicon)
      const { stdout } = await execAsync('sysctl -n hw.optional.arm64', {
        timeout: 2000,
      });

      if (stdout.trim() === '1') {
        this.logger.log('Apple Silicon detected - VideoToolbox available');
        return true;
      }

      return false;
    } catch (error: unknown) {
      this.logger.debug('Apple VideoToolbox not detected', error);
      return false;
    }
  }

  /**
   * Get system information
   * @returns System information including CPU, memory, and platform
   */
  async getSystemInfo(): Promise<SystemInfoDto> {
    if (this.cachedHardwareInfo) {
      return this.cachedHardwareInfo.systemInfo;
    }

    const cpus = os.cpus();
    const totalMemory = os.totalmem();

    const systemInfo: SystemInfoDto = {
      cpuCores: cpus.length,
      architecture: os.arch(),
      platform: os.platform(),
      totalMemoryGb: Math.round(totalMemory / 1024 / 1024 / 1024),
      containerRuntime: await this.getContainerRuntime(),
      unraidVersion: await this.getUnraidVersion(),
    };

    return systemInfo;
  }

  /**
   * Get complete hardware information (cached)
   * @returns Hardware acceleration and system info
   */
  async getHardwareInfo(): Promise<{
    acceleration: HardwareAccelerationDto;
    systemInfo: SystemInfoDto;
  }> {
    if (this.cachedHardwareInfo) {
      return this.cachedHardwareInfo;
    }

    const acceleration = await this.detectHardwareAcceleration();
    const systemInfo = await this.getSystemInfo();

    this.cachedHardwareInfo = { acceleration, systemInfo };
    return this.cachedHardwareInfo;
  }

  /**
   * Get environment-specific documentation link
   * @returns Documentation URL
   */
  async getDocsLink(): Promise<string> {
    const environment = await this.detectEnvironment();

    switch (environment) {
      case 'UNRAID':
        return 'https://docs.bitbonsai.com/setup/unraid';
      case 'DOCKER':
        return 'https://docs.bitbonsai.com/setup/docker';
      case 'BARE_METAL':
        return 'https://docs.bitbonsai.com/setup/installation';
    }
  }

  /**
   * Get environment-specific recommendations
   * @returns Array of setup recommendations
   */
  async getRecommendations(): Promise<string[]> {
    const environment = await this.detectEnvironment();
    const { acceleration } = await this.getHardwareInfo();
    const recommendations: string[] = [];

    // Environment-specific recommendations
    if (environment === 'UNRAID') {
      recommendations.push('Use /mnt/user paths for Unraid array storage');
      recommendations.push('Consider using cache pool for frequently accessed files');

      if (await this.isDocker()) {
        recommendations.push('GPU passthrough available - configure in Docker template');
      }
    } else if (environment === 'DOCKER') {
      recommendations.push('Mount host directories for persistent storage');
      recommendations.push('Use Docker volumes for best performance');
    } else {
      recommendations.push('Ensure adequate disk space for media analysis');
      recommendations.push('Consider running as systemd service');
    }

    // Hardware acceleration recommendations
    if (acceleration.nvidia) {
      recommendations.push('NVIDIA GPU detected - hardware acceleration available for transcoding');
    }
    if (acceleration.intelQsv) {
      recommendations.push('Intel Quick Sync detected - hardware acceleration available');
    }
    if (acceleration.amd) {
      recommendations.push('AMD GPU detected - hardware acceleration may be available');
    }
    if (acceleration.appleVideoToolbox) {
      recommendations.push('Apple Silicon detected - VideoToolbox acceleration available');
    }

    return recommendations;
  }

  /**
   * Get complete environment information
   * @returns Full environment detection result
   */
  async getEnvironmentInfo(): Promise<EnvironmentInfoDto> {
    const environment = await this.detectEnvironment();
    const isUnraid = await this.isUnraid();
    const isDocker = await this.isDocker();
    const { acceleration, systemInfo } = await this.getHardwareInfo();
    const defaultPaths = await this.getStoragePaths();
    const docsLink = await this.getDocsLink();
    const recommendations = await this.getRecommendations();

    return {
      environment,
      isUnraid,
      isDocker,
      hardwareAcceleration: acceleration,
      defaultPaths,
      systemInfo,
      docsLink,
      recommendations,
    };
  }
}
