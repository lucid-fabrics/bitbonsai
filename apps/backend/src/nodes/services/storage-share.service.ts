import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { StorageProtocol, type StorageShare, StorageShareStatus } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { EncryptionService } from '../../core/services/encryption.service';
import { PrismaService } from '../../prisma/prisma.service';
import { type IStorageShareRepository } from '../repositories/storage-share.repository.interface';
import { StorageMountService } from './storage-mount.service';

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
  autoManaged?: boolean;

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

  constructor(
    @Inject('IStorageShareRepository')
    private readonly repository: IStorageShareRepository,
    private readonly prisma: PrismaService, // For accessing Node entity
    private readonly encryptionService: EncryptionService,
    @Inject(forwardRef(() => StorageMountService))
    private readonly mountService: StorageMountService,
    private readonly httpService: HttpService
  ) {}

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
    const existing = await this.repository.findByMountPoint(data.nodeId, data.mountPoint);

    if (existing) {
      throw new BadRequestException(`Mount point ${data.mountPoint} already exists on this node`);
    }

    // Build export path for easy reference
    const exportPath =
      data.protocol === StorageProtocol.NFS
        ? `${data.serverAddress}:${data.sharePath}`
        : `\\\\${data.serverAddress}\\${data.sharePath}`;

    return this.repository.create({
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
      smbPassword: data.smbPassword ? this.encryptionService.encrypt(data.smbPassword) : null,
      smbDomain: data.smbDomain,
      smbVersion: data.smbVersion ?? '3.0',

      // Auto-mount configuration
      autoMount: data.autoMount ?? true,
      addToFstab: data.addToFstab ?? true,
      mountOnDetection: data.mountOnDetection ?? true,
      autoManaged: data.autoManaged ?? false,

      // Owner node
      ownerNodeId: data.ownerNodeId,
    });
  }

  /**
   * Find all storage shares for a specific node
   */
  async findAllByNode(nodeId: string): Promise<StorageShare[]> {
    return this.repository.findByNodeId(nodeId);
  }

  /**
   * Find all mounted shares for a specific node
   */
  async findMountedByNode(nodeId: string): Promise<StorageShare[]> {
    return this.repository.findMountedByNodeId(nodeId);
  }

  /**
   * Find storage share by ID
   */
  async findOne(id: string): Promise<StorageShare> {
    const share = await this.repository.findById(id);

    if (!share) {
      throw new NotFoundException(`Storage share ${id} not found`);
    }

    return share;
  }

  /**
   * Find shares shared by a specific node (owner)
   */
  async findSharedByNode(ownerNodeId: string): Promise<StorageShare[]> {
    return this.repository.findByOwnerNodeId(ownerNodeId);
  }

  /**
   * Update storage share configuration
   */
  async update(id: string, data: UpdateStorageShareDto): Promise<StorageShare> {
    this.logger.log(`Updating storage share ${id}`);

    const _share = await this.findOne(id);

    return this.repository.update(id, {
      name: data.name,
      mountOptions: data.mountOptions,
      readOnly: data.readOnly,
      autoMount: data.autoMount,
      addToFstab: data.addToFstab,
      mountOnDetection: data.mountOnDetection,

      // SMB credentials
      smbUsername: data.smbUsername,
      smbPassword: data.smbPassword ? this.encryptionService.encrypt(data.smbPassword) : undefined,
      smbDomain: data.smbDomain,
      smbVersion: data.smbVersion,
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

    return this.repository.update(id, updateData);
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
    return this.repository.update(id, stats);
  }

  /**
   * Update health check timestamp
   */
  async updateHealthCheck(id: string): Promise<StorageShare> {
    return this.repository.update(id, {
      lastHealthCheckAt: new Date(),
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

    await this.repository.delete(id);
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

    let sharedByMain: StorageShare[] = [];

    // For LINKED nodes, fetch shares from the main node via HTTP
    if (currentNode.role === 'LINKED' && currentNode.mainNodeUrl) {
      try {
        this.logger.log(`Fetching storage shares from main node: ${currentNode.mainNodeUrl}`);

        // Get main node ID first
        const mainNodesResponse = await firstValueFrom(
          this.httpService.get(`${currentNode.mainNodeUrl}/api/v1/nodes`)
        );
        const mainNodes = mainNodesResponse.data;
        const mainNode = mainNodes.find((n: any) => n.role === 'MAIN');

        if (!mainNode) {
          this.logger.warn('No MAIN node found in main node response');
          return [];
        }

        // Fetch storage shares from main node
        const sharesResponse = await firstValueFrom(
          this.httpService.get(
            `${currentNode.mainNodeUrl}/api/v1/storage-shares/node/${mainNode.id}`
          )
        );
        const allMainShares = sharesResponse.data;

        this.logger.debug(`All shares from main node API: ${JSON.stringify(allMainShares)}`);
        this.logger.debug(`Main node ID: ${mainNode.id}`);

        // Filter to only shares owned by the main node (exported shares)
        sharedByMain = allMainShares.filter(
          (share: StorageShare) => share.ownerNodeId === mainNode.id
        );

        this.logger.log(`Found ${sharedByMain.length} shares from main node`);
        this.logger.debug(
          `Shared by main: ${JSON.stringify(sharedByMain.map((s: StorageShare) => ({ name: s.name, mountPoint: s.mountPoint, ownerNodeId: s.ownerNodeId })))}`
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Error fetching shares from main node: ${errorMessage}`);
        this.logger.error(`Error details:`, error);
        if (error instanceof Error && error.stack) {
          this.logger.error(`Stack trace: ${error.stack}`);
        }
        return [];
      }
    } else if (currentNode.role === 'MAIN') {
      // For MAIN nodes, get shares from local database
      sharedByMain = await this.findSharedByNode(nodeId);
    } else {
      this.logger.warn(`No main node URL configured for linked node ${nodeId}`);
      return [];
    }

    // Filter out shares that are already configured on this node
    const existingMountPoints = await this.repository.findMountPointsByNodeId(nodeId);

    this.logger.debug(
      `Existing mount points on node ${nodeId}: ${JSON.stringify(existingMountPoints)}`
    );

    const existingMountPointSet = new Set(
      existingMountPoints.map((s: { mountPoint: string }) => s.mountPoint)
    );

    this.logger.debug(`Existing mount point paths: ${JSON.stringify([...existingMountPointSet])}`);

    const filteredShares = sharedByMain.filter(
      (share) => !existingMountPointSet.has(share.mountPoint)
    );

    this.logger.log(
      `Filtered out ${sharedByMain.length - filteredShares.length} already-configured shares, returning ${filteredShares.length} new shares`
    );

    return filteredShares;
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

      // Get available shares from main node via HTTP
      if (!currentNode.mainNodeUrl) {
        this.logger.warn('No main node URL configured - skipping auto-mount');
        return result;
      }

      // Get main node ID via HTTP
      const mainNodesResponse = await fetch(`${currentNode.mainNodeUrl}/api/v1/nodes`);
      if (!mainNodesResponse.ok) {
        this.logger.error('Failed to fetch nodes from main node');
        return result;
      }

      const mainNodes = await mainNodesResponse.json();
      const mainNode = mainNodes.find((n: any) => n.role === 'MAIN');

      if (!mainNode) {
        this.logger.warn('No MAIN node found in response');
        return result;
      }

      // Fetch storage shares from main node via HTTP
      const sharesResponse = await fetch(
        `${currentNode.mainNodeUrl}/api/v1/storage-shares/node/${mainNode.id}`
      );

      if (!sharesResponse.ok) {
        this.logger.error('Failed to fetch storage shares from main node');
        return result;
      }

      const allMainShares = await sharesResponse.json();

      // Filter to only auto-managed shares owned by the main node
      const autoManagedShares = allMainShares.filter(
        (share: any) => share.ownerNodeId === mainNode.id && share.autoManaged === true
      );

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
          const existing = await this.repository.findByMountPoint(nodeId, mainShare.mountPoint);

          if (existing) {
            this.logger.debug(`Share ${mainShare.name} already exists on this node`);
            continue;
          }

          // Validate mount point is appropriate for this node
          // Note: Auto-managed shares use Docker container paths (e.g., /media)
          // This assumes all nodes use consistent containerization with same mount points
          const mountPoint = mainShare.mountPoint;

          // Warn if mount point looks like a host path instead of container path
          if (mountPoint.startsWith('/mnt/') || mountPoint.startsWith('/home/')) {
            this.logger.warn(
              `⚠️  Mount point ${mountPoint} looks like a host path. Auto-managed shares should use container paths (e.g., /media). This might cause issues on child nodes.`
            );
          }

          // Create local StorageShare record
          const localShare = await this.create({
            nodeId,
            name: mainShare.name,
            protocol: mainShare.protocol,
            serverAddress: mainShare.serverAddress,
            sharePath: mainShare.sharePath,
            mountPoint, // Use validated mount point
            readOnly: mainShare.readOnly,
            mountOptions: mainShare.mountOptions || undefined,
            autoMount: true,
            addToFstab: true,
            mountOnDetection: true,
            ownerNodeId: mainNode.id,
          });

          result.created++;

          this.logger.log(`✓ Created local share record for ${mainShare.name}`);

          // CRITICAL FIX: Actually mount the share after creating the record
          // This was missing - shares were being created but never mounted!
          if (mainShare.autoMount || mainShare.mountOnDetection) {
            this.logger.log(`Mounting ${mainShare.name} at ${mainShare.mountPoint}...`);

            const mountResult = await this.mountService.mount(localShare.id);

            if (mountResult.success) {
              result.mounted++;
              this.logger.log(`✓ Successfully mounted ${mainShare.name}`);
            } else {
              const mountError = `Failed to mount ${mainShare.name}: ${mountResult.error}`;
              this.logger.error(mountError);
              result.errors.push(mountError);
            }
          }
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

  /**
   * Automatically create storage shares for all libraries owned by a node
   * This is called when pairing a new child node to enable shared storage
   *
   * @param mainNodeId - ID of the main node whose libraries should be shared
   * @returns Array of created storage shares
   */
  async autoCreateSharesForLibraries(mainNodeId: string): Promise<StorageShare[]> {
    this.logger.log(`Auto-creating storage shares for libraries on node ${mainNodeId}...`);

    try {
      // Get the main node
      const mainNode = await this.prisma.node.findUnique({
        where: { id: mainNodeId },
        include: {
          libraries: {
            where: { enabled: true },
          },
        },
      });

      if (!mainNode) {
        throw new NotFoundException(`Node ${mainNodeId} not found`);
      }

      if (!mainNode.ipAddress) {
        this.logger.warn(`Node ${mainNodeId} has no IP address - cannot create shares`);
        return [];
      }

      if (mainNode.libraries.length === 0) {
        this.logger.log(`Node ${mainNodeId} has no enabled libraries - nothing to share`);
        return [];
      }

      const createdShares: StorageShare[] = [];

      // Create a storage share for each library
      for (const library of mainNode.libraries) {
        try {
          // Check if a share already exists for this library path
          const existing = await this.repository.findBySharePath(mainNodeId, library.path);

          if (existing) {
            this.logger.log(`Share already exists for library ${library.name} at ${library.path}`);
            createdShares.push(existing);
            continue;
          }

          // Create the share
          const share = await this.create({
            nodeId: mainNodeId,
            name: `Library: ${library.name}`,
            protocol: StorageProtocol.NFS,
            serverAddress: mainNode.ipAddress,
            sharePath: library.path,
            mountPoint: library.path, // Use same path on child nodes
            readOnly: false, // Allow child nodes to write (for encoding output)
            autoMount: true,
            addToFstab: true,
            mountOnDetection: true,
            autoManaged: true, // Mark as system-managed for auto-detection
            ownerNodeId: mainNodeId,
          });

          this.logger.log(
            `✅ Created storage share for library ${library.name}: ${mainNode.ipAddress}:${library.path}`
          );
          createdShares.push(share);
        } catch (error) {
          this.logger.error(
            `Failed to create share for library ${library.name}:`,
            error instanceof Error ? error.message : 'unknown error'
          );
        }
      }

      this.logger.log(`Created ${createdShares.length} storage shares for node ${mainNodeId}`);
      return createdShares;
    } catch (error) {
      this.logger.error(
        `Auto-create shares failed:`,
        error instanceof Error ? error.message : 'unknown error'
      );
      return [];
    }
  }
}
