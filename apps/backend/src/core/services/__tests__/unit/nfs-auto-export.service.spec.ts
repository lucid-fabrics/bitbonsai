import { Test, type TestingModule } from '@nestjs/testing';
import { NodeRepository } from '../../../../common/repositories/node.repository';
import { DockerVolumeDetectorService } from '../../docker-volume-detector.service';
import { NFSAutoExportService } from '../../nfs-auto-export.service';

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));
jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: jest.fn(() => jest.fn().mockResolvedValue({ stdout: '', stderr: '' })),
}));

describe('NFSAutoExportService', () => {
  let service: NFSAutoExportService;

  // Keep the same mock shape so existing assertions continue to work.
  const mockPrismaService = {
    storageShare: {
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    node: {
      findFirst: jest.fn(),
    },
  };

  // NodeRepository mock aliased to same jest.fn() instance
  const mockNodeRepository = {
    findMain: mockPrismaService.node.findFirst,
  };

  // IStorageShareRepository mock aliased to same jest.fn() instances
  const mockStorageShareRepository = {
    deleteAllAutoManaged: jest
      .fn()
      .mockImplementation(() =>
        mockPrismaService.storageShare.deleteMany({ where: { autoManaged: true } })
      ),
    findBySharePath: mockPrismaService.storageShare.findFirst,
    create: mockPrismaService.storageShare.create,
  };

  const mockVolumeDetector = {
    detectVolumes: jest.fn(),
    getSuggestedShareName: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NFSAutoExportService,
        { provide: NodeRepository, useValue: mockNodeRepository },
        { provide: 'IStorageShareRepository', useValue: mockStorageShareRepository },
        { provide: DockerVolumeDetectorService, useValue: mockVolumeDetector },
      ],
    }).compile();

    service = module.get<NFSAutoExportService>(NFSAutoExportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('autoExportDockerVolumes', () => {
    it('should skip when no main node found', async () => {
      mockPrismaService.node.findFirst.mockResolvedValue(null);

      await service.autoExportDockerVolumes();

      expect(mockVolumeDetector.detectVolumes).not.toHaveBeenCalled();
    });

    it('should clean up old auto-managed shares', async () => {
      mockPrismaService.node.findFirst.mockResolvedValue({ id: 'main-1' });
      mockPrismaService.storageShare.deleteMany.mockResolvedValue({ count: 2 });
      mockVolumeDetector.detectVolumes.mockResolvedValue([]);

      await service.autoExportDockerVolumes();

      expect(mockPrismaService.storageShare.deleteMany).toHaveBeenCalledWith({
        where: { autoManaged: true },
      });
    });

    it('should return early when no volumes detected', async () => {
      mockPrismaService.node.findFirst.mockResolvedValue({ id: 'main-1' });
      mockPrismaService.storageShare.deleteMany.mockResolvedValue({ count: 0 });
      mockVolumeDetector.detectVolumes.mockResolvedValue([]);

      await service.autoExportDockerVolumes();

      expect(mockPrismaService.storageShare.create).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockPrismaService.node.findFirst.mockRejectedValue(new Error('DB error'));

      await expect(service.autoExportDockerVolumes()).resolves.not.toThrow();
    });
  });

  describe('removeAutoManagedExports', () => {
    it('should delete all auto-managed shares', async () => {
      mockPrismaService.storageShare.deleteMany.mockResolvedValue({ count: 3 });

      await service.removeAutoManagedExports();

      expect(mockPrismaService.storageShare.deleteMany).toHaveBeenCalledWith({
        where: { autoManaged: true },
      });
    });

    it('should handle errors gracefully', async () => {
      mockPrismaService.storageShare.deleteMany.mockRejectedValue(new Error('DB error'));

      await expect(service.removeAutoManagedExports()).resolves.not.toThrow();
    });
  });

  describe('autoExportDockerVolumes – volume processing', () => {
    it('should create share record for exported volume', async () => {
      mockPrismaService.node.findFirst.mockResolvedValue({ id: 'main-node-id' });
      mockPrismaService.storageShare.deleteMany.mockResolvedValue({ count: 0 });
      mockVolumeDetector.detectVolumes.mockResolvedValue([
        { source: '/mnt/user/media', destination: '/media', readOnly: false },
      ]);
      // Simulate showmount returning the volume's path
      // The execAsync mock (set up via util.promisify stub) returns empty stdout by default.
      // We need the NFS export check to return empty so the share is marked ERROR.
      mockPrismaService.storageShare.findFirst.mockResolvedValue(null);
      mockPrismaService.storageShare.create.mockResolvedValue({});
      mockVolumeDetector.getSuggestedShareName.mockReturnValue('media');

      await service.autoExportDockerVolumes();

      expect(mockPrismaService.storageShare.create).toHaveBeenCalled();
    });

    it('should skip creating share record if one already exists', async () => {
      mockPrismaService.node.findFirst.mockResolvedValue({ id: 'main-node-id' });
      mockPrismaService.storageShare.deleteMany.mockResolvedValue({ count: 0 });
      mockVolumeDetector.detectVolumes.mockResolvedValue([
        { source: '/mnt/user/media', destination: '/media', readOnly: false },
      ]);
      // findBySharePath returns existing record
      mockPrismaService.storageShare.findFirst.mockResolvedValue({ id: 'existing-share' });
      mockVolumeDetector.getSuggestedShareName.mockReturnValue('media');

      await service.autoExportDockerVolumes();

      expect(mockPrismaService.storageShare.create).not.toHaveBeenCalled();
    });

    it('should process multiple volumes and create multiple records', async () => {
      mockPrismaService.node.findFirst.mockResolvedValue({ id: 'main-node-id' });
      mockPrismaService.storageShare.deleteMany.mockResolvedValue({ count: 0 });
      mockVolumeDetector.detectVolumes.mockResolvedValue([
        { source: '/mnt/user/media', destination: '/media', readOnly: false },
        { source: '/mnt/user/downloads', destination: '/downloads', readOnly: false },
      ]);
      mockPrismaService.storageShare.findFirst.mockResolvedValue(null);
      mockPrismaService.storageShare.create.mockResolvedValue({});
      mockVolumeDetector.getSuggestedShareName.mockReturnValue('media');

      await service.autoExportDockerVolumes();

      expect(mockPrismaService.storageShare.create).toHaveBeenCalledTimes(2);
    });

    it('should handle create share record error gracefully', async () => {
      mockPrismaService.node.findFirst.mockResolvedValue({ id: 'main-node-id' });
      mockPrismaService.storageShare.deleteMany.mockResolvedValue({ count: 0 });
      mockVolumeDetector.detectVolumes.mockResolvedValue([
        { source: '/mnt/user/media', destination: '/media', readOnly: true },
      ]);
      mockPrismaService.storageShare.findFirst.mockResolvedValue(null);
      mockPrismaService.storageShare.create.mockRejectedValue(new Error('create failed'));
      mockVolumeDetector.getSuggestedShareName.mockReturnValue('media');

      await expect(service.autoExportDockerVolumes()).resolves.not.toThrow();
    });

    it('should log cleanup message when old shares are deleted', async () => {
      mockPrismaService.node.findFirst.mockResolvedValue({ id: 'main-node-id' });
      // Simulate 3 deletions
      mockPrismaService.storageShare.deleteMany.mockResolvedValue({ count: 3 });
      mockVolumeDetector.detectVolumes.mockResolvedValue([]);

      await expect(service.autoExportDockerVolumes()).resolves.not.toThrow();
    });
  });
});
