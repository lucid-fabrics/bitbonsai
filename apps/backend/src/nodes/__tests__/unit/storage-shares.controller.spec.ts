import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { NFSAutoExportService } from '../../../core/services/nfs-auto-export.service';
import { StorageSharesController } from '../../controllers/storage-shares.controller';
import { StorageMountService } from '../../services/storage-mount.service';
import { StorageShareService } from '../../services/storage-share.service';

describe('StorageSharesController', () => {
  let controller: StorageSharesController;

  const mockStorageShareService = {
    create: jest.fn(),
    findAllByNode: jest.fn(),
    findMountedByNode: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    getNodeStats: jest.fn(),
    autoDetectShares: jest.fn(),
    autoDetectAndMount: jest.fn(),
    autoCreateSharesForLibraries: jest.fn(),
    updateUsageStats: jest.fn(),
  };

  const mockStorageMountService = {
    mount: jest.fn(),
    unmount: jest.fn(),
    remount: jest.fn(),
    testConnectivity: jest.fn(),
    getDiskUsage: jest.fn(),
  };

  const mockNfsAutoExportService = {
    autoExportDockerVolumes: jest.fn(),
  };

  const mockShare = {
    id: 'share-1',
    nodeId: 'node-1',
    protocol: 'NFS' as const,
    serverAddress: '192.168.1.100',
    remotePath: '/mnt/media',
    mountPoint: '/mnt/remote/media',
    isMounted: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorageSharesController],
      providers: [
        { provide: StorageShareService, useValue: mockStorageShareService },
        { provide: StorageMountService, useValue: mockStorageMountService },
        { provide: NFSAutoExportService, useValue: mockNfsAutoExportService },
      ],
    }).compile();

    controller = module.get<StorageSharesController>(StorageSharesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================================================
  // create
  // ============================================================================

  describe('create', () => {
    it('should create a storage share and return result', async () => {
      mockStorageShareService.create.mockResolvedValue(mockShare);
      const createDto = {
        nodeId: 'node-1',
        protocol: 'NFS',
        serverAddress: '192.168.1.100',
        remotePath: '/mnt/media',
        mountPoint: '/mnt/remote/media',
      };

      const result = await controller.create(createDto as any);

      expect(mockStorageShareService.create).toHaveBeenCalledWith(createDto);
      expect(result).toEqual(mockShare);
    });

    it('should propagate errors for invalid configuration', async () => {
      mockStorageShareService.create.mockRejectedValue(new Error('Invalid configuration'));

      await expect(controller.create({} as any)).rejects.toThrow('Invalid configuration');
    });

    it('should propagate errors for duplicate mount point', async () => {
      mockStorageShareService.create.mockRejectedValue(new Error('Duplicate mount point'));

      await expect(controller.create({} as any)).rejects.toThrow('Duplicate mount point');
    });
  });

  // ============================================================================
  // findAllByNode
  // ============================================================================

  describe('findAllByNode', () => {
    it('should return all shares for a node', async () => {
      mockStorageShareService.findAllByNode.mockResolvedValue([mockShare]);

      const result = await controller.findAllByNode('node-1');

      expect(mockStorageShareService.findAllByNode).toHaveBeenCalledWith('node-1');
      expect(result).toEqual([mockShare]);
    });

    it('should return empty array when node has no shares', async () => {
      mockStorageShareService.findAllByNode.mockResolvedValue([]);

      const result = await controller.findAllByNode('node-1');

      expect(result).toEqual([]);
    });
  });

  // ============================================================================
  // findMountedByNode
  // ============================================================================

  describe('findMountedByNode', () => {
    it('should return only mounted shares for a node', async () => {
      const mountedShare = { ...mockShare, isMounted: true };
      mockStorageShareService.findMountedByNode.mockResolvedValue([mountedShare]);

      const result = await controller.findMountedByNode('node-1');

      expect(mockStorageShareService.findMountedByNode).toHaveBeenCalledWith('node-1');
      expect(result).toEqual([mountedShare]);
    });

    it('should return empty array when no shares are mounted', async () => {
      mockStorageShareService.findMountedByNode.mockResolvedValue([]);

      const result = await controller.findMountedByNode('node-1');

      expect(result).toEqual([]);
    });
  });

  // ============================================================================
  // findOne
  // ============================================================================

  describe('findOne', () => {
    it('should return a specific share by ID', async () => {
      mockStorageShareService.findOne.mockResolvedValue(mockShare);

      const result = await controller.findOne('share-1');

      expect(mockStorageShareService.findOne).toHaveBeenCalledWith('share-1');
      expect(result).toEqual(mockShare);
    });

    it('should propagate NotFoundException for unknown share', async () => {
      mockStorageShareService.findOne.mockRejectedValue(new NotFoundException('Share not found'));

      await expect(controller.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================================
  // update
  // ============================================================================

  describe('update', () => {
    it('should update a share and return updated data', async () => {
      const updated = { ...mockShare, serverAddress: '192.168.1.200' };
      mockStorageShareService.update.mockResolvedValue(updated);
      const updateDto = { serverAddress: '192.168.1.200' };

      const result = await controller.update('share-1', updateDto as any);

      expect(mockStorageShareService.update).toHaveBeenCalledWith('share-1', updateDto);
      expect(result).toEqual(updated);
    });

    it('should propagate NotFoundException for unknown share', async () => {
      mockStorageShareService.update.mockRejectedValue(new NotFoundException('Share not found'));

      await expect(controller.update('missing', {} as any)).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================================
  // delete
  // ============================================================================

  describe('delete', () => {
    it('should delete a share', async () => {
      mockStorageShareService.delete.mockResolvedValue(undefined);

      await controller.delete('share-1');

      expect(mockStorageShareService.delete).toHaveBeenCalledWith('share-1');
    });

    it('should propagate NotFoundException for unknown share', async () => {
      mockStorageShareService.delete.mockRejectedValue(new NotFoundException('Share not found'));

      await expect(controller.delete('missing')).rejects.toThrow(NotFoundException);
    });

    it('should propagate errors when trying to delete a mounted share', async () => {
      mockStorageShareService.delete.mockRejectedValue(new Error('Cannot delete mounted share'));

      await expect(controller.delete('share-1')).rejects.toThrow('Cannot delete mounted share');
    });
  });

  // ============================================================================
  // mount
  // ============================================================================

  describe('mount', () => {
    it('should mount a share and return result', async () => {
      const mountResult = { ...mockShare, isMounted: true };
      mockStorageMountService.mount.mockResolvedValue(mountResult);

      const result = await controller.mount('share-1');

      expect(mockStorageMountService.mount).toHaveBeenCalledWith('share-1');
      expect(result).toEqual(mountResult);
    });

    it('should propagate NotFoundException for unknown share', async () => {
      mockStorageMountService.mount.mockRejectedValue(new NotFoundException('Share not found'));

      await expect(controller.mount('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================================
  // unmount
  // ============================================================================

  describe('unmount', () => {
    it('should unmount a share with force=false by default when no body provided', async () => {
      const unmountResult = { ...mockShare, isMounted: false };
      mockStorageMountService.unmount.mockResolvedValue(unmountResult);

      const result = await controller.unmount('share-1');

      expect(mockStorageMountService.unmount).toHaveBeenCalledWith('share-1', false);
      expect(result).toEqual(unmountResult);
    });

    it('should unmount with force=true when body specifies it', async () => {
      mockStorageMountService.unmount.mockResolvedValue({ ...mockShare, isMounted: false });

      await controller.unmount('share-1', { force: true } as any);

      expect(mockStorageMountService.unmount).toHaveBeenCalledWith('share-1', true);
    });

    it('should propagate NotFoundException for unknown share', async () => {
      mockStorageMountService.unmount.mockRejectedValue(new NotFoundException('Share not found'));

      await expect(controller.unmount('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================================
  // remount
  // ============================================================================

  describe('remount', () => {
    it('should remount a share', async () => {
      const remountResult = { ...mockShare, isMounted: true };
      mockStorageMountService.remount.mockResolvedValue(remountResult);

      const result = await controller.remount('share-1');

      expect(mockStorageMountService.remount).toHaveBeenCalledWith('share-1');
      expect(result).toEqual(remountResult);
    });

    it('should propagate NotFoundException for unknown share', async () => {
      mockStorageMountService.remount.mockRejectedValue(new NotFoundException('Share not found'));

      await expect(controller.remount('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================================
  // testConnectivity
  // ============================================================================

  describe('testConnectivity', () => {
    it('should test connectivity and return result', async () => {
      const connectResult = { reachable: true, nfsSupported: true, smbSupported: false };
      mockStorageMountService.testConnectivity.mockResolvedValue(connectResult);
      const body = { serverAddress: '192.168.1.100', protocol: 'NFS' as const };

      const result = await controller.testConnectivity(body as any);

      expect(mockStorageMountService.testConnectivity).toHaveBeenCalledWith('192.168.1.100', 'NFS');
      expect(result).toEqual(connectResult);
    });

    it('should propagate errors for unreachable server', async () => {
      mockStorageMountService.testConnectivity.mockRejectedValue(new Error('Host unreachable'));

      await expect(
        controller.testConnectivity({ serverAddress: 'bad-host', protocol: 'NFS' as const } as any)
      ).rejects.toThrow('Host unreachable');
    });
  });

  // ============================================================================
  // getNodeStats
  // ============================================================================

  describe('getNodeStats', () => {
    it('should return storage statistics for a node', async () => {
      const stats = { totalShares: 2, mountedShares: 1, totalSizeBytes: 1000000 };
      mockStorageShareService.getNodeStats.mockResolvedValue(stats);

      const result = await controller.getNodeStats('node-1');

      expect(mockStorageShareService.getNodeStats).toHaveBeenCalledWith('node-1');
      expect(result).toEqual(stats);
    });

    it('should propagate errors for unknown node', async () => {
      mockStorageShareService.getNodeStats.mockRejectedValue(new Error('Node not found'));

      await expect(controller.getNodeStats('missing')).rejects.toThrow('Node not found');
    });
  });

  // ============================================================================
  // autoDetect
  // ============================================================================

  describe('autoDetect', () => {
    it('should auto-detect available shares for a node', async () => {
      const detected = [{ serverAddress: '192.168.1.100', remotePath: '/mnt/media' }];
      mockStorageShareService.autoDetectShares.mockResolvedValue(detected);

      const result = await controller.autoDetect('node-1');

      expect(mockStorageShareService.autoDetectShares).toHaveBeenCalledWith('node-1');
      expect(result).toEqual(detected);
    });

    it('should return empty array when no shares detected', async () => {
      mockStorageShareService.autoDetectShares.mockResolvedValue([]);

      const result = await controller.autoDetect('node-1');

      expect(result).toEqual([]);
    });
  });

  // ============================================================================
  // autoDetectAndMount
  // ============================================================================

  describe('autoDetectAndMount', () => {
    it('should auto-detect and mount shares', async () => {
      const mountResult = { mounted: 2, skipped: 0 };
      mockStorageShareService.autoDetectAndMount.mockResolvedValue(mountResult);

      const result = await controller.autoDetectAndMount('node-1');

      expect(mockStorageShareService.autoDetectAndMount).toHaveBeenCalledWith('node-1');
      expect(result).toEqual(mountResult);
    });

    it('should propagate errors from underlying service', async () => {
      mockStorageShareService.autoDetectAndMount.mockRejectedValue(new Error('Detection failed'));

      await expect(controller.autoDetectAndMount('node-1')).rejects.toThrow('Detection failed');
    });
  });

  // ============================================================================
  // autoExportDockerVolumes
  // ============================================================================

  describe('autoExportDockerVolumes', () => {
    it('should auto-export Docker volumes and return success', async () => {
      mockNfsAutoExportService.autoExportDockerVolumes.mockResolvedValue(undefined);

      const result = await controller.autoExportDockerVolumes();

      expect(mockNfsAutoExportService.autoExportDockerVolumes).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, message: 'Docker volumes auto-export completed' });
    });

    it('should propagate errors from NFS export service', async () => {
      mockNfsAutoExportService.autoExportDockerVolumes.mockRejectedValue(
        new Error('NFS export failed')
      );

      await expect(controller.autoExportDockerVolumes()).rejects.toThrow('NFS export failed');
    });
  });

  // ============================================================================
  // createLibraryShares
  // ============================================================================

  describe('createLibraryShares', () => {
    it('should create library shares for a node', async () => {
      const result = { created: 3 };
      mockStorageShareService.autoCreateSharesForLibraries.mockResolvedValue(result);

      const res = await controller.createLibraryShares('node-1');

      expect(mockStorageShareService.autoCreateSharesForLibraries).toHaveBeenCalledWith('node-1');
      expect(res).toEqual(result);
    });

    it('should propagate errors for unknown node', async () => {
      mockStorageShareService.autoCreateSharesForLibraries.mockRejectedValue(
        new Error('Node not found')
      );

      await expect(controller.createLibraryShares('missing')).rejects.toThrow('Node not found');
    });
  });

  // ============================================================================
  // getDiskUsage
  // ============================================================================

  describe('getDiskUsage', () => {
    it('should return disk usage for a mounted share', async () => {
      const mountedShare = { ...mockShare, isMounted: true, mountPoint: '/mnt/remote/media' };
      const usage = { totalBytes: 1000000, availableBytes: 500000, usedPercent: 50 };
      mockStorageShareService.findOne.mockResolvedValue(mountedShare);
      mockStorageMountService.getDiskUsage.mockResolvedValue(usage);
      mockStorageShareService.updateUsageStats.mockResolvedValue(undefined);

      const result = await controller.getDiskUsage('share-1');

      expect(mockStorageShareService.findOne).toHaveBeenCalledWith('share-1');
      expect(mockStorageMountService.getDiskUsage).toHaveBeenCalledWith('/mnt/remote/media');
      expect(mockStorageShareService.updateUsageStats).toHaveBeenCalledWith('share-1', {
        totalSizeBytes: usage.totalBytes,
        availableSizeBytes: usage.availableBytes,
        usedPercent: usage.usedPercent,
      });
      expect(result).toEqual(usage);
    });

    it('should throw an error when share is not mounted', async () => {
      mockStorageShareService.findOne.mockResolvedValue(mockShare); // isMounted: false

      await expect(controller.getDiskUsage('share-1')).rejects.toThrow(
        'Share must be mounted to get disk usage'
      );

      expect(mockStorageMountService.getDiskUsage).not.toHaveBeenCalled();
    });

    it('should propagate NotFoundException for unknown share', async () => {
      mockStorageShareService.findOne.mockRejectedValue(new NotFoundException('Share not found'));

      await expect(controller.getDiskUsage('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
