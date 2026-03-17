import { Test, type TestingModule } from '@nestjs/testing';
import { SyncStatus } from '@prisma/client';
import { PolicySyncService } from '../../policy-sync.service';
import { SyncController } from '../../sync.controller';

describe('SyncController', () => {
  let controller: SyncController;

  const mockSyncService = {
    syncToChildNode: jest.fn(),
    getSyncStatus: jest.fn(),
    retrySyncNode: jest.fn(),
    receivePolicies: jest.fn(),
    receiveLibraries: jest.fn(),
    receiveSettings: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [{ provide: PolicySyncService, useValue: mockSyncService }],
    }).compile();

    controller = module.get<SyncController>(SyncController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('syncNode', () => {
    it('should delegate to syncService.syncToChildNode', async () => {
      const syncResult = {
        nodeId: 'child-1',
        status: SyncStatus.COMPLETED,
        policiesSynced: 5,
        librariesSynced: 3,
        settingsSynced: true,
        syncedAt: new Date(),
      };
      mockSyncService.syncToChildNode.mockResolvedValue(syncResult);

      const result = await controller.syncNode('child-1');

      expect(result).toEqual(syncResult);
      expect(mockSyncService.syncToChildNode).toHaveBeenCalledWith('child-1');
    });
  });

  describe('getSyncStatus', () => {
    it('should delegate to syncService.getSyncStatus', async () => {
      const status = {
        nodeId: 'child-1',
        status: SyncStatus.COMPLETED,
        lastSyncedAt: new Date(),
        retryCount: 0,
      };
      mockSyncService.getSyncStatus.mockResolvedValue(status);

      const result = await controller.getSyncStatus('child-1');

      expect(result).toEqual(status);
      expect(mockSyncService.getSyncStatus).toHaveBeenCalledWith('child-1');
    });
  });

  describe('retrySyncNode', () => {
    it('should delegate to syncService.retrySyncNode', async () => {
      const syncResult = {
        nodeId: 'child-1',
        status: SyncStatus.COMPLETED,
        policiesSynced: 2,
        librariesSynced: 1,
        settingsSynced: true,
        syncedAt: new Date(),
      };
      mockSyncService.retrySyncNode.mockResolvedValue(syncResult);

      const result = await controller.retrySyncNode('child-1');

      expect(result).toEqual(syncResult);
      expect(mockSyncService.retrySyncNode).toHaveBeenCalledWith('child-1');
    });
  });

  describe('receivePolicies', () => {
    it('should delegate to syncService.receivePolicies', async () => {
      const dto = { policies: [{ id: 'p1', name: 'Test' }] };
      mockSyncService.receivePolicies.mockResolvedValue(undefined);

      await controller.receivePolicies(dto as any);

      expect(mockSyncService.receivePolicies).toHaveBeenCalledWith(dto.policies);
    });
  });

  describe('receiveLibraries', () => {
    it('should delegate to syncService.receiveLibraries', async () => {
      const dto = { libraries: [{ id: 'l1', name: 'Movies' }] };
      mockSyncService.receiveLibraries.mockResolvedValue(undefined);

      await controller.receiveLibraries(dto as any);

      expect(mockSyncService.receiveLibraries).toHaveBeenCalledWith(dto.libraries);
    });
  });

  describe('receiveSettings', () => {
    it('should delegate to syncService.receiveSettings', async () => {
      const dto = {
        isSetupComplete: true,
        allowLocalNetworkWithoutAuth: false,
        defaultQueueView: 'ENCODING',
        readyFilesCacheTtlMinutes: 5,
      };
      mockSyncService.receiveSettings.mockResolvedValue(undefined);

      await controller.receiveSettings(dto as any);

      expect(mockSyncService.receiveSettings).toHaveBeenCalledWith(dto);
    });
  });
});
