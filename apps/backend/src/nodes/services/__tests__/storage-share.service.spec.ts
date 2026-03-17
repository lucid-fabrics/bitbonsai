import { HttpService } from '@nestjs/axios';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { StorageProtocol, StorageShareStatus } from '@prisma/client';
import { EncryptionService } from '../../../core/services/encryption.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageMountService } from '../storage-mount.service';
import { StorageShareService } from '../storage-share.service';

describe('StorageShareService', () => {
  let service: StorageShareService;

  const mockRepository = {
    create: jest.fn(),
    findById: jest.fn(),
    findByMountPoint: jest.fn(),
    findByNodeId: jest.fn(),
    findMountedByNodeId: jest.fn(),
    findByOwnerNodeId: jest.fn(),
    findAutoManagedByNodeId: jest.fn(),
    findMountPointsByNodeId: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const mockPrismaService = {
    node: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockEncryptionService = {
    encrypt: jest.fn().mockReturnValue('encrypted-password'),
  };

  const mockMountService = {
    mount: jest.fn(),
  };

  const mockHttpService = {
    get: jest.fn(),
  };

  const baseShare = {
    id: 'share-1',
    nodeId: 'node-1',
    name: 'Media Share',
    protocol: StorageProtocol.NFS,
    status: StorageShareStatus.AVAILABLE,
    serverAddress: '192.168.1.100',
    sharePath: '/mnt/media',
    exportPath: '192.168.1.100:/mnt/media',
    mountPoint: '/media',
    isMounted: false,
    readOnly: true,
    mountOptions: null,
    smbUsername: null,
    smbPassword: null,
    smbDomain: null,
    smbVersion: null,
    autoMount: true,
    addToFstab: true,
    mountOnDetection: true,
    autoManaged: false,
    ownerNodeId: null,
    totalSizeBytes: 1000000n,
    availableSizeBytes: 600000n,
    usedPercent: null,
    errorCount: 0,
    lastError: null,
    lastMountAt: null,
    lastUnmountAt: null,
    lastHealthCheckAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageShareService,
        { provide: 'IStorageShareRepository', useValue: mockRepository },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: StorageMountService, useValue: mockMountService },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    service = module.get<StorageShareService>(StorageShareService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create NFS share with correct export path', async () => {
      mockRepository.findByMountPoint.mockResolvedValue(null);
      mockRepository.create.mockResolvedValue(baseShare);

      const result = await service.create({
        nodeId: 'node-1',
        name: 'Media Share',
        protocol: StorageProtocol.NFS,
        serverAddress: '192.168.1.100',
        sharePath: '/mnt/media',
        mountPoint: '/media',
      });

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          exportPath: '192.168.1.100:/mnt/media',
          protocol: StorageProtocol.NFS,
        })
      );
      expect(result).toEqual(baseShare);
    });

    it('should create SMB share with correct export path', async () => {
      mockRepository.findByMountPoint.mockResolvedValue(null);
      mockRepository.create.mockResolvedValue({ ...baseShare, protocol: StorageProtocol.SMB });

      await service.create({
        nodeId: 'node-1',
        name: 'SMB Share',
        protocol: StorageProtocol.SMB,
        serverAddress: '192.168.1.100',
        sharePath: 'media',
        mountPoint: '/media',
        smbUsername: 'user',
        smbPassword: 'pass',
      });

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          exportPath: '\\\\192.168.1.100\\media',
          smbPassword: 'encrypted-password',
        })
      );
    });

    it('should throw BadRequestException for SMB without username', async () => {
      await expect(
        service.create({
          nodeId: 'node-1',
          name: 'SMB Share',
          protocol: StorageProtocol.SMB,
          serverAddress: '192.168.1.100',
          sharePath: 'media',
          mountPoint: '/media',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for duplicate mount point', async () => {
      mockRepository.findByMountPoint.mockResolvedValue(baseShare);

      await expect(
        service.create({
          nodeId: 'node-1',
          name: 'Dup Share',
          protocol: StorageProtocol.NFS,
          serverAddress: '192.168.1.100',
          sharePath: '/mnt/media',
          mountPoint: '/media',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should use default values for optional fields', async () => {
      mockRepository.findByMountPoint.mockResolvedValue(null);
      mockRepository.create.mockResolvedValue(baseShare);

      await service.create({
        nodeId: 'node-1',
        name: 'Test',
        protocol: StorageProtocol.NFS,
        serverAddress: '192.168.1.100',
        sharePath: '/mnt',
        mountPoint: '/media',
      });

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          readOnly: true,
          autoMount: true,
          addToFstab: true,
          mountOnDetection: true,
          autoManaged: false,
        })
      );
    });
  });

  describe('findOne', () => {
    it('should return share when found', async () => {
      mockRepository.findById.mockResolvedValue(baseShare);

      const result = await service.findOne('share-1');
      expect(result).toEqual(baseShare);
    });

    it('should throw NotFoundException when not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update share with encrypted password', async () => {
      mockRepository.findById.mockResolvedValue(baseShare);
      mockRepository.update.mockResolvedValue({ ...baseShare, name: 'Updated' });

      const _result = await service.update('share-1', {
        name: 'Updated',
        smbPassword: 'new-pass',
      });

      expect(mockRepository.update).toHaveBeenCalledWith(
        'share-1',
        expect.objectContaining({
          name: 'Updated',
          smbPassword: 'encrypted-password',
        })
      );
    });

    it('should not encrypt password when not provided', async () => {
      mockRepository.findById.mockResolvedValue(baseShare);
      mockRepository.update.mockResolvedValue({ ...baseShare, name: 'Updated' });

      await service.update('share-1', { name: 'Updated' });

      expect(mockRepository.update).toHaveBeenCalledWith(
        'share-1',
        expect.objectContaining({
          smbPassword: undefined,
        })
      );
    });
  });

  describe('updateStatus', () => {
    it('should set isMounted=true and reset errors for MOUNTED status', async () => {
      mockRepository.findById.mockResolvedValue(baseShare);
      mockPrismaService.node.update.mockResolvedValue({});
      mockRepository.update.mockResolvedValue({});

      await service.updateStatus('share-1', StorageShareStatus.MOUNTED);

      expect(mockRepository.update).toHaveBeenCalledWith(
        'share-1',
        expect.objectContaining({
          status: StorageShareStatus.MOUNTED,
          isMounted: true,
          errorCount: 0,
          lastError: null,
        })
      );
    });

    it('should auto-set hasSharedStorage on node when mounting', async () => {
      mockRepository.findById.mockResolvedValue(baseShare);
      mockPrismaService.node.update.mockResolvedValue({});
      mockRepository.update.mockResolvedValue({});

      await service.updateStatus('share-1', StorageShareStatus.MOUNTED);

      expect(mockPrismaService.node.update).toHaveBeenCalledWith({
        where: { id: 'node-1' },
        data: { hasSharedStorage: true, networkLocation: 'LOCAL' },
      });
    });

    it('should set isMounted=false for UNMOUNTED status', async () => {
      mockRepository.update.mockResolvedValue({});

      await service.updateStatus('share-1', StorageShareStatus.UNMOUNTED);

      expect(mockRepository.update).toHaveBeenCalledWith(
        'share-1',
        expect.objectContaining({
          status: StorageShareStatus.UNMOUNTED,
          isMounted: false,
        })
      );
    });

    it('should increment errorCount for ERROR status', async () => {
      mockRepository.update.mockResolvedValue({});

      await service.updateStatus('share-1', StorageShareStatus.ERROR, 'Connection lost');

      expect(mockRepository.update).toHaveBeenCalledWith(
        'share-1',
        expect.objectContaining({
          status: StorageShareStatus.ERROR,
          isMounted: false,
          errorCount: { increment: 1 },
          lastError: 'Connection lost',
        })
      );
    });

    it('should not modify isMounted for AVAILABLE status', async () => {
      mockRepository.update.mockResolvedValue({});

      await service.updateStatus('share-1', StorageShareStatus.AVAILABLE);

      const updateCall = mockRepository.update.mock.calls[0][1];
      expect(updateCall).not.toHaveProperty('isMounted');
      expect(updateCall).not.toHaveProperty('errorCount');
    });
  });

  describe('delete', () => {
    it('should delete unmounted share', async () => {
      mockRepository.findById.mockResolvedValue({ ...baseShare, isMounted: false });
      mockRepository.delete.mockResolvedValue({});

      await service.delete('share-1');

      expect(mockRepository.delete).toHaveBeenCalledWith('share-1');
    });

    it('should throw BadRequestException for mounted share', async () => {
      mockRepository.findById.mockResolvedValue({ ...baseShare, isMounted: true });

      await expect(service.delete('share-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getNodeStats', () => {
    it('should calculate correct statistics', async () => {
      mockRepository.findByNodeId.mockResolvedValue([
        { ...baseShare, isMounted: true, status: StorageShareStatus.MOUNTED },
        {
          ...baseShare,
          id: 'share-2',
          isMounted: false,
          status: StorageShareStatus.AVAILABLE,
          totalSizeBytes: 2000000n,
          availableSizeBytes: 1000000n,
        },
        {
          ...baseShare,
          id: 'share-3',
          isMounted: false,
          status: StorageShareStatus.ERROR,
          totalSizeBytes: null,
          availableSizeBytes: null,
        },
      ]);

      const stats = await service.getNodeStats('node-1');

      expect(stats.totalShares).toBe(3);
      expect(stats.mountedShares).toBe(1);
      expect(stats.availableShares).toBe(1);
      expect(stats.errorShares).toBe(1);
      expect(stats.totalCapacityBytes).toBe(3000000n);
      expect(stats.usedCapacityBytes).toBe(1400000n);
    });

    it('should return zero stats for node with no shares', async () => {
      mockRepository.findByNodeId.mockResolvedValue([]);

      const stats = await service.getNodeStats('node-1');

      expect(stats.totalShares).toBe(0);
      expect(stats.totalCapacityBytes).toBe(0n);
    });
  });

  describe('autoDetectShares', () => {
    it('should return shared-by-main shares for MAIN node', async () => {
      mockPrismaService.node.findUnique.mockResolvedValue({
        id: 'node-1',
        role: 'MAIN',
      });
      mockRepository.findByOwnerNodeId.mockResolvedValue([baseShare]);
      mockRepository.findMountPointsByNodeId.mockResolvedValue([]);

      const result = await service.autoDetectShares('node-1');

      expect(result).toHaveLength(1);
    });

    it('should filter out already-configured shares', async () => {
      mockPrismaService.node.findUnique.mockResolvedValue({
        id: 'node-1',
        role: 'MAIN',
      });
      mockRepository.findByOwnerNodeId.mockResolvedValue([baseShare]);
      mockRepository.findMountPointsByNodeId.mockResolvedValue([{ mountPoint: '/media' }]);

      const result = await service.autoDetectShares('node-1');

      expect(result).toHaveLength(0);
    });

    it('should return empty for LINKED node without mainNodeUrl', async () => {
      mockPrismaService.node.findUnique.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: null,
      });

      const result = await service.autoDetectShares('node-2');

      expect(result).toHaveLength(0);
    });

    it('should throw NotFoundException for unknown node', async () => {
      mockPrismaService.node.findUnique.mockResolvedValue(null);

      await expect(service.autoDetectShares('bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
