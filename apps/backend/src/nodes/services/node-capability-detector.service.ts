import { Injectable, Logger } from '@nestjs/common';
import { NetworkLocation } from '@prisma/client';
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { promisify } from 'util';
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

  constructor(private readonly prisma: PrismaService) {}

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

    // Test shared storage access (only meaningful for LOCAL nodes)
    const { hasSharedStorage, storageBasePath } =
      networkLocation === NetworkLocation.LOCAL
        ? await this.testSharedStorageAccess(nodeId)
        : { hasSharedStorage: false, storageBasePath: null };

    // Measure bandwidth (only if useful)
    const bandwidthMbps = null; // TODO: Implement bandwidth test

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
   * Test if node can access main node's shared storage
   *
   * @param nodeId - Node ID
   * @returns Shared storage access result
   */
  async testSharedStorageAccess(
    nodeId: string
  ): Promise<{ hasSharedStorage: boolean; storageBasePath: string | null }> {
    this.logger.log(`📂 Testing shared storage access for node ${nodeId}`);

    // Get media paths from main node's environment
    const mediaPaths = (process.env.MEDIA_PATHS || '').split(',').filter(Boolean);

    if (mediaPaths.length === 0) {
      this.logger.warn('No MEDIA_PATHS configured, cannot test shared storage');
      return { hasSharedStorage: false, storageBasePath: null };
    }

    // Test each media path
    for (const testPath of mediaPaths) {
      try {
        // Check if path exists and is readable
        await fs.access(testPath, fs.constants.R_OK);

        // Check if we can list directory
        const files = await fs.readdir(testPath);

        this.logger.log(`✅ Shared storage ACCESSIBLE: ${testPath} (${files.length} items found)`);

        return {
          hasSharedStorage: true,
          storageBasePath: testPath,
        };
      } catch (error) {
        this.logger.warn(`❌ Shared storage NOT accessible: ${testPath} - ${error}`);
      }
    }

    this.logger.log('🚫 No shared storage access detected');
    return { hasSharedStorage: false, storageBasePath: null };
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

    // TODO: Implement bandwidth test
    // - Upload a test file (e.g., 10MB)
    // - Measure time taken
    // - Calculate Mbps

    // Placeholder: return null for now
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
