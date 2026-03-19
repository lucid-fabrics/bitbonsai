import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { DockerVolumeMount } from '../interfaces/file-transport.interface';

const execAsync = promisify(exec);

/**
 * Docker inspect API response types
 */
interface DockerMountInfo {
  Type: string;
  Source: string;
  Destination: string;
  RW: boolean;
}

interface DockerInspectResponse {
  Mounts?: DockerMountInfo[];
}

/**
 * Detects Docker volume mounts from the running container
 *
 * This allows us to automatically discover which paths are available
 * for sharing with child nodes, without requiring manual configuration.
 *
 * Example Docker volumes:
 * - /mnt/user/media:/media
 * - /mnt/user/downloads:/downloads
 * - /data:/data
 */
@Injectable()
export class DockerVolumeDetectorService {
  private readonly logger = new Logger(DockerVolumeDetectorService.name);
  private cachedVolumes: DockerVolumeMount[] | null = null;
  private lastDetection = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Detect all volume mounts in the current container
   */
  async detectVolumes(): Promise<DockerVolumeMount[]> {
    // Return cached result if still valid
    if (this.cachedVolumes && Date.now() - this.lastDetection < this.CACHE_TTL) {
      return this.cachedVolumes;
    }

    try {
      // Check if running in Docker
      const isDocker = await this.isRunningInDocker();
      if (!isDocker) {
        this.logger.warn('Not running in Docker - no volumes to detect');
        return [];
      }

      // Get container hostname (usually container ID)
      const hostname = await this.getHostname();

      // Inspect the container
      const containerInfo = await this.inspectContainer(hostname);

      // Parse and filter mounts
      const volumes = this.parseVolumeMounts(containerInfo);

      // Filter to only meaningful volumes (exclude system mounts)
      const filteredVolumes = this.filterSystemMounts(volumes);

      this.cachedVolumes = filteredVolumes;
      this.lastDetection = Date.now();

      this.logger.log(`Detected ${filteredVolumes.length} Docker volume mounts`);
      filteredVolumes.forEach((v) => {
        this.logger.debug(`  ${v.source} → ${v.destination} (${v.readOnly ? 'ro' : 'rw'})`);
      });

      return filteredVolumes;
    } catch (error: unknown) {
      this.logger.error(
        'Failed to detect Docker volumes',
        error instanceof Error ? error.stack : error
      );
      return [];
    }
  }

  /**
   * Check if running inside a Docker container
   */
  private async isRunningInDocker(): Promise<boolean> {
    try {
      // Check for .dockerenv file
      const { stdout } = await execAsync('[ -f /.dockerenv ] && echo "true" || echo "false"');
      if (stdout.trim() === 'true') {
        return true;
      }

      // Check cgroup
      const { stdout: cgroupOutput } = await execAsync('cat /proc/1/cgroup 2>/dev/null || echo ""');
      return cgroupOutput.includes('docker') || cgroupOutput.includes('kubepods');
    } catch (error: unknown) {
      this.logger.debug('Docker detection check failed, assuming non-containerized', error);
      return false;
    }
  }

  /**
   * Get container hostname
   */
  private async getHostname(): Promise<string> {
    const { stdout } = await execAsync('hostname');
    return stdout.trim();
  }

  /**
   * Inspect Docker container to get mount information
   */
  private async inspectContainer(containerIdOrName: string): Promise<DockerInspectResponse> {
    // Try multiple methods to find the container
    const candidateNames = [
      containerIdOrName, // Hostname
      'bitbonsai-backend', // Known container name
      process.env.HOSTNAME, // Environment variable
    ].filter(Boolean);

    // Try each candidate name
    for (const name of candidateNames) {
      try {
        const { stdout } = await execAsync(`docker inspect ${name}`);
        const parsed = JSON.parse(stdout);
        // MEDIUM FIX: Validate array has elements before accessing [0]
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]) {
          this.logger.debug(`Successfully inspected container using name: ${name}`);
          return parsed[0];
        }
      } catch (error: unknown) {
        this.logger.debug(`Failed to inspect container with name: ${name}`, error);
      }
    }

    // Fallback: try to find container by looking at /proc/self/cgroup
    this.logger.debug('Failed to inspect by hostname, trying cgroup method');
    try {
      const containerId = await this.getContainerIdFromCgroup();
      const { stdout } = await execAsync(`docker inspect ${containerId}`);
      const parsed = JSON.parse(stdout);
      // MEDIUM FIX: Validate array has elements before accessing [0]
      if (!Array.isArray(parsed) || parsed.length === 0 || !parsed[0]) {
        throw new Error('Docker inspect returned empty result');
      }
      return parsed[0];
    } catch (cgroupError: unknown) {
      this.logger.debug('Cgroup container inspection failed', cgroupError);
      throw new Error('Could not inspect Docker container using any method');
    }
  }

  /**
   * Extract container ID from cgroup
   */
  private async getContainerIdFromCgroup(): Promise<string> {
    const { stdout } = await execAsync('cat /proc/self/cgroup');
    const match = stdout.match(/docker[/-]([a-f0-9]{64})/);
    if (!match) {
      throw new Error('Could not extract container ID from cgroup');
    }
    return match[1];
  }

  /**
   * Parse mount information from Docker inspect output
   */
  private parseVolumeMounts(containerInfo: DockerInspectResponse): DockerVolumeMount[] {
    const mounts = containerInfo.Mounts || [];

    return mounts
      .filter((mount) => mount.Type === 'bind') // Only bind mounts
      .map((mount) => ({
        source: mount.Source,
        destination: mount.Destination,
        readOnly: mount.RW === false,
        type: mount.Type,
      }));
  }

  /**
   * Filter out system/internal mounts that shouldn't be shared
   */
  private filterSystemMounts(volumes: DockerVolumeMount[]): DockerVolumeMount[] {
    const systemPaths = [
      '/etc/resolv.conf',
      '/etc/hostname',
      '/etc/hosts',
      '/.dockerenv',
      '/dev',
      '/proc',
      '/sys',
      '/run',
      '/tmp',
      '/var/run',
    ];

    // Application-specific paths that shouldn't be shared
    const appInternalPaths = [
      '/app', // Application source code and config
      '/usr', // System binaries
      '/opt', // Optional packages
      '/lib', // System libraries
      '/bin', // Binaries
      '/sbin', // System binaries
      '/var', // Variable data
      '/root', // Root home
      '/home', // User homes
    ];

    return volumes.filter((volume) => {
      const dest = volume.destination;

      // Exclude exact system paths
      if (systemPaths.includes(dest)) {
        return false;
      }

      // Exclude paths starting with system prefixes
      if (systemPaths.some((prefix) => dest.startsWith(`${prefix}/`))) {
        return false;
      }

      // Exclude application internal paths
      if (appInternalPaths.some((prefix) => dest === prefix || dest.startsWith(`${prefix}/`))) {
        return false;
      }

      // Exclude very short paths (usually system mounts)
      if (dest.length < 3) {
        return false;
      }

      // Only include paths that look like media/data directories
      // Check both destination (container path) and source (host path)
      const source = volume.source;

      // Allowed destination patterns
      const allowedDestPrefixes = [
        '/media',
        '/data',
        '/storage',
        '/mnt',
        '/cache',
        '/downloads',
        '/videos',
        '/music',
        '/photos',
      ];
      const destMatches = allowedDestPrefixes.some(
        (prefix) => dest === prefix || dest.startsWith(`${prefix}/`)
      );

      // Allowed source patterns (Unraid-specific)
      const allowedSourcePatterns = ['/mnt/user/', '/mnt/cache/', '/mnt/disk'];
      const sourceMatches = allowedSourcePatterns.some((pattern) => source.includes(pattern));

      // Include if either destination OR source looks like media
      if (!destMatches && !sourceMatches) {
        this.logger.debug(
          `Excluding volume: ${dest} (source: ${source}) - not a media/data directory`
        );
        return false;
      }

      // Include everything that passed the filters
      return true;
    });
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.cachedVolumes = null;
    this.lastDetection = 0;
    this.logger.debug('Volume detection cache cleared');
  }

  /**
   * Get suggested share name from destination path
   */
  getSuggestedShareName(destination: string): string {
    // Remove leading/trailing slashes
    const cleaned = destination.replace(/^\/+|\/+$/g, '');

    // Convert to title case
    return cleaned
      .split('/')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
