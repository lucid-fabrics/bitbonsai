import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StorageProtocol, type StorageShare, StorageShareStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateStorageShareDto {
  nodeId: string;
  name: string;
  protocol: StorageProtocol;
  serverAddress: string;
  sharePath: string;
  mountPoint: string;
  readOnly?: boolean;
  mountOptions?: string;

  // SMB-specific fields
  smbUsername?: string;
  smbPassword?: string;
  smbDomain?: string;
  smbVersion?: string;

  // Auto-mount configuration
  autoMount?: boolean;
  addToFstab?: boolean;
  mountOnDetection?: boolean;

  // Owner node (if sharing from this node)
  ownerNodeId?: string;
}

export interface UpdateStorageShareDto {
  name?: string;
  mountOptions?: string;
  readOnly?: boolean;
  autoMount?: boolean;
  addToFstab?: boolean;
  mountOnDetection?: boolean;

  // SMB credentials
  smbUsername?: string;
  smbPassword?: string;
  smbDomain?: string;
  smbVersion?: string;
}

export interface StorageShareStats {
  totalShares: number;
  mountedShares: number;
  availableShares: number;
  errorShares: number;
  totalCapacityBytes: bigint;
  usedCapacityBytes: bigint;
}

/**
 * Service to manage network storage shares (NFS/SMB)
 * Handles CRUD operations for storage share configuration
 */
@Injectable()
export class StorageShareService {
  private readonly logger = new Logger(StorageShareService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new storage share configuration
   */
  async create(data: CreateStorageShareDto): Promise<StorageShare> {
    this.logger.log(`Creating storage share: ${data.name} on node ${data.nodeId}`);

    // Validate protocol-specific requirements
    if (data.protocol === StorageProtocol.SMB && !data.smbUsername) {
      throw new BadRequestException('SMB shares require username');
    }

    // Check for duplicate mount point on same node
    const existing = await this.prisma.storageShare.findFirst({
      where: {
        nodeId: data.nodeId,
        mountPoint: data.mountPoint,
      },
    });

    if (existing) {
      throw new BadRequestException(`Mount point ${data.mountPoint} already exists on this node`);
    }

    // Build export path for easy reference
    const exportPath =
      data.protocol === StorageProtocol.NFS
        ? `${data.serverAddress}:${data.sharePath}`
        : `\\\\${data.serverAddress}\\${data.sharePath}`;

    return this.prisma.storageShare.create({
      data: {
        nodeId: data.nodeId,
        name: data.name,
        protocol: data.protocol,
        status: StorageShareStatus.AVAILABLE,
        serverAddress: data.serverAddress,
        sharePath: data.sharePath,
        exportPath,
        mountPoint: data.mountPoint,
        readOnly: data.readOnly ?? true,
        mountOptions: data.mountOptions,

        // SMB fields
        smbUsername: data.smbUsername,
        smbPassword: data.smbPassword, // TODO: Encrypt password
        smbDomain: data.smbDomain,
        smbVersion: data.smbVersion ?? '3.0',

        // Auto-mount configuration
        autoMount: data.autoMount ?? true,
        addToFstab: data.addToFstab ?? true,
        mountOnDetection: data.mountOnDetection ?? true,

        // Owner node
        ownerNodeId: data.ownerNodeId,
      },
    });
  }

  /**
   * Find all storage shares for a specific node
   */
  async findAllByNode(nodeId: string): Promise<StorageShare[]> {
    return this.prisma.storageShare.findMany({
      where: { nodeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find all mounted shares for a specific node
   */
  async findMountedByNode(nodeId: string): Promise<StorageShare[]> {
    return this.prisma.storageShare.findMany({
      where: {
        nodeId,
        isMounted: true,
      },
      orderBy: { lastMountAt: 'desc' },
    });
  }

  /**
   * Find storage share by ID
   */
  async findOne(id: string): Promise<StorageShare> {
    const share = await this.prisma.storageShare.findUnique({
      where: { id },
    });

    if (!share) {
      throw new NotFoundException(`Storage share ${id} not found`);
    }

    return share;
  }

  /**
   * Find shares shared by a specific node (owner)
   */
  async findSharedByNode(ownerNodeId: string): Promise<StorageShare[]> {
    return this.prisma.storageShare.findMany({
      where: { ownerNodeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Update storage share configuration
   */
  async update(id: string, data: UpdateStorageShareDto): Promise<StorageShare> {
    this.logger.log(`Updating storage share ${id}`);

    const _share = await this.findOne(id);

    return this.prisma.storageShare.update({
      where: { id },
      data: {
        name: data.name,
        mountOptions: data.mountOptions,
        readOnly: data.readOnly,
        autoMount: data.autoMount,
        addToFstab: data.addToFstab,
        mountOnDetection: data.mountOnDetection,

        // SMB credentials
        smbUsername: data.smbUsername,
        smbPassword: data.smbPassword, // TODO: Encrypt password
        smbDomain: data.smbDomain,
        smbVersion: data.smbVersion,
      },
    });
  }

  /**
   * Update share status (called by StorageMountService)
   */
  async updateStatus(
    id: string,
    status: StorageShareStatus,
    error?: string
  ): Promise<StorageShare> {
    const updateData: any = {
      status,
      errorCount: error ? { increment: 1 } : 0,
    };

    if (error) {
      updateData.lastError = error;
    }

    if (status === StorageShareStatus.MOUNTED) {
      updateData.isMounted = true;
      updateData.lastMountAt = new Date();
      updateData.errorCount = 0;
      updateData.lastError = null;
    } else if (status === StorageShareStatus.UNMOUNTED) {
      updateData.isMounted = false;
      updateData.lastUnmountAt = new Date();
    }

    return this.prisma.storageShare.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Update storage usage statistics
   */
  async updateUsageStats(
    id: string,
    stats: {
      totalSizeBytes?: bigint;
      availableSizeBytes?: bigint;
      usedPercent?: number;
    }
  ): Promise<StorageShare> {
    return this.prisma.storageShare.update({
      where: { id },
      data: stats,
    });
  }

  /**
   * Update health check timestamp
   */
  async updateHealthCheck(id: string): Promise<StorageShare> {
    return this.prisma.storageShare.update({
      where: { id },
      data: {
        lastHealthCheckAt: new Date(),
      },
    });
  }

  /**
   * Delete storage share
   */
  async delete(id: string): Promise<void> {
    this.logger.log(`Deleting storage share ${id}`);

    const share = await this.findOne(id);

    if (share.isMounted) {
      throw new BadRequestException('Cannot delete a mounted share. Unmount it first.');
    }

    await this.prisma.storageShare.delete({
      where: { id },
    });
  }

  /**
   * Get storage statistics for a node
   */
  async getNodeStats(nodeId: string): Promise<StorageShareStats> {
    const shares = await this.findAllByNode(nodeId);

    const stats: StorageShareStats = {
      totalShares: shares.length,
      mountedShares: shares.filter((s) => s.isMounted).length,
      availableShares: shares.filter((s) => s.status === StorageShareStatus.AVAILABLE).length,
      errorShares: shares.filter((s) => s.status === StorageShareStatus.ERROR).length,
      totalCapacityBytes: 0n,
      usedCapacityBytes: 0n,
    };

    // Calculate total capacity and usage
    for (const share of shares) {
      if (share.totalSizeBytes) {
        stats.totalCapacityBytes = stats.totalCapacityBytes + share.totalSizeBytes;
      }
      if (share.totalSizeBytes && share.availableSizeBytes) {
        stats.usedCapacityBytes =
          stats.usedCapacityBytes + (share.totalSizeBytes - share.availableSizeBytes);
      }
    }

    return stats;
  }

  /**
   * Auto-detect available shares on the network
   * Returns shares advertised by other nodes
   */
  async autoDetectShares(nodeId: string): Promise<StorageShare[]> {
    this.logger.log(`Auto-detecting storage shares for node ${nodeId}`);

    // Get current node
    const currentNode = await this.prisma.node.findUnique({
      where: { id: nodeId },
    });

    if (!currentNode) {
      throw new NotFoundException(`Node ${nodeId} not found`);
    }

    // Get main node if this is a LINKED node
    let mainNodeId = currentNode.role === 'MAIN' ? nodeId : null;
    if (!mainNodeId && currentNode.mainNodeUrl) {
      // Find main node by URL
      const mainNode = await this.prisma.node.findFirst({
        where: { role: 'MAIN' },
      });
      mainNodeId = mainNode?.id || null;
    }

    if (!mainNodeId) {
      this.logger.warn(`No main node found for share detection`);
      return [];
    }

    // Get shares advertised by the main node
    const sharedByMain = await this.findSharedByNode(mainNodeId);

    // Filter out shares that are already configured on this node
    const existingMountPoints = await this.prisma.storageShare.findMany({
      where: { nodeId },
      select: { mountPoint: true },
    });

    const existingMountPointSet = new Set(
      existingMountPoints.map((s: { mountPoint: string }) => s.mountPoint)
    );

    return sharedByMain.filter((share) => !existingMountPointSet.has(share.mountPoint));
  }

  /**
   * Auto-detect and auto-mount shares from main node
   * Called when a child node joins the cluster
   *
   * This creates local StorageShare records and auto-mounts them
   */
  async autoDetectAndMount(nodeId: string): Promise<{
    detected: number;
    created: number;
    mounted: number;
    errors: string[];
  }> {
    this.logger.log(`Auto-detecting and mounting shares for node ${nodeId}...`);

    const result = {
      detected: 0,
      created: 0,
      mounted: 0,
      errors: [] as string[],
    };

    try {
      // Get current node
      const currentNode = await this.prisma.node.findUnique({
        where: { id: nodeId },
      });

      if (!currentNode) {
        throw new NotFoundException(`Node ${nodeId} not found`);
      }

      // Only auto-mount for LINKED nodes
      if (currentNode.role !== 'LINKED') {
        this.logger.debug('Node is not LINKED - skipping auto-mount');
        return result;
      }

      // Get main node
      const mainNode = await this.prisma.node.findFirst({
        where: { role: 'MAIN' },
      });

      if (!mainNode) {
        this.logger.warn('No main node found - skipping auto-mount');
        return result;
      }

      // Get auto-managed shares from main node
      const autoManagedShares = await this.prisma.storageShare.findMany({
        where: {
          ownerNodeId: mainNode.id,
          autoManaged: true,
        },
      });

      result.detected = autoManagedShares.length;

      if (autoManagedShares.length === 0) {
        this.logger.log('No auto-managed shares found on main node');
        return result;
      }

      this.logger.log(`Found ${autoManagedShares.length} auto-managed shares to mount`);

      // Create and mount each share on this node
      for (const mainShare of autoManagedShares) {
        try {
          // Check if already exists
          const existing = await this.prisma.storageShare.findFirst({
            where: {
              nodeId,
              mountPoint: mainShare.mountPoint,
            },
          });

          if (existing) {
            this.logger.debug(`Share ${mainShare.name} already exists on this node`);
            continue;
          }

          // Create local StorageShare record
          const _localShare = await this.create({
            nodeId,
            name: mainShare.name,
            protocol: mainShare.protocol,
            serverAddress: mainShare.serverAddress,
            sharePath: mainShare.sharePath,
            mountPoint: mainShare.mountPoint,
            readOnly: mainShare.readOnly,
            mountOptions: mainShare.mountOptions || undefined,
            autoMount: true,
            addToFstab: true,
            mountOnDetection: true,
            ownerNodeId: mainNode.id,
          });

          result.created++;

          this.logger.log(`✓ Created local share record for ${mainShare.name}`);
        } catch (error) {
          const errorMsg = `Failed to auto-mount ${mainShare.name}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`;
          this.logger.error(errorMsg);
          result.errors.push(errorMsg);
        }
      }

      this.logger.log(
        `Auto-mount complete: ${result.created} shares created, ${result.errors.length} errors`
      );

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Auto-detect and mount failed: ${errorMsg}`);
      result.errors.push(errorMsg);
      return result;
    }
  }
}
