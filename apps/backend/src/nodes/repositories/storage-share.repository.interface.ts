import { type StorageProtocol, type StorageShare, type StorageShareStatus } from '@prisma/client';

/**
 * Repository interface for StorageShare entity
 * Abstracts database operations following Repository Pattern
 */
export interface IStorageShareRepository {
  /**
   * Create a new storage share
   */
  create(data: Partial<StorageShare>): Promise<StorageShare>;

  /**
   * Find a storage share by ID
   */
  findById(id: string): Promise<StorageShare | null>;

  /**
   * Find a storage share by mount point and node
   */
  findByMountPoint(nodeId: string, mountPoint: string): Promise<StorageShare | null>;

  /**
   * Find all storage shares for a node
   */
  findByNodeId(nodeId: string): Promise<StorageShare[]>;

  /**
   * Find all storage shares
   */
  findAll(): Promise<StorageShare[]>;

  /**
   * Find storage shares by status
   */
  findByStatus(status: StorageShareStatus): Promise<StorageShare[]>;

  /**
   * Find auto-managed shares for a node
   */
  findAutoManagedByNodeId(nodeId: string): Promise<StorageShare[]>;

  /**
   * Update a storage share
   */
  update(id: string, data: Partial<StorageShare>): Promise<StorageShare>;

  /**
   * Update storage share status
   */
  updateStatus(
    id: string,
    status: StorageShareStatus,
    errorMessage?: string
  ): Promise<StorageShare>;

  /**
   * Delete a storage share
   */
  delete(id: string): Promise<StorageShare>;

  /**
   * Delete all auto-managed shares for a node
   */
  deleteAutoManagedByNodeId(nodeId: string): Promise<number>;

  /**
   * Count shares by status
   */
  countByStatus(): Promise<{
    total: number;
    mounted: number;
    unmounted: number;
    error: number;
  }>;

  /**
   * Find all mounted shares for a specific node
   */
  findMountedByNodeId(nodeId: string): Promise<StorageShare[]>;

  /**
   * Find all shares owned by a specific node
   */
  findByOwnerNodeId(ownerNodeId: string): Promise<StorageShare[]>;

  /**
   * Find all mount points for a specific node
   */
  findMountPointsByNodeId(nodeId: string): Promise<Array<{ mountPoint: string }>>;

  /**
   * Find a storage share by share path and node
   */
  findBySharePath(nodeId: string, sharePath: string): Promise<StorageShare | null>;
}
