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
});
