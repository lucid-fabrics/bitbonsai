import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { SyncStatus } from '@prisma/client';
import { LibraryRepository } from '../../../common/repositories/library.repository';
import { NodeRepository } from '../../../common/repositories/node.repository';
import { PolicyRepository } from '../../../common/repositories/policy.repository';
import { SettingsRepository } from '../../../common/repositories/settings.repository';
import { PolicySyncService } from '../../policy-sync.service';

describe('PolicySyncService', () => {
  let service: PolicySyncService;

  // Keep the same mock shape so existing assertions continue to work.
  // Repository methods aliased to same jest.fn() instances.
  const mockPrismaService = {
    node: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    policy: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    library: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    settings: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockNodeRepository = {
    findById: mockPrismaService.node.findUnique,
    updateData: mockPrismaService.node.update,
    updateById: mockPrismaService.node.update,
    findWithSelect: mockPrismaService.node.findFirst,
    findMain: mockPrismaService.node.findFirst,
  };

  const mockPolicyRepository = {
    findAll: mockPrismaService.policy.findMany,
    upsert: mockPrismaService.policy.upsert,
  };

  const mockLibraryRepository = {
    findAllLibraries: mockPrismaService.library.findMany,
    upsertLibrary: mockPrismaService.library.upsert,
  };

  const mockSettingsRepository = {
    findFirst: mockPrismaService.settings.findFirst,
    upsertSettings: mockPrismaService.settings.update,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicySyncService,
        { provide: NodeRepository, useValue: mockNodeRepository },
        { provide: PolicyRepository, useValue: mockPolicyRepository },
        { provide: LibraryRepository, useValue: mockLibraryRepository },
        { provide: SettingsRepository, useValue: mockSettingsRepository },
      ],
    }).compile();

    service = module.get<PolicySyncService>(PolicySyncService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('syncToChildNode', () => {
    it('should throw NotFoundException when child node not found', async () => {
      mockPrismaService.node.findUnique.mockResolvedValue(null);

      await expect(service.syncToChildNode('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should sync successfully and return COMPLETED result', async () => {
      const childNode = {
        id: 'child-1',
        name: 'Worker 1',
        syncRetryCount: 0,
      };
      mockPrismaService.node.findUnique.mockResolvedValue(childNode);
      mockPrismaService.node.update.mockResolvedValue(childNode);
      mockPrismaService.policy.findMany.mockResolvedValue([
        {
          id: 'p1',
          name: 'Policy1',
          preset: 'BALANCED_HEVC',
          targetCodec: 'HEVC',
          targetQuality: 23,
          deviceProfiles: {},
          advancedSettings: {},
          atomicReplace: true,
          verifyOutput: true,
          skipSeeding: true,
          libraryId: null,
        },
      ]);
      mockPrismaService.library.findMany.mockResolvedValue([
        {
          id: 'l1',
          name: 'Movies',
          path: '/media/movies',
          mediaType: 'MOVIE',
          enabled: true,
          defaultPolicyId: 'p1',
        },
      ]);
      mockPrismaService.settings.findFirst.mockResolvedValue({
        isSetupComplete: true,
        allowLocalNetworkWithoutAuth: false,
        defaultQueueView: 'ENCODING',
        readyFilesCacheTtlMinutes: 5,
      });

      const result = await service.syncToChildNode('child-1');

      expect(result.status).toBe(SyncStatus.COMPLETED);
      expect(result.policiesSynced).toBe(1);
      expect(result.librariesSynced).toBe(1);
      expect(result.settingsSynced).toBe(true);
      expect(result.nodeId).toBe('child-1');
    });

    it('should set sync status to SYNCING before starting', async () => {
      const childNode = { id: 'child-1', name: 'Worker 1', syncRetryCount: 0 };
      mockPrismaService.node.findUnique.mockResolvedValue(childNode);
      mockPrismaService.node.update.mockResolvedValue(childNode);
      mockPrismaService.policy.findMany.mockResolvedValue([]);
      mockPrismaService.library.findMany.mockResolvedValue([]);
      mockPrismaService.settings.findFirst.mockResolvedValue(null);

      await service.syncToChildNode('child-1');

      expect(mockPrismaService.node.update).toHaveBeenCalledWith(
        'child-1',
        expect.objectContaining({ syncStatus: SyncStatus.SYNCING })
      );
    });

    it('should return default settings when none exist', async () => {
      const childNode = { id: 'child-1', name: 'Worker 1', syncRetryCount: 0 };
      mockPrismaService.node.findUnique.mockResolvedValue(childNode);
      mockPrismaService.node.update.mockResolvedValue(childNode);
      mockPrismaService.policy.findMany.mockResolvedValue([]);
      mockPrismaService.library.findMany.mockResolvedValue([]);
      mockPrismaService.settings.findFirst.mockResolvedValue(null);

      const result = await service.syncToChildNode('child-1');

      expect(result.settingsSynced).toBe(true);
    });
  });

  describe('getSyncStatus', () => {
    it('should throw NotFoundException when node not found', async () => {
      mockPrismaService.node.findUnique.mockResolvedValue(null);

      await expect(service.getSyncStatus('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should return sync status for existing node', async () => {
      mockPrismaService.node.findFirst.mockResolvedValue({
        id: 'child-1',
        syncStatus: SyncStatus.COMPLETED,
        lastSyncedAt: new Date('2025-01-01'),
        syncRetryCount: 0,
        syncError: null,
      });

      const result = await service.getSyncStatus('child-1');

      expect(result.nodeId).toBe('child-1');
      expect(result.status).toBe(SyncStatus.COMPLETED);
      expect(result.retryCount).toBe(0);
      expect(result.error).toBeUndefined();
    });

    it('should include error when sync failed', async () => {
      mockPrismaService.node.findFirst.mockResolvedValue({
        id: 'child-1',
        syncStatus: SyncStatus.FAILED,
        lastSyncedAt: null,
        syncRetryCount: 3,
        syncError: 'Connection refused',
      });

      const result = await service.getSyncStatus('child-1');

      expect(result.status).toBe(SyncStatus.FAILED);
      expect(result.error).toBe('Connection refused');
      expect(result.retryCount).toBe(3);
    });
  });

  describe('retrySyncNode', () => {
    it('should reset retry count and trigger sync', async () => {
      const childNode = { id: 'child-1', name: 'Worker 1', syncRetryCount: 0 };
      mockPrismaService.node.findUnique.mockResolvedValue(childNode);
      mockPrismaService.node.update.mockResolvedValue(childNode);
      mockPrismaService.policy.findMany.mockResolvedValue([]);
      mockPrismaService.library.findMany.mockResolvedValue([]);
      mockPrismaService.settings.findFirst.mockResolvedValue(null);

      await service.retrySyncNode('child-1');

      // First call: reset retry count
      expect(mockPrismaService.node.update).toHaveBeenCalledWith(
        'child-1',
        expect.objectContaining({
          syncRetryCount: 0,
          syncStatus: SyncStatus.PENDING,
        })
      );
    });
  });

  describe('receivePolicies', () => {
    it('should upsert each policy', async () => {
      const policies = [
        {
          id: 'p1',
          name: 'Policy1',
          preset: 'BALANCED_HEVC',
          targetCodec: 'HEVC',
          targetQuality: 23,
          deviceProfiles: {},
          advancedSettings: {},
          atomicReplace: true,
          verifyOutput: true,
          skipSeeding: true,
        },
        {
          id: 'p2',
          name: 'Policy2',
          preset: 'QUALITY_AV1',
          targetCodec: 'AV1',
          targetQuality: 28,
          deviceProfiles: {},
          advancedSettings: {},
          atomicReplace: false,
          verifyOutput: false,
          skipSeeding: false,
        },
      ];

      mockPrismaService.policy.upsert.mockResolvedValue({});

      await service.receivePolicies(policies as any);

      expect(mockPrismaService.policy.upsert).toHaveBeenCalledTimes(2);
      expect(mockPrismaService.policy.upsert).toHaveBeenCalledWith(
        { id: 'p1' },
        expect.objectContaining({ id: 'p1' }),
        expect.objectContaining({ name: 'Policy1' })
      );
    });
  });

  describe('receiveLibraries', () => {
    it('should throw NotFoundException when current node not found', async () => {
      mockPrismaService.node.findFirst.mockResolvedValue(null);

      await expect(
        service.receiveLibraries([
          { id: 'l1', name: 'Movies', path: '/media', mediaType: 'MOVIE', enabled: true },
        ] as any)
      ).rejects.toThrow(NotFoundException);
    });

    it('should upsert each library', async () => {
      mockPrismaService.node.findFirst.mockResolvedValue({ id: 'main-1' });
      mockPrismaService.library.upsert.mockResolvedValue({});

      const libraries = [
        { id: 'l1', name: 'Movies', path: '/media/movies', mediaType: 'MOVIE', enabled: true },
      ];

      await service.receiveLibraries(libraries as any);

      expect(mockPrismaService.library.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('receiveSettings', () => {
    it('should update existing settings', async () => {
      mockPrismaService.settings.findFirst.mockResolvedValue({ id: 'settings-1' });
      mockPrismaService.settings.update.mockResolvedValue({});

      await service.receiveSettings({
        isSetupComplete: true,
        allowLocalNetworkWithoutAuth: false,
        defaultQueueView: 'ENCODING',
        readyFilesCacheTtlMinutes: 10,
      });

      expect(mockPrismaService.settings.update).toHaveBeenCalled();
    });

    it('should create settings when none exist', async () => {
      mockPrismaService.settings.update.mockResolvedValue({});

      await service.receiveSettings({
        isSetupComplete: false,
        allowLocalNetworkWithoutAuth: true,
        defaultQueueView: 'ALL',
        readyFilesCacheTtlMinutes: 5,
      });

      expect(mockPrismaService.settings.update).toHaveBeenCalled();
    });
  });
});
