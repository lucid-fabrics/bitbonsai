import { HttpService } from '@nestjs/axios';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { StorageProtocol, StorageShareStatus } from '@prisma/client';
import { of } from 'rxjs';
import { StorageAutoDetectMountEvent } from '../../../common/events/storage.events';
import { NodeRepository } from '../../../common/repositories/node.repository';
import { EncryptionService } from '../../../core/services/encryption.service';
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

  const mockNodeRepository = {
    findById: jest.fn(),
    updateData: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
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
        { provide: NodeRepository, useValue: mockNodeRepository },
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
      mockNodeRepository.updateData.mockResolvedValue({});
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
      mockNodeRepository.updateData.mockResolvedValue({});
      mockRepository.update.mockResolvedValue({});

      await service.updateStatus('share-1', StorageShareStatus.MOUNTED);

      expect(mockNodeRepository.updateData).toHaveBeenCalledWith(
        'node-1',
        expect.objectContaining({ hasSharedStorage: true })
      );
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
      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-1',
        role: 'MAIN',
      });
      mockRepository.findByOwnerNodeId.mockResolvedValue([baseShare]);
      mockRepository.findMountPointsByNodeId.mockResolvedValue([]);

      const result = await service.autoDetectShares('node-1');

      expect(result).toHaveLength(1);
    });

    it('should filter out already-configured shares', async () => {
      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-1',
        role: 'MAIN',
      });
      mockRepository.findByOwnerNodeId.mockResolvedValue([baseShare]);
      mockRepository.findMountPointsByNodeId.mockResolvedValue([{ mountPoint: '/media' }]);

      const result = await service.autoDetectShares('node-1');

      expect(result).toHaveLength(0);
    });

    it('should return empty for LINKED node without mainNodeUrl', async () => {
      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: null,
      });

      const result = await service.autoDetectShares('node-2');

      expect(result).toHaveLength(0);
    });

    it('should throw NotFoundException for unknown node', async () => {
      mockNodeRepository.findById.mockResolvedValue(null);

      await expect(service.autoDetectShares('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('should return empty and log error when HTTP request to LINKED node fails', async () => {
      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: 'http://main-node',
      });
      mockHttpService.get.mockImplementation(() => {
        throw new Error('Network error');
      });

      const result = await service.autoDetectShares('node-2');
      expect(result).toEqual([]);
    });

    it('should return empty when LINKED node HTTP returns no MAIN node', async () => {
      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: 'http://main-node',
      });
      mockHttpService.get.mockReturnValueOnce(of({ data: [{ id: 'x', role: 'LINKED' }] }));

      const result = await service.autoDetectShares('node-2');
      expect(result).toEqual([]);
    });

    it('should return filtered shares for LINKED node via HTTP', async () => {
      // Use a share without BigInt fields to avoid JSON.stringify issues in service debug logging
      const mainNodeShare = {
        ...baseShare,
        ownerNodeId: 'main-1',
        totalSizeBytes: null,
        availableSizeBytes: null,
      };

      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: 'http://main-node',
      });
      // First call: nodes list
      mockHttpService.get
        .mockReturnValueOnce(of({ data: [{ id: 'main-1', role: 'MAIN' }] }))
        // Second call: shares list
        .mockReturnValueOnce(of({ data: [mainNodeShare] }));

      mockRepository.findMountPointsByNodeId.mockResolvedValue([]);

      const result = await service.autoDetectShares('node-2');
      expect(result).toHaveLength(1);
      expect(result[0].ownerNodeId).toBe('main-1');
    });

    it('should filter out already-existing mount points for LINKED node', async () => {
      const mainNodeShare = {
        ...baseShare,
        ownerNodeId: 'main-1',
        mountPoint: '/media',
        totalSizeBytes: null,
        availableSizeBytes: null,
      };

      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: 'http://main-node',
      });
      mockHttpService.get
        .mockReturnValueOnce(of({ data: [{ id: 'main-1', role: 'MAIN' }] }))
        .mockReturnValueOnce(of({ data: [mainNodeShare] }));

      mockRepository.findMountPointsByNodeId.mockResolvedValue([{ mountPoint: '/media' }]);

      const result = await service.autoDetectShares('node-2');
      expect(result).toHaveLength(0);
    });
  });

  describe('findAllByNode', () => {
    it('should return all shares for a node', async () => {
      mockRepository.findByNodeId.mockResolvedValue([baseShare]);
      const result = await service.findAllByNode('node-1');
      expect(result).toEqual([baseShare]);
      expect(mockRepository.findByNodeId).toHaveBeenCalledWith('node-1');
    });
  });

  describe('findMountedByNode', () => {
    it('should return mounted shares for a node', async () => {
      const mountedShare = { ...baseShare, isMounted: true };
      mockRepository.findMountedByNodeId.mockResolvedValue([mountedShare]);
      const result = await service.findMountedByNode('node-1');
      expect(result).toEqual([mountedShare]);
      expect(mockRepository.findMountedByNodeId).toHaveBeenCalledWith('node-1');
    });
  });

  describe('findSharedByNode', () => {
    it('should return shares owned by a node', async () => {
      mockRepository.findByOwnerNodeId.mockResolvedValue([baseShare]);
      const result = await service.findSharedByNode('node-1');
      expect(result).toEqual([baseShare]);
      expect(mockRepository.findByOwnerNodeId).toHaveBeenCalledWith('node-1');
    });
  });

  describe('updateUsageStats', () => {
    it('should update usage stats', async () => {
      const updated = { ...baseShare, totalSizeBytes: 5000000n, availableSizeBytes: 2000000n };
      mockRepository.update.mockResolvedValue(updated);

      const result = await service.updateUsageStats('share-1', {
        totalSizeBytes: 5000000n,
        availableSizeBytes: 2000000n,
        usedPercent: 60,
      });

      expect(mockRepository.update).toHaveBeenCalledWith('share-1', {
        totalSizeBytes: 5000000n,
        availableSizeBytes: 2000000n,
        usedPercent: 60,
      });
      expect(result).toEqual(updated);
    });
  });

  describe('updateHealthCheck', () => {
    it('should update lastHealthCheckAt', async () => {
      const updated = { ...baseShare, lastHealthCheckAt: new Date() };
      mockRepository.update.mockResolvedValue(updated);

      const result = await service.updateHealthCheck('share-1');

      expect(mockRepository.update).toHaveBeenCalledWith(
        'share-1',
        expect.objectContaining({ lastHealthCheckAt: expect.any(Date) })
      );
      expect(result).toEqual(updated);
    });
  });

  describe('updateStatus - edge cases', () => {
    it('should not update node when share not found during MOUNTED status', async () => {
      mockRepository.findById.mockResolvedValue(null);
      mockRepository.update.mockResolvedValue({ ...baseShare, status: StorageShareStatus.MOUNTED });

      // Should not call nodeRepository.updateData since share is null
      await service.updateStatus('share-1', StorageShareStatus.MOUNTED);

      expect(mockNodeRepository.updateData).not.toHaveBeenCalled();
    });

    it('should set lastError when ERROR status has error message', async () => {
      mockRepository.update.mockResolvedValue({});

      await service.updateStatus('share-1', StorageShareStatus.ERROR, 'Mount failed');

      expect(mockRepository.update).toHaveBeenCalledWith(
        'share-1',
        expect.objectContaining({ lastError: 'Mount failed' })
      );
    });

    it('should not set lastError when ERROR status has no error message', async () => {
      mockRepository.update.mockResolvedValue({});

      await service.updateStatus('share-1', StorageShareStatus.ERROR);

      const updateCall = mockRepository.update.mock.calls[0][1] as Record<string, unknown>;
      expect(updateCall).not.toHaveProperty('lastError');
    });
  });

  describe('delete - NotFoundException', () => {
    it('should throw NotFoundException when share not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.delete('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update - NotFoundException', () => {
    it('should throw NotFoundException when share to update not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.update('nonexistent', { name: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('autoCreateSharesForLibraries', () => {
    it('should return existing auto-managed shares when they exist', async () => {
      mockNodeRepository.findById.mockResolvedValue({ id: 'main-1', role: 'MAIN' });
      mockRepository.findAutoManagedByNodeId.mockResolvedValue([baseShare]);

      const result = await service.autoCreateSharesForLibraries('main-1');
      expect(result).toEqual([baseShare]);
    });

    it('should return empty array when no auto-managed shares found', async () => {
      mockNodeRepository.findById.mockResolvedValue({ id: 'main-1', role: 'MAIN' });
      mockRepository.findAutoManagedByNodeId.mockResolvedValue([]);

      const result = await service.autoCreateSharesForLibraries('main-1');
      expect(result).toEqual([]);
    });

    it('should return empty array when node not found', async () => {
      mockNodeRepository.findById.mockResolvedValue(null);

      const result = await service.autoCreateSharesForLibraries('nonexistent');
      expect(result).toEqual([]);
    });

    it('should return empty array on repository error', async () => {
      mockNodeRepository.findById.mockResolvedValue({ id: 'main-1', role: 'MAIN' });
      mockRepository.findAutoManagedByNodeId.mockRejectedValue(new Error('DB error'));

      const result = await service.autoCreateSharesForLibraries('main-1');
      expect(result).toEqual([]);
    });
  });

  describe('autoDetectAndMount', () => {
    it('should return empty result for non-LINKED node', async () => {
      mockNodeRepository.findById.mockResolvedValue({ id: 'main-1', role: 'MAIN' });

      const result = await service.autoDetectAndMount('main-1');
      expect(result.detected).toBe(0);
      expect(result.created).toBe(0);
      expect(result.mounted).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should return empty result for LINKED node without mainNodeUrl', async () => {
      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: null,
      });

      const result = await service.autoDetectAndMount('node-2');
      expect(result.detected).toBe(0);
    });

    it('should return result with error when node not found', async () => {
      mockNodeRepository.findById.mockResolvedValue(null);

      const result = await service.autoDetectAndMount('nonexistent');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('not found');
    });

    it('should handle failed HTTP fetch to main node gracefully', async () => {
      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: 'http://main-node',
      });

      // Mock global fetch to return error response
      const origFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

      const result = await service.autoDetectAndMount('node-2');
      expect(result.detected).toBe(0);
      expect(result.errors).toHaveLength(0); // returns result, no thrown error

      global.fetch = origFetch;
    });

    it('should count already-mounted share as mounted', async () => {
      const alreadyMounted = {
        ...baseShare,
        isMounted: true,
        autoManaged: true,
        ownerNodeId: 'main-1',
        autoMount: true,
        mountOnDetection: true,
      };

      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: 'http://main-node',
      });

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: 'main-1', role: 'MAIN' }],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [alreadyMounted],
        }) as unknown as typeof fetch;

      mockRepository.findByMountPoint.mockResolvedValue({ ...alreadyMounted, id: 'local-share' });

      const result = await service.autoDetectAndMount('node-2');
      expect(result.detected).toBe(1);
      expect(result.mounted).toBe(1); // counted as mounted since already mounted
    });

    it('should create and mount new share successfully', async () => {
      const autoShare = {
        ...baseShare,
        isMounted: false,
        autoManaged: true,
        ownerNodeId: 'main-1',
        autoMount: true,
        mountOnDetection: true,
        mountOptions: null,
      };

      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: 'http://main-node',
      });

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: 'main-1', role: 'MAIN' }],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [autoShare],
        }) as unknown as typeof fetch;

      mockRepository.findByMountPoint.mockResolvedValue(null);
      mockRepository.create.mockResolvedValue({ ...autoShare, id: 'new-share' });
      mockMountService.mount.mockResolvedValue({ success: true });

      const result = await service.autoDetectAndMount('node-2');
      expect(result.detected).toBe(1);
      expect(result.created).toBe(1);
      expect(result.mounted).toBe(1);
    });

    it('should record mount errors without throwing', async () => {
      const autoShare = {
        ...baseShare,
        isMounted: false,
        autoManaged: true,
        ownerNodeId: 'main-1',
        autoMount: true,
        mountOnDetection: true,
        mountOptions: null,
      };

      mockNodeRepository.findById.mockResolvedValue({
        id: 'node-2',
        role: 'LINKED',
        mainNodeUrl: 'http://main-node',
      });

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: 'main-1', role: 'MAIN' }],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [autoShare],
        }) as unknown as typeof fetch;

      mockRepository.findByMountPoint.mockResolvedValue(null);
      mockRepository.create.mockResolvedValue({ ...autoShare, id: 'new-share' });
      mockMountService.mount.mockResolvedValue({ success: false, error: 'Permission denied' });

      const result = await service.autoDetectAndMount('node-2');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Permission denied');
    });
  });

  describe('getNodeStats - edge cases', () => {
    it('should handle shares with null totalSizeBytes but non-null availableSizeBytes', async () => {
      mockRepository.findByNodeId.mockResolvedValue([
        {
          ...baseShare,
          totalSizeBytes: null,
          availableSizeBytes: 500000n,
        },
      ]);

      const stats = await service.getNodeStats('node-1');
      expect(stats.totalCapacityBytes).toBe(0n);
      expect(stats.usedCapacityBytes).toBe(0n);
    });

    it('should handle shares where both capacity fields are null', async () => {
      mockRepository.findByNodeId.mockResolvedValue([
        {
          ...baseShare,
          totalSizeBytes: null,
          availableSizeBytes: null,
        },
      ]);

      const stats = await service.getNodeStats('node-1');
      expect(stats.totalCapacityBytes).toBe(0n);
      expect(stats.usedCapacityBytes).toBe(0n);
    });

    it('should count shares correctly across all statuses', async () => {
      mockRepository.findByNodeId.mockResolvedValue([
        { ...baseShare, id: 's1', isMounted: true, status: StorageShareStatus.MOUNTED },
        { ...baseShare, id: 's2', isMounted: true, status: StorageShareStatus.MOUNTED },
        { ...baseShare, id: 's3', isMounted: false, status: StorageShareStatus.ERROR },
        {
          ...baseShare,
          id: 's4',
          isMounted: false,
          status: StorageShareStatus.AVAILABLE,
          totalSizeBytes: null,
          availableSizeBytes: null,
        },
      ]);

      const stats = await service.getNodeStats('node-1');
      expect(stats.totalShares).toBe(4);
      expect(stats.mountedShares).toBe(2);
      expect(stats.errorShares).toBe(1);
      expect(stats.availableShares).toBe(1);
    });
  });

  describe('handleAutoDetectMount', () => {
    it('should call autoDetectAndMount and log result', async () => {
      mockNodeRepository.findById.mockResolvedValue({ id: 'node-1', role: 'MAIN' });

      const event = new StorageAutoDetectMountEvent('node-1');

      // Should not throw
      await expect(service.handleAutoDetectMount(event)).resolves.toBeUndefined();
    });

    it('should handle errors in autoDetectAndMount gracefully', async () => {
      mockNodeRepository.findById.mockRejectedValue(new Error('DB down'));

      const event = new StorageAutoDetectMountEvent('node-1');

      // Should not throw, errors are caught internally
      await expect(service.handleAutoDetectMount(event)).resolves.toBeUndefined();
    });
  });
});
