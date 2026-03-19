import { Test, type TestingModule } from '@nestjs/testing';
import { StorageShareStatus } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { StorageShareRepository } from '../../storage-share.repository';

const mockShare = {
  id: 'share-1',
  nodeId: 'node-1',
  ownerNodeId: 'node-owner',
  mountPoint: '/mnt/nfs',
  sharePath: '/exports/videos',
  status: StorageShareStatus.MOUNTED,
  isMounted: true,
  autoManaged: false,
  errorCount: 0,
  lastError: null,
  lastMountAt: new Date('2025-01-01'),
  lastUnmountAt: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockPrismaNode = {
  update: jest.fn(),
};

const mockPrismaStorageShare = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  deleteMany: jest.fn(),
  count: jest.fn(),
};

const mockPrisma = {
  storageShare: mockPrismaStorageShare,
  node: mockPrismaNode,
};

describe('StorageShareRepository', () => {
  let repository: StorageShareRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [StorageShareRepository, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    repository = module.get<StorageShareRepository>(StorageShareRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeInstanceOf(StorageShareRepository);
  });

  describe('create', () => {
    it('should create a storage share', async () => {
      mockPrismaStorageShare.create.mockResolvedValue(mockShare);

      const result = await repository.create({ nodeId: 'node-1', mountPoint: '/mnt/nfs' });

      expect(result).toEqual(mockShare);
      expect(mockPrismaStorageShare.create).toHaveBeenCalledWith({
        data: { nodeId: 'node-1', mountPoint: '/mnt/nfs' },
      });
    });
  });

  describe('findById', () => {
    it('should return share when found', async () => {
      mockPrismaStorageShare.findUnique.mockResolvedValue(mockShare);

      const result = await repository.findById('share-1');

      expect(result).toEqual(mockShare);
      expect(mockPrismaStorageShare.findUnique).toHaveBeenCalledWith({ where: { id: 'share-1' } });
    });

    it('should return null when not found', async () => {
      mockPrismaStorageShare.findUnique.mockResolvedValue(null);

      const result = await repository.findById('ghost');

      expect(result).toBeNull();
    });
  });

  describe('findByMountPoint', () => {
    it('should find share by nodeId and mountPoint', async () => {
      mockPrismaStorageShare.findFirst.mockResolvedValue(mockShare);

      const result = await repository.findByMountPoint('node-1', '/mnt/nfs');

      expect(result).toEqual(mockShare);
      expect(mockPrismaStorageShare.findFirst).toHaveBeenCalledWith({
        where: { nodeId: 'node-1', mountPoint: '/mnt/nfs' },
      });
    });

    it('should return null when not found', async () => {
      mockPrismaStorageShare.findFirst.mockResolvedValue(null);

      const result = await repository.findByMountPoint('node-1', '/mnt/unknown');

      expect(result).toBeNull();
    });
  });

  describe('findByNodeId', () => {
    it('should return shares ordered by createdAt desc', async () => {
      mockPrismaStorageShare.findMany.mockResolvedValue([mockShare]);

      const result = await repository.findByNodeId('node-1');

      expect(result).toEqual([mockShare]);
      expect(mockPrismaStorageShare.findMany).toHaveBeenCalledWith({
        where: { nodeId: 'node-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findAll', () => {
    it('should return all shares ordered by createdAt desc', async () => {
      mockPrismaStorageShare.findMany.mockResolvedValue([mockShare]);

      const result = await repository.findAll();

      expect(result).toEqual([mockShare]);
      expect(mockPrismaStorageShare.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findByStatus', () => {
    it('should return shares filtered by status', async () => {
      mockPrismaStorageShare.findMany.mockResolvedValue([mockShare]);

      const result = await repository.findByStatus(StorageShareStatus.MOUNTED);

      expect(result).toEqual([mockShare]);
      expect(mockPrismaStorageShare.findMany).toHaveBeenCalledWith({
        where: { status: StorageShareStatus.MOUNTED },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findAutoManagedByNodeId', () => {
    it('should return auto-managed shares for a node', async () => {
      mockPrismaStorageShare.findMany.mockResolvedValue([]);

      const result = await repository.findAutoManagedByNodeId('node-1');

      expect(result).toEqual([]);
      expect(mockPrismaStorageShare.findMany).toHaveBeenCalledWith({
        where: { nodeId: 'node-1', autoManaged: true },
      });
    });
  });

  describe('update', () => {
    it('should update a share', async () => {
      const updated = { ...mockShare, mountPoint: '/mnt/updated' };
      mockPrismaStorageShare.update.mockResolvedValue(updated);

      const result = await repository.update('share-1', { mountPoint: '/mnt/updated' });

      expect(result).toEqual(updated);
      expect(mockPrismaStorageShare.update).toHaveBeenCalledWith({
        where: { id: 'share-1' },
        data: { mountPoint: '/mnt/updated' },
      });
    });
  });

  describe('updateStatus', () => {
    it('should set isMounted=true and update node when status is MOUNTED', async () => {
      mockPrismaStorageShare.findUnique.mockResolvedValue({ nodeId: 'node-1' });
      mockPrismaNode.update.mockResolvedValue({});
      mockPrismaStorageShare.update.mockResolvedValue({
        ...mockShare,
        status: StorageShareStatus.MOUNTED,
      });

      const result = await repository.updateStatus('share-1', StorageShareStatus.MOUNTED);

      expect(result.status).toBe(StorageShareStatus.MOUNTED);
      expect(mockPrismaNode.update).toHaveBeenCalledWith({
        where: { id: 'node-1' },
        data: { hasSharedStorage: true, networkLocation: 'LOCAL' },
      });
      expect(mockPrismaStorageShare.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'share-1' },
          data: expect.objectContaining({ isMounted: true, status: StorageShareStatus.MOUNTED }),
        })
      );
    });

    it('should set isMounted=false when status is UNMOUNTED', async () => {
      mockPrismaStorageShare.update.mockResolvedValue({
        ...mockShare,
        status: StorageShareStatus.UNMOUNTED,
        isMounted: false,
      });

      const result = await repository.updateStatus('share-1', StorageShareStatus.UNMOUNTED);

      expect(result.isMounted).toBe(false);
      expect(mockPrismaStorageShare.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'share-1' },
          data: expect.objectContaining({ isMounted: false, status: StorageShareStatus.UNMOUNTED }),
        })
      );
    });

    it('should increment errorCount and set lastError when status is ERROR', async () => {
      mockPrismaStorageShare.update.mockResolvedValue({
        ...mockShare,
        status: StorageShareStatus.ERROR,
      });

      await repository.updateStatus('share-1', StorageShareStatus.ERROR, 'mount failed');

      expect(mockPrismaStorageShare.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'share-1' },
          data: expect.objectContaining({
            isMounted: false,
            errorCount: { increment: 1 },
            lastError: 'mount failed',
            status: StorageShareStatus.ERROR,
          }),
        })
      );
    });
  });

  describe('delete', () => {
    it('should delete a share by id', async () => {
      mockPrismaStorageShare.delete.mockResolvedValue(mockShare);

      const result = await repository.delete('share-1');

      expect(result).toEqual(mockShare);
      expect(mockPrismaStorageShare.delete).toHaveBeenCalledWith({ where: { id: 'share-1' } });
    });
  });

  describe('deleteAutoManagedByNodeId', () => {
    it('should delete auto-managed shares and return count', async () => {
      mockPrismaStorageShare.deleteMany.mockResolvedValue({ count: 3 });

      const result = await repository.deleteAutoManagedByNodeId('node-1');

      expect(result).toBe(3);
      expect(mockPrismaStorageShare.deleteMany).toHaveBeenCalledWith({
        where: { nodeId: 'node-1', autoManaged: true },
      });
    });
  });

  describe('countByStatus', () => {
    it('should return counts for all statuses', async () => {
      mockPrismaStorageShare.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(1);

      const result = await repository.countByStatus();

      expect(result).toEqual({ total: 10, mounted: 6, unmounted: 3, error: 1 });
    });
  });

  describe('findMountedByNodeId', () => {
    it('should return mounted shares ordered by lastMountAt desc', async () => {
      mockPrismaStorageShare.findMany.mockResolvedValue([mockShare]);

      const result = await repository.findMountedByNodeId('node-1');

      expect(result).toEqual([mockShare]);
      expect(mockPrismaStorageShare.findMany).toHaveBeenCalledWith({
        where: { nodeId: 'node-1', isMounted: true },
        orderBy: { lastMountAt: 'desc' },
      });
    });
  });

  describe('findByOwnerNodeId', () => {
    it('should return shares by ownerNodeId', async () => {
      mockPrismaStorageShare.findMany.mockResolvedValue([mockShare]);

      const result = await repository.findByOwnerNodeId('node-owner');

      expect(result).toEqual([mockShare]);
      expect(mockPrismaStorageShare.findMany).toHaveBeenCalledWith({
        where: { ownerNodeId: 'node-owner' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findMountPointsByNodeId', () => {
    it('should return only mountPoint field', async () => {
      mockPrismaStorageShare.findMany.mockResolvedValue([{ mountPoint: '/mnt/nfs' }]);

      const result = await repository.findMountPointsByNodeId('node-1');

      expect(result).toEqual([{ mountPoint: '/mnt/nfs' }]);
      expect(mockPrismaStorageShare.findMany).toHaveBeenCalledWith({
        where: { nodeId: 'node-1' },
        select: { mountPoint: true },
      });
    });
  });

  describe('findBySharePath', () => {
    it('should find share by nodeId and sharePath', async () => {
      mockPrismaStorageShare.findFirst.mockResolvedValue(mockShare);

      const result = await repository.findBySharePath('node-1', '/exports/videos');

      expect(result).toEqual(mockShare);
      expect(mockPrismaStorageShare.findFirst).toHaveBeenCalledWith({
        where: { nodeId: 'node-1', sharePath: '/exports/videos' },
      });
    });
  });

  describe('findMountedWithNode', () => {
    it('should return mounted shares with node included', async () => {
      const withNode = { ...mockShare, node: { id: 'node-1', name: 'Main' } };
      mockPrismaStorageShare.findMany.mockResolvedValue([withNode]);

      const result = await repository.findMountedWithNode();

      expect(result).toEqual([withNode]);
      expect(mockPrismaStorageShare.findMany).toHaveBeenCalledWith({
        where: { isMounted: true },
        include: { node: true },
      });
    });
  });

  describe('deleteAllAutoManaged', () => {
    it('should delete all auto-managed shares and return count', async () => {
      mockPrismaStorageShare.deleteMany.mockResolvedValue({ count: 5 });

      const result = await repository.deleteAllAutoManaged();

      expect(result).toBe(5);
      expect(mockPrismaStorageShare.deleteMany).toHaveBeenCalledWith({
        where: { autoManaged: true },
      });
    });
  });
});
