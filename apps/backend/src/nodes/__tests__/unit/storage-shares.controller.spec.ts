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

  describe('create', () => {
    it('should create a storage share and return the result', async () => {
      const dto = { nodeId: 'node1', serverAddress: '192.168.1.100', protocol: 'NFS' };
      const created = { id: 'share1', ...dto };
      mockStorageShareService.create.mockResolvedValue(created);

      const result = await controller.create(dto as any);

      expect(mockStorageShareService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(created);
    });

    it('should propagate service errors', async () => {
      mockStorageShareService.create.mockRejectedValue(new Error('duplicate mount point'));
      await expect(controller.create({} as any)).rejects.toThrow('duplicate mount point');
    });
  });

  describe('findAllByNode', () => {
    it('should return all storage shares for a node', async () => {
      const shares = [
        { id: 'share1', nodeId: 'node1' },
        { id: 'share2', nodeId: 'node1' },
      ];
      mockStorageShareService.findAllByNode.mockResolvedValue(shares);

      const result = await controller.findAllByNode('node1');

      expect(mockStorageShareService.findAllByNode).toHaveBeenCalledWith('node1');
      expect(result).toEqual(shares);
    });

    it('should propagate service errors', async () => {
      mockStorageShareService.findAllByNode.mockRejectedValue(new Error('node not found'));
      await expect(controller.findAllByNode('missing')).rejects.toThrow('node not found');
    });
  });

  describe('findMountedByNode', () => {
    it('should return mounted shares for a node', async () => {
      const shares = [{ id: 'share1', nodeId: 'node1', isMounted: true }];
      mockStorageShareService.findMountedByNode.mockResolvedValue(shares);

      const result = await controller.findMountedByNode('node1');

      expect(mockStorageShareService.findMountedByNode).toHaveBeenCalledWith('node1');
      expect(result).toEqual(shares);
    });

    it('should propagate service errors', async () => {
      mockStorageShareService.findMountedByNode.mockRejectedValue(new Error('query error'));
      await expect(controller.findMountedByNode('node1')).rejects.toThrow('query error');
    });
  });

  describe('findOne', () => {
    it('should return a storage share by id', async () => {
      const share = { id: 'share1', nodeId: 'node1', protocol: 'NFS' };
      mockStorageShareService.findOne.mockResolvedValue(share);

      const result = await controller.findOne('share1');

      expect(mockStorageShareService.findOne).toHaveBeenCalledWith('share1');
      expect(result).toEqual(share);
    });

    it('should propagate not found errors', async () => {
      mockStorageShareService.findOne.mockRejectedValue(new Error('not found'));
      await expect(controller.findOne('missing')).rejects.toThrow('not found');
    });
  });

  describe('update', () => {
    it('should update a storage share', async () => {
      const dto = { serverAddress: '192.168.1.200' };
      const updated = { id: 'share1', ...dto };
      mockStorageShareService.update.mockResolvedValue(updated);

      const result = await controller.update('share1', dto as any);

      expect(mockStorageShareService.update).toHaveBeenCalledWith('share1', dto);
      expect(result).toEqual(updated);
    });

    it('should propagate service errors', async () => {
      mockStorageShareService.update.mockRejectedValue(new Error('share not found'));
      await expect(controller.update('missing', {} as any)).rejects.toThrow('share not found');
    });
  });

  describe('delete', () => {
    it('should delete a storage share', async () => {
      mockStorageShareService.delete.mockResolvedValue(undefined);

      await controller.delete('share1');

      expect(mockStorageShareService.delete).toHaveBeenCalledWith('share1');
    });

    it('should propagate errors when share is mounted', async () => {
      mockStorageShareService.delete.mockRejectedValue(new Error('cannot delete mounted share'));
      await expect(controller.delete('share1')).rejects.toThrow('cannot delete mounted share');
    });
  });

  describe('mount', () => {
    it('should mount a storage share', async () => {
      const mountResult = { success: true, mountPoint: '/mnt/media' };
      mockStorageMountService.mount.mockResolvedValue(mountResult);

      const result = await controller.mount('share1');

      expect(mockStorageMountService.mount).toHaveBeenCalledWith('share1');
      expect(result).toEqual(mountResult);
    });

    it('should propagate mount errors', async () => {
      mockStorageMountService.mount.mockRejectedValue(new Error('mount failed'));
      await expect(controller.mount('share1')).rejects.toThrow('mount failed');
    });
  });

  describe('unmount', () => {
    it('should unmount a share without force by default', async () => {
      const unmountResult = { success: true };
      mockStorageMountService.unmount.mockResolvedValue(unmountResult);

      const result = await controller.unmount('share1', undefined);

      expect(mockStorageMountService.unmount).toHaveBeenCalledWith('share1', false);
      expect(result).toEqual(unmountResult);
    });

    it('should unmount with force flag when provided', async () => {
      const unmountResult = { success: true };
      mockStorageMountService.unmount.mockResolvedValue(unmountResult);

      await controller.unmount('share1', { force: true } as any);

      expect(mockStorageMountService.unmount).toHaveBeenCalledWith('share1', true);
    });

    it('should propagate unmount errors', async () => {
      mockStorageMountService.unmount.mockRejectedValue(new Error('busy'));
      await expect(controller.unmount('share1', undefined)).rejects.toThrow('busy');
    });
  });

  describe('remount', () => {
    it('should remount a storage share', async () => {
      const remountResult = { success: true };
      mockStorageMountService.remount.mockResolvedValue(remountResult);

      const result = await controller.remount('share1');

      expect(mockStorageMountService.remount).toHaveBeenCalledWith('share1');
      expect(result).toEqual(remountResult);
    });

    it('should propagate remount errors', async () => {
      mockStorageMountService.remount.mockRejectedValue(new Error('remount failed'));
      await expect(controller.remount('share1')).rejects.toThrow('remount failed');
    });
  });

  describe('testConnectivity', () => {
    it('should test connectivity to storage server', async () => {
      const body = { serverAddress: '192.168.1.100', protocol: 'NFS' };
      const connectResult = { reachable: true, nfsAvailable: true, latencyMs: 2 };
      mockStorageMountService.testConnectivity.mockResolvedValue(connectResult);

      const result = await controller.testConnectivity(body as any);

      expect(mockStorageMountService.testConnectivity).toHaveBeenCalledWith(
        body.serverAddress,
        body.protocol
      );
      expect(result).toEqual(connectResult);
    });

    it('should propagate connectivity errors', async () => {
      mockStorageMountService.testConnectivity.mockRejectedValue(new Error('unreachable'));
      await expect(
        controller.testConnectivity({ serverAddress: 'bad', protocol: 'NFS' } as any)
      ).rejects.toThrow('unreachable');
    });
  });

  describe('getNodeStats', () => {
    it('should return storage statistics for a node', async () => {
      const stats = { totalShares: 3, mountedShares: 2, totalSizeBytes: 1000000 };
      mockStorageShareService.getNodeStats.mockResolvedValue(stats);

      const result = await controller.getNodeStats('node1');

      expect(mockStorageShareService.getNodeStats).toHaveBeenCalledWith('node1');
      expect(result).toEqual(stats);
    });

    it('should propagate service errors', async () => {
      mockStorageShareService.getNodeStats.mockRejectedValue(new Error('node not found'));
      await expect(controller.getNodeStats('missing')).rejects.toThrow('node not found');
    });
  });

  describe('autoDetect', () => {
    it('should auto-detect available storage shares for a node', async () => {
      const detected = [{ serverAddress: '192.168.1.100', exports: ['/mnt/media'] }];
      mockStorageShareService.autoDetectShares.mockResolvedValue(detected);

      const result = await controller.autoDetect('node1');

      expect(mockStorageShareService.autoDetectShares).toHaveBeenCalledWith('node1');
      expect(result).toEqual(detected);
    });

    it('should propagate service errors', async () => {
      mockStorageShareService.autoDetectShares.mockRejectedValue(new Error('scan failed'));
      await expect(controller.autoDetect('node1')).rejects.toThrow('scan failed');
    });
  });

  describe('autoDetectAndMount', () => {
    it('should auto-detect and mount shares from main node', async () => {
      const mountResult = { mounted: 2, created: 1 };
      mockStorageShareService.autoDetectAndMount.mockResolvedValue(mountResult);

      const result = await controller.autoDetectAndMount('node1');

      expect(mockStorageShareService.autoDetectAndMount).toHaveBeenCalledWith('node1');
      expect(result).toEqual(mountResult);
    });

    it('should propagate service errors', async () => {
      mockStorageShareService.autoDetectAndMount.mockRejectedValue(new Error('main unreachable'));
      await expect(controller.autoDetectAndMount('node1')).rejects.toThrow('main unreachable');
    });
  });

  describe('autoExportDockerVolumes', () => {
    it('should auto-export docker volumes and return success', async () => {
      mockNfsAutoExportService.autoExportDockerVolumes.mockResolvedValue(undefined);

      const result = await controller.autoExportDockerVolumes();

      expect(mockNfsAutoExportService.autoExportDockerVolumes).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        success: true,
        message: 'Docker volumes auto-export completed',
      });
    });

    it('should propagate service errors', async () => {
      mockNfsAutoExportService.autoExportDockerVolumes.mockRejectedValue(new Error('docker error'));
      await expect(controller.autoExportDockerVolumes()).rejects.toThrow('docker error');
    });
  });

  describe('createLibraryShares', () => {
    it('should create storage shares for all node libraries', async () => {
      const sharesResult = { created: 3, shares: [] };
      mockStorageShareService.autoCreateSharesForLibraries.mockResolvedValue(sharesResult);

      const result = await controller.createLibraryShares('node1');

      expect(mockStorageShareService.autoCreateSharesForLibraries).toHaveBeenCalledWith('node1');
      expect(result).toEqual(sharesResult);
    });

    it('should propagate service errors', async () => {
      mockStorageShareService.autoCreateSharesForLibraries.mockRejectedValue(
        new Error('node not found')
      );
      await expect(controller.createLibraryShares('missing')).rejects.toThrow('node not found');
    });
  });

  describe('getDiskUsage', () => {
    it('should return disk usage for a mounted share', async () => {
      const share = { id: 'share1', isMounted: true, mountPoint: '/mnt/media' };
      const usage = { totalBytes: 1000000, availableBytes: 500000, usedPercent: 50 };
      mockStorageShareService.findOne.mockResolvedValue(share);
      mockStorageMountService.getDiskUsage.mockResolvedValue(usage);
      mockStorageShareService.updateUsageStats.mockResolvedValue(share);

      const result = await controller.getDiskUsage('share1');

      expect(mockStorageShareService.findOne).toHaveBeenCalledWith('share1');
      expect(mockStorageMountService.getDiskUsage).toHaveBeenCalledWith('/mnt/media');
      expect(mockStorageShareService.updateUsageStats).toHaveBeenCalledWith('share1', {
        totalSizeBytes: usage.totalBytes,
        availableSizeBytes: usage.availableBytes,
        usedPercent: usage.usedPercent,
      });
      expect(result).toEqual(usage);
    });

    it('should throw an error when share is not mounted', async () => {
      const share = { id: 'share1', isMounted: false, mountPoint: null };
      mockStorageShareService.findOne.mockResolvedValue(share);

      await expect(controller.getDiskUsage('share1')).rejects.toThrow(
        'Share must be mounted to get disk usage'
      );
      expect(mockStorageMountService.getDiskUsage).not.toHaveBeenCalled();
    });

    it('should propagate service errors', async () => {
      mockStorageShareService.findOne.mockRejectedValue(new Error('share not found'));
      await expect(controller.getDiskUsage('missing')).rejects.toThrow('share not found');
    });
  });
});
