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
   *
   * Status and isMounted are kept in sync:
   * - MOUNTED → isMounted = true, errorCount = 0
   * - UNMOUNTED → isMounted = false
   * - ERROR → isMounted = false, errorCount increments
   * - AVAILABLE → no change to isMounted/errorCount
   */
  async updateStatus(
    id: string,
    status: StorageShareStatus,
    error?: string
  ): Promise<StorageShare> {
    const updateData: any = {
      status,
    };

    // Handle each status appropriately
    if (status === StorageShareStatus.MOUNTED) {
      updateData.isMounted = true;
      updateData.lastMountAt = new Date();
      updateData.errorCount = 0;
      updateData.lastError = null;

      // AUTO-FIX: Set hasSharedStorage=true on node when NFS mounts successfully
      // This enables zero-copy job execution via shared storage
      const share = await this.repository.findById(id);
      if (share) {
        await this.prisma.node.update({
          where: { id: share.nodeId },
          data: {
            hasSharedStorage: true,
            networkLocation: 'LOCAL',
          },
        });
        this.logger.log(
          `✅ Auto-set hasSharedStorage=true for node ${share.nodeId} after mounting ${share.name}`
        );
      }
    } else if (status === StorageShareStatus.UNMOUNTED) {
      updateData.isMounted = false;
      updateData.lastUnmountAt = new Date();
    } else if (status === StorageShareStatus.ERROR) {
      updateData.isMounted = false;
      updateData.errorCount = { increment: 1 };
      if (error) {
        updateData.lastError = error;
      }
    }
    // For AVAILABLE status, don't modify isMounted or errorCount

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

          // Check if already exists - if so, use existing record for mounting
          let localShare = await this.repository.findByMountPoint(nodeId, mainShare.mountPoint);

          if (localShare) {
            this.logger.debug(
              `Share ${mainShare.name} already exists on this node, using existing record`
            );
          } else {
            // Create local StorageShare record
            // Uses unique constraint (nodeId, mountPoint) to prevent race condition duplicates
            try {
              localShare = await this.create({
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
            } catch (createError: any) {
              // Handle race condition: unique constraint violation (P2002)
              // Another request may have created the record between our check and create
              if (createError?.code === 'P2002') {
                this.logger.debug(
                  `Share ${mainShare.name} was created by concurrent request, fetching existing record`
                );
                localShare = await this.repository.findByMountPoint(nodeId, mainShare.mountPoint);
                if (!localShare) {
                  throw new Error('Race condition: record exists but cannot be found');
                }
              } else {
                throw createError;
              }
            }
          }

          // Mount the share if not already mounted
          if (!localShare.isMounted && (mainShare.autoMount || mainShare.mountOnDetection)) {
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
          } else if (localShare.isMounted) {
            this.logger.debug(`Share ${mainShare.name} is already mounted`);
            result.mounted++; // Count as mounted since it's already working
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
   *
   * ⚠️  DEPRECATED: This method uses container paths for NFS shares which will NOT work
   * when running inside Docker. The library path (e.g., /media/Movies) is a container
   * path, but NFS exports need HOST paths (e.g., /mnt/user/media/Movies).
   *
   * USE INSTEAD: NFSAutoExportService.autoExportDockerVolumes() which correctly:
   * - Detects Docker volume mounts
   * - Uses HOST paths for sharePath (NFS export)
   * - Uses container paths for mountPoint (child node mount)
   *
   * This method is kept for backward compatibility but will log warnings and
   * return existing auto-managed shares instead of creating broken ones.
   *
   * @param mainNodeId - ID of the main node whose libraries should be shared
   * @returns Array of existing auto-managed storage shares (does NOT create new ones)
   */
  async autoCreateSharesForLibraries(mainNodeId: string): Promise<StorageShare[]> {
    this.logger.warn(
      `⚠️  autoCreateSharesForLibraries is DEPRECATED. Use NFSAutoExportService.autoExportDockerVolumes() instead.`
    );
    this.logger.warn(
      `This method uses container paths which don't work for NFS exports inside Docker.`
    );

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

      // Instead of creating broken shares, return existing auto-managed shares
      // These should have been created by NFSAutoExportService with correct paths
      const existingShares = await this.repository.findAutoManagedByNodeId(mainNodeId);

      if (existingShares.length > 0) {
        this.logger.log(
          `Returning ${existingShares.length} existing auto-managed shares (created by NFSAutoExportService)`
        );
        return existingShares;
      }

      // If no auto-managed shares exist, warn user to use the correct method
      this.logger.warn(
        `No auto-managed shares found. Please use POST /storage-shares/auto-export-docker-volumes ` +
          `to create NFS shares with correct HOST paths.`
      );

      // Return empty array instead of creating broken shares
      return [];
    } catch (error) {
      this.logger.error(
        `Auto-create shares failed:`,
        error instanceof Error ? error.message : 'unknown error'
      );
      return [];
    }
  }
}
