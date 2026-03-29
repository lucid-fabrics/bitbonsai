import { Injectable } from '@nestjs/common';
import {
  type Prisma,
  StorageShareStatus as Status,
  type StorageShare,
  type StorageShareStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { type IStorageShareRepository } from './storage-share.repository.interface';

/**
 * Prisma implementation of StorageShare repository
 * Encapsulates all database operations for StorageShare entity
 */
@Injectable()
export class StorageShareRepository implements IStorageShareRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Partial<StorageShare>): Promise<StorageShare> {
    return this.prisma.storageShare.create({
      data: data as Prisma.StorageShareCreateInput,
    });
  }

  async findById(id: string): Promise<StorageShare | null> {
    return this.prisma.storageShare.findUnique({
      where: { id },
    });
  }

  async findByMountPoint(nodeId: string, mountPoint: string): Promise<StorageShare | null> {
    return this.prisma.storageShare.findFirst({
      where: {
        nodeId,
        mountPoint,
      },
    });
  }

  async findByNodeId(nodeId: string): Promise<StorageShare[]> {
    return this.prisma.storageShare.findMany({
      where: { nodeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll(): Promise<StorageShare[]> {
    return this.prisma.storageShare.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByStatus(status: StorageShareStatus): Promise<StorageShare[]> {
    return this.prisma.storageShare.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAutoManagedByNodeId(nodeId: string): Promise<StorageShare[]> {
    return this.prisma.storageShare.findMany({
      where: {
        nodeId,
        autoManaged: true,
      },
    });
  }

  async update(id: string, data: Partial<StorageShare>): Promise<StorageShare> {
    return this.prisma.storageShare.update({
      where: { id },
      data: data as Prisma.StorageShareUpdateInput,
    });
  }

  async updateStatus(
    id: string,
    status: StorageShareStatus,
    errorMessage?: string
  ): Promise<StorageShare> {
    const data: Record<string, unknown> = { status };

    if (status === Status.MOUNTED) {
      data.isMounted = true;
      data.lastMountAt = new Date();
      data.errorCount = 0;
      data.lastError = null;

      // AUTO-FIX: Set hasSharedStorage=true on node when NFS mounts
      const share = await this.prisma.storageShare.findUnique({
        where: { id },
        select: { nodeId: true },
      });
      if (share) {
        await this.prisma.node.update({
          where: { id: share.nodeId },
          data: { hasSharedStorage: true, networkLocation: 'LOCAL' },
        });
      }
    } else if (status === Status.UNMOUNTED) {
      data.isMounted = false;
      data.lastUnmountAt = new Date();
    } else if (status === Status.ERROR) {
      data.isMounted = false;
      data.errorCount = { increment: 1 };
      if (errorMessage) {
        data.lastError = errorMessage;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic update object built conditionally above
    return this.prisma.storageShare.update({
      where: { id },
      data: data as any,
    });
  }

  async delete(id: string): Promise<StorageShare> {
    return this.prisma.storageShare.delete({
      where: { id },
    });
  }

  async deleteAutoManagedByNodeId(nodeId: string): Promise<number> {
    const result = await this.prisma.storageShare.deleteMany({
      where: {
        nodeId,
        autoManaged: true,
      },
    });
    return result.count;
  }

  async countByStatus(): Promise<{
    total: number;
    mounted: number;
    unmounted: number;
    error: number;
  }> {
    const [total, mounted, unmounted, error] = await Promise.all([
      this.prisma.storageShare.count(),
      this.prisma.storageShare.count({ where: { status: Status.MOUNTED } }),
      this.prisma.storageShare.count({ where: { status: Status.UNMOUNTED } }),
      this.prisma.storageShare.count({ where: { status: Status.ERROR } }),
    ]);

    return {
      total,
      mounted,
      unmounted,
      error,
    };
  }

  async findMountedByNodeId(nodeId: string): Promise<StorageShare[]> {
    return this.prisma.storageShare.findMany({
      where: {
        nodeId,
        isMounted: true,
      },
      orderBy: { lastMountAt: 'desc' },
    });
  }

  async findByOwnerNodeId(ownerNodeId: string): Promise<StorageShare[]> {
    return this.prisma.storageShare.findMany({
      where: { ownerNodeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findMountPointsByNodeId(nodeId: string): Promise<Array<{ mountPoint: string }>> {
    return this.prisma.storageShare.findMany({
      where: { nodeId },
      select: { mountPoint: true },
    });
  }

  async findBySharePath(nodeId: string, sharePath: string): Promise<StorageShare | null> {
    return this.prisma.storageShare.findFirst({
      where: {
        nodeId,
        sharePath,
      },
    });
  }
}
