import { Injectable, Logger } from '@nestjs/common';
import { NetworkLocation } from '@prisma/client';
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import { LibrariesService } from '../../libraries/libraries.service';
import { PrismaService } from '../../prisma/prisma.service';

const execAsync = promisify(exec);

export interface CapabilityTestResult {
  networkLocation: NetworkLocation;
  hasSharedStorage: boolean;
  storageBasePath: string | null;
  latencyMs: number;
  bandwidthMbps: number | null;
  isPrivateIP: boolean;
  reasoning: string;
}

/**
 * Node Capability Detector Service
 *
 * Automatically detects node capabilities during pairing:
 * - Network location (LOCAL vs REMOTE)
 * - Shared storage access
 * - Network latency and bandwidth
 * - Hardware specifications
 *
 * This enables intelligent job routing and optimized workflows.
 */
@Injectable()
export class NodeCapabilityDetectorService {
  private readonly logger = new Logger(NodeCapabilityDetectorService.name);

  // RFC1918 private IP ranges
  private readonly PRIVATE_IP_RANGES = [
    /^10\./, // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
    /^192\.168\./, // 192.168.0.0/16
  ];

  // Local network latency threshold
  private readonly LOCAL_LATENCY_THRESHOLD_MS = 50;

  constructor(
    readonly _prisma: PrismaService,
    private readonly librariesService: LibrariesService
  ) {}

  /**
   * Detect all capabilities for a node during pairing
   *
   * @param nodeId - Node ID
   * @param nodeIp - Node's IP address
   * @returns Detected capabilities
   */
  async detectCapabilities(nodeId: string, nodeIp: string): Promise<CapabilityTestResult> {
    this.logger.log(`🔍 Detecting capabilities for node ${nodeId} (IP: ${nodeIp})`);

    const isPrivate = this.isPrivateIP(nodeIp);
    const latency = await this.measureLatency(nodeIp);

    // Determine network location based on IP and latency
    let networkLocation: NetworkLocation;
    if (isPrivate && latency < this.LOCAL_LATENCY_THRESHOLD_MS) {
      networkLocation = NetworkLocation.LOCAL;
    } else if (isPrivate) {
      networkLocation = NetworkLocation.LOCAL; // VPN/slow local
    } else {
      networkLocation = NetworkLocation.REMOTE;
    }

    // Test shared storage access (check for NFS/SMB shares)
    const { hasSharedStorage, storageBasePath } =
      networkLocation === NetworkLocation.LOCAL
        ? await this.testSharedStorageAccess(nodeId, nodeIp)
        : { hasSharedStorage: false, storageBasePath: null };

    // Measure bandwidth (only if useful)
    const bandwidthMbps = null; // Stub: bandwidth test not yet implemented

    // Generate reasoning
    const reasoning = this.generateReasoning({
      networkLocation,
      isPrivate,
      latency,
      hasSharedStorage,
    });

    const result: CapabilityTestResult = {
      networkLocation,
      hasSharedStorage,
      storageBasePath,
      latencyMs: latency,
      bandwidthMbps,
      isPrivateIP: isPrivate,
      reasoning,
    };

    this.logger.log(`✅ Capabilities detected: ${JSON.stringify(result, null, 2)}`);

    return result;
  }

  /**
   * Check if IP address is in private range (RFC1918)
   *
   * @param ip - IP address
   * @returns True if private IP
   */
  isPrivateIP(ip: string): boolean {
    return this.PRIVATE_IP_RANGES.some((range) => range.test(ip));
  }

  /**
   * Test if node can access main node's shared storage via NFS or Samba
   *
   * This checks from the CHILD node's perspective by:
   * 1. Checking if media paths are already mounted (for LOCAL nodes)
   * 2. Scanning for NFS exports on the main node
   * 3. Scanning for SMB/CIFS shares on the main node
   *
   * NULL SAFETY FIX: Added null checks for media paths and shares
   *
   * @param nodeId - Node ID
   * @param nodeIp - Node's IP address (to check against)
   * @returns Shared storage access result
   */
  async testSharedStorageAccess(
    nodeId: string,
    nodeIp?: string
  ): Promise<{ hasSharedStorage: boolean; storageBasePath: string | null }> {
    this.logger.log(
      `📂 Testing shared storage access for node ${nodeId} (IP: ${nodeIp || 'unknown'})`
    );

    // UX PHILOSOPHY: Get media paths from libraries in database
    // Eliminates need for MEDIA_PATHS env var - single source of truth
    const mediaPaths = await this.librariesService.getAllLibraryPaths();

    if (mediaPaths.length === 0) {
      this.logger.warn('No libraries configured, cannot test shared storage');
      return { hasSharedStorage: false, storageBasePath: null };
    }

    // If this is testing from the main node itself (localhost), just check local access
    if (!nodeIp || nodeIp === '127.0.0.1' || nodeIp === 'localhost') {
      return this.testLocalStorageAccess(mediaPaths);
    }

    // For remote nodes, check if the main node exposes these paths via NFS or Samba
    const nfsShares = await this.scanNFSExports();
    const smbShares = await this.scanSMBShares();

    this.logger.log(`Found ${nfsShares.length} NFS exports and ${smbShares.length} SMB shares`);

    // NULL SAFETY: Check if any of our media paths are exposed via network shares
    for (const mediaPath of mediaPaths) {
      if (!mediaPath || mediaPath.trim().length === 0) {
        continue; // Skip empty paths
      }

      // Check NFS exports
      for (const nfsExport of nfsShares) {
        if (!nfsExport || nfsExport.trim().length === 0) {
          continue; // Skip empty exports
        }

        if (mediaPath.startsWith(nfsExport) || nfsExport.startsWith(mediaPath)) {
          this.logger.log(`✅ Media path ${mediaPath} is accessible via NFS export ${nfsExport}`);
          return {
            hasSharedStorage: true,
            storageBasePath: mediaPath,
          };
        }
      }

      // Check SMB shares
      for (const smbShare of smbShares) {
        if (!smbShare || smbShare.trim().length === 0) {
          continue; // Skip empty shares
        }

        const lowerSmbShare = smbShare.toLowerCase();
        const lowerMediaPath = mediaPath.toLowerCase();

        // Strict matching: only accept if media path contains the share name
        // Prevents false positives from fuzzy matching like "media" or "video"
        if (lowerMediaPath.includes(lowerSmbShare)) {
          this.logger.log(`✅ Media path ${mediaPath} may be accessible via SMB share ${smbShare}`);
          return {
            hasSharedStorage: true,
            storageBasePath: mediaPath,
          };
        }
      }
    }

    this.logger.log('🚫 No shared storage (NFS/SMB) access detected');
    return { hasSharedStorage: false, storageBasePath: null };
  }

  /**
   * Test local storage access (for MAIN node or same machine)
   */
  private async testLocalStorageAccess(
    mediaPaths: string[]
  ): Promise<{ hasSharedStorage: boolean; storageBasePath: string | null }> {
    for (const testPath of mediaPaths) {
      try {
        // Check if path exists and is readable
        await fs.access(testPath, fs.constants.R_OK);

        // Check if we can list directory
        const files = await fs.readdir(testPath);

        this.logger.log(`✅ Local storage ACCESSIBLE: ${testPath} (${files.length} items found)`);

        return {
          hasSharedStorage: true,
          storageBasePath: testPath,
        };
      } catch (error) {
        this.logger.warn(`❌ Local storage NOT accessible: ${testPath} - ${error}`);
      }
    }

    return { hasSharedStorage: false, storageBasePath: null };
  }

  /**
   * Scan for NFS exports on this machine
   *
   * Checks /etc/exports for NFS shares
   */
  private async scanNFSExports(): Promise<string[]> {
    try {
      const exportsPath = '/etc/exports';
      const content = await fs.readFile(exportsPath, 'utf-8');

      // Parse NFS exports (format: "/path/to/share host(options)")
      const lines = content.split('\n').filter((line) => line.trim() && !line.startsWith('#'));

      const exports: string[] = [];
      for (const line of lines) {
        const match = line.match(/^([^\s]+)/);
        if (match) {
          exports.push(match[1]);
        }
      }

      this.logger.log(`Found ${exports.length} NFS exports: ${exports.join(', ')}`);
      return exports;
    } catch (error) {
      this.logger.debug(`No NFS exports found or /etc/exports not readable: ${error}`);
      return [];
    }
  }

  /**
   * Scan for SMB/CIFS shares on this machine
   *
   * Uses smbclient or checks Samba config
   */
  private async scanSMBShares(): Promise<string[]> {
    try {
      // Try to read Samba config
      const smbConfPath = '/etc/samba/smb.conf';
      const content = await fs.readFile(smbConfPath, 'utf-8');

      // Parse share names (format: "[sharename]")
      const shareMatches = content.matchAll(/^\[([^\]]+)\]/gm);
      const shares: string[] = [];

      for (const match of shareMatches) {
        const shareName = match[1];
        // Skip special shares
        if (!['global', 'printers', 'print$', 'homes'].includes(shareName.toLowerCase())) {
          shares.push(shareName);
        }
      }

      this.logger.log(`Found ${shares.length} SMB shares: ${shares.join(', ')}`);
      return shares;
    } catch (error) {
      this.logger.debug(`No SMB shares found or smb.conf not readable: ${error}`);
      return [];
    }
  }

  /**
   * Measure network latency to a node
   *
   * @param nodeIp - Node's IP address
   * @returns Latency in milliseconds
   */
  async measureLatency(nodeIp: string): Promise<number> {
    this.logger.log(`📡 Measuring latency to ${nodeIp}`);

    try {
      // Use ping command (3 pings, extract average)
      const pingCommand =
        process.platform === 'win32'
          ? `ping -n 3 ${nodeIp}` // Windows
          : `ping -c 3 ${nodeIp}`; // Linux/macOS

      const { stdout } = await execAsync(pingCommand, { timeout: 10000 });

      // Parse average latency from ping output
      // Format: "rtt min/avg/max/mdev = 0.123/0.456/0.789/0.234 ms" (Linux)
      // Format: "Average = 1ms" (Windows)
      let avgLatency = 0;

      if (process.platform === 'win32') {
        const match = stdout.match(/Average = (\d+)ms/i);
        avgLatency = match ? parseInt(match[1], 10) : 0;
      } else {
        const match = stdout.match(/min\/avg\/max\/mdev = [\d.]+\/([\d.]+)\//);
        avgLatency = match ? parseFloat(match[1]) : 0;
      }

      if (avgLatency > 0) {
        this.logger.log(`✅ Latency: ${avgLatency.toFixed(2)}ms`);
        return Math.round(avgLatency);
      }

      // Fallback: extract any number followed by 'ms'
      const fallbackMatch = stdout.match(/([\d.]+)\s*ms/i);
      avgLatency = fallbackMatch ? parseFloat(fallbackMatch[1]) : 1;

      this.logger.log(`✅ Latency (fallback): ${avgLatency.toFixed(2)}ms`);
      return Math.round(avgLatency);
    } catch (error) {
      this.logger.warn(`Failed to measure latency to ${nodeIp}: ${error}`);
      // Return default latency for private IPs (assume local network)
      return this.isPrivateIP(nodeIp) ? 10 : 100;
    }
  }

  /**
   * Test bandwidth to a node (upload/download speed)
   *
   * @param nodeId - Node ID
   * @param nodeUrl - Node's API URL
   * @returns Bandwidth in Mbps
   */
  async testBandwidth(nodeId: string, nodeUrl: string): Promise<number> {
    this.logger.log(`📊 Testing bandwidth to node ${nodeId} at ${nodeUrl}`);

    // Stub: bandwidth test not yet implemented (upload test file, measure time, calculate Mbps)
    return 0;
  }

  /**
   * Generate human-readable reasoning for detected capabilities
   *
   * @param data - Detection data
   * @returns Reasoning string
   */
  private generateReasoning(data: {
    networkLocation: NetworkLocation;
    isPrivate: boolean;
    latency: number;
    hasSharedStorage: boolean;
  }): string {
    const parts: string[] = [];

    // Network location
    if (data.networkLocation === NetworkLocation.LOCAL) {
      parts.push(
        `Local network node (private IP: ${data.isPrivate ? 'yes' : 'no'}, latency: ${data.latency}ms)`
      );
    } else {
      parts.push(`Remote network node (public IP: ${!data.isPrivate}, latency: ${data.latency}ms)`);
    }

    // Storage access
    if (data.hasSharedStorage) {
      parts.push(
        'Direct shared storage access enabled - jobs will use zero-copy file access (optimal performance)'
      );
    } else {
      parts.push(
        'No shared storage access - jobs will require file transfers (slower but works everywhere)'
      );
    }

    return parts.join('. ');
  }
}
