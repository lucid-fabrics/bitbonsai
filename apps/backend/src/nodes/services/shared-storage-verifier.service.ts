import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { type Node, StorageShareStatus } from '@prisma/client';
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import { PrismaService } from '../../prisma/prisma.service';

const execAsync = promisify(exec);

export interface StorageVerificationResult {
  isAccessible: boolean;
  isMounted: boolean;
  mountPoint: string | null;
  error: string | null;
  translatedPath?: string; // Path translation for different mount points
}

/**
 * Shared Storage Verifier Service
 *
 * Provides runtime verification of NFS/SMB shared storage accessibility.
 * This service ensures that:
 * 1. NFS/SMB mounts are actually mounted (not just configured)
 * 2. Files are accessible at the expected path
 * 3. Paths are translated for nodes with different mount points
 * 4. Periodic health checks keep hasSharedStorage flag accurate
 *
 * Critical for preventing job delegation failures when shared storage is unavailable.
 */
@Injectable()
export class SharedStorageVerifierService {
  private readonly logger = new Logger(SharedStorageVerifierService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Periodic health check for shared storage on all nodes
   * Runs every 5 minutes to verify NFS/SMB mounts are still accessible
   * Updates StorageShare status and hasSharedStorage flag if mount status changes
   *
   * IMPORTANT: This now checks actual StorageShare mount points, not just node.storageBasePath
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async performHealthCheck(): Promise<void> {
    this.logger.log('Starting periodic shared storage health check...');

    try {
      // Get system mount list once (shared across all checks)
      let mountOutput = '';
      try {
        const result = await execAsync('mount');
        mountOutput = result.stdout;
      } catch {
        this.logger.error('Failed to get system mounts, skipping health check');
        return;
      }

      // Get all StorageShares that claim to be mounted
      const shares = await this.prisma.storageShare.findMany({
        where: {
          isMounted: true,
        },
        include: {
          node: true,
        },
      });

      if (shares.length === 0) {
        this.logger.debug('No mounted storage shares to verify');
        return;
      }

      this.logger.log(`Verifying ${shares.length} mounted storage share(s)...`);

      // Track which nodes have at least one working mount
      const nodesWithWorkingMounts = new Set<string>();
      const nodesChecked = new Set<string>();
      let availableCount = 0;
      let unavailableCount = 0;
      let recoveredCount = 0;

      // Check each share
      for (const share of shares) {
        nodesChecked.add(share.nodeId);

        // Verify mount point is actually mounted
        const isMounted = this.checkMountPointInOutput(share.mountPoint, mountOutput);

        if (isMounted) {
          nodesWithWorkingMounts.add(share.nodeId);
          availableCount++;

          // Update health check timestamp
          await this.prisma.storageShare.update({
            where: { id: share.id },
            data: { lastHealthCheckAt: new Date() },
          });
        } else {
          unavailableCount++;
          this.logger.warn(
            `⚠️  Share "${share.name}" on node ${share.node?.name} claims mounted but ${share.mountPoint} is NOT in system mounts`
          );

          // Update share status to reflect actual state
          await this.prisma.storageShare.update({
            where: { id: share.id },
            data: {
              isMounted: false,
              status: StorageShareStatus.UNMOUNTED,
              lastHealthCheckAt: new Date(),
              lastError: 'Mount point not found in system mounts during health check',
            },
          });
        }
      }

      // Update hasSharedStorage flag for nodes that lost all mounts
      for (const nodeId of nodesChecked) {
        const node = await this.prisma.node.findUnique({ where: { id: nodeId } });
        if (!node) continue;

        const hasWorkingMount = nodesWithWorkingMounts.has(nodeId);

        if (!hasWorkingMount && node.hasSharedStorage) {
          this.logger.warn(
            `⚠️  Node ${node.name} has no working mounts. Setting hasSharedStorage=false`
          );
          await this.prisma.node.update({
            where: { id: nodeId },
            data: {
              hasSharedStorage: false,
              lastHeartbeat: new Date(),
            },
          });
        } else if (hasWorkingMount && !node.hasSharedStorage) {
          this.logger.log(
            `✅ Node ${node.name} has working mounts. Setting hasSharedStorage=true (recovered)`
          );
          await this.prisma.node.update({
            where: { id: nodeId },
            data: {
              hasSharedStorage: true,
              lastHeartbeat: new Date(),
            },
          });
          recoveredCount++;
        }
      }

      this.logger.log(
        `Health check complete: ${availableCount} available, ${recoveredCount} recovered, ${unavailableCount} unavailable`
      );
    } catch (error) {
      this.logger.error(
        `Failed to perform shared storage health check: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  /**
   * Check if a mount point exists in the mount command output
   */
  private checkMountPointInOutput(mountPoint: string, mountOutput: string): boolean {
    // Look for the mount point as a destination field in mount output
    // Format: "source on /mount/point type filesystem (options)"
    const lines = mountOutput.split('\n');
    return lines.some((line) => {
      const match = line.match(/on\s+(\S+)\s+type/);
      return match && match[1] === mountPoint;
    });
  }

  /**
   * Verify that a specific file is accessible via shared storage on a target node
   *
   * @param filePath - Source file path (on source node)
   * @param targetNode - Target node to verify access on
   * @param sourceNode - Source node (to check path translation)
   * @returns Verification result with translated path if applicable
   */
  async verifyFileAccess(
    filePath: string,
    targetNode: Node,
    sourceNode: Node
  ): Promise<StorageVerificationResult> {
    // If target node doesn't claim to have shared storage, skip verification
    if (!targetNode.hasSharedStorage) {
      return {
        isAccessible: false,
        isMounted: false,
        mountPoint: null,
        error: 'Target node does not have shared storage configured',
      };
    }

    try {
      // Check if target node has the storage mounted
      const mountCheck = await this.verifyNFSMount(targetNode);

      if (!mountCheck.isMounted) {
        this.logger.warn(
          `Shared storage NOT mounted on node ${targetNode.name}: ${mountCheck.error}`
        );
        return {
          isAccessible: false,
          isMounted: false,
          mountPoint: mountCheck.mountPoint,
          error: mountCheck.error,
        };
      }

      // Translate path if needed (source and target might have different mount points)
      const translatedPath = this.translatePath(
        filePath,
        sourceNode.storageBasePath,
        targetNode.storageBasePath
      );

      // Verify file exists at the translated path on target node
      const fileAccessible = await this.checkFileAccessibility(translatedPath, targetNode);

      if (!fileAccessible) {
        return {
          isAccessible: false,
          isMounted: true,
          mountPoint: mountCheck.mountPoint,
          error: `File not accessible at path: ${translatedPath}`,
          translatedPath,
        };
      }

      this.logger.log(
        `✅ File accessible via shared storage on ${targetNode.name}: ${translatedPath}`
      );

      return {
        isAccessible: true,
        isMounted: true,
        mountPoint: mountCheck.mountPoint,
        error: null,
        translatedPath,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to verify shared storage access: ${errorMessage}`);

      return {
        isAccessible: false,
        isMounted: false,
        mountPoint: null,
        error: errorMessage,
      };
    }
  }

  /**
   * Verify that NFS/SMB storage is actually mounted on a node
   *
   * This method checks BOTH:
   * 1. The node's storageBasePath (legacy check)
   * 2. Any StorageShare records associated with the node
   *
   * Returns true if ANY mount is working.
   *
   * @param node - Node to check
   * @returns Mount verification result
   */
  async verifyNFSMount(node: Node): Promise<{
    isMounted: boolean;
    mountPoint: string | null;
    error: string | null;
  }> {
    try {
      // Get system mount list
      const { stdout } = await execAsync('mount');

      // First, check StorageShare records for this node
      const shares = await this.prisma.storageShare.findMany({
        where: {
          nodeId: node.id,
          isMounted: true,
        },
      });

      // Check each share's mount point
      for (const share of shares) {
        if (this.checkMountPointInOutput(share.mountPoint, stdout)) {
          this.logger.debug(
            `Storage share "${share.name}" mounted on ${node.name}: ${share.mountPoint}`
          );
          return {
            isMounted: true,
            mountPoint: share.mountPoint,
            error: null,
          };
        }
      }

      // Fallback: check node.storageBasePath for backward compatibility
      if (node.storageBasePath) {
        const isMounted = this.checkMountPointInOutput(node.storageBasePath, stdout);

        if (isMounted) {
          this.logger.debug(`Storage base path mounted on ${node.name}: ${node.storageBasePath}`);
          return {
            isMounted: true,
            mountPoint: node.storageBasePath,
            error: null,
          };
        }
      }

      // No mounts found
      const errorMsg =
        shares.length > 0
          ? `${shares.length} share(s) configured but none are actually mounted`
          : node.storageBasePath
            ? `Storage path ${node.storageBasePath} is not mounted`
            : 'No storage shares or base path configured';

      return {
        isMounted: false,
        mountPoint: shares[0]?.mountPoint || node.storageBasePath || null,
        error: errorMsg,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        isMounted: false,
        mountPoint: node.storageBasePath,
        error: `Mount check failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Check if a specific file is accessible (exists and readable)
   *
   * @param filePath - File path to check
   * @param node - Node to check on (for logging)
   * @returns True if file is accessible
   */
  private async checkFileAccessibility(filePath: string, node: Node): Promise<boolean> {
    try {
      // Check if file exists and is readable
      await fs.access(filePath, fs.constants.R_OK);

      // Get file stats to ensure it's actually a file
      const stats = await fs.stat(filePath);

      if (!stats.isFile()) {
        this.logger.warn(`Path exists but is not a file: ${filePath}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.warn(
        `File not accessible on ${node.name}: ${filePath} - ${error instanceof Error ? error.message : 'unknown error'}`
      );
      return false;
    }
  }

  /**
   * Translate file path between different mount points
   *
   * Example:
   * - Source: /mnt/user/media/Movies/file.mkv (sourceBasePath: /mnt/user/media)
   * - Target: /media/Movies/file.mkv (targetBasePath: /media)
   *
   * @param filePath - Original file path
   * @param sourceBasePath - Source node's storage base path
   * @param targetBasePath - Target node's storage base path
   * @returns Translated path for target node
   */
  private translatePath(
    filePath: string,
    sourceBasePath: string | null,
    targetBasePath: string | null
  ): string {
    // If both base paths are the same or either is null, no translation needed
    if (!sourceBasePath || !targetBasePath || sourceBasePath === targetBasePath) {
      return filePath;
    }

    // Normalize paths (remove trailing slashes)
    const normalizedSourceBase = sourceBasePath.replace(/\/+$/, '');
    const normalizedTargetBase = targetBasePath.replace(/\/+$/, '');

    // Check if file path starts with source base path
    if (!filePath.startsWith(normalizedSourceBase)) {
      this.logger.warn(
        `File path ${filePath} does not start with source base path ${normalizedSourceBase}`
      );
      return filePath; // Return unchanged if path doesn't match
    }

    // Extract relative path
    const relativePath = filePath.substring(normalizedSourceBase.length);

    // Combine with target base path
    const translatedPath = normalizedTargetBase + relativePath;

    this.logger.debug(`Path translated: ${filePath} -> ${translatedPath}`);

    return translatedPath;
  }

  /**
   * Batch verify accessibility for multiple files
   * Useful for checking if a node can access a library's media files
   *
   * @param filePaths - Array of file paths to check
   * @param targetNode - Target node
   * @param sourceNode - Source node
   * @returns Map of file paths to verification results
   */
  async batchVerifyAccess(
    filePaths: string[],
    targetNode: Node,
    sourceNode: Node
  ): Promise<Map<string, StorageVerificationResult>> {
    const results = new Map<string, StorageVerificationResult>();

    // Verify in parallel for performance
    await Promise.all(
      filePaths.map(async (filePath) => {
        const result = await this.verifyFileAccess(filePath, targetNode, sourceNode);
        results.set(filePath, result);
      })
    );

    return results;
  }
}
