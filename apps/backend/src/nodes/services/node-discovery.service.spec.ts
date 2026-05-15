import { Test, TestingModule } from '@nestjs/testing';
import { NodeRole } from '@prisma/client';
import { NodeRepository } from '../../common/repositories/node.repository';
import { NodeDiscoveryService } from './node-discovery.service';

// Mock bonjour-service at the module level
jest.mock('bonjour-service', () => {
  return jest.fn().mockImplementation(() => ({
    publish: jest.fn().mockReturnValue({ stop: jest.fn() }),
    find: jest.fn().mockReturnValue({
      on: jest.fn(),
      stop: jest.fn(),
    }),
    destroy: jest.fn(),
  }));
});

describe('NodeDiscoveryService', () => {
  let service: NodeDiscoveryService;
  let mockNodeRepository: any;

  beforeEach(async () => {
    mockNodeRepository = {
      findMain: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [NodeDiscoveryService, { provide: NodeRepository, useValue: mockNodeRepository }],
    }).compile();

    service = module.get<NodeDiscoveryService>(NodeDiscoveryService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('onModuleInit', () => {
    it('should start broadcasting when node is MAIN', async () => {
      mockNodeRepository.findMain.mockResolvedValue({
        id: 'node-1',
        name: 'Main Node',
        role: NodeRole.MAIN,
      });
      const startBroadcastingspy = jest
        .spyOn(service, 'startBroadcasting')
        .mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(startBroadcastingspy).toHaveBeenCalledWith('node-1', 'Main Node');
    });

    it('should not broadcast when no MAIN node found', async () => {
      mockNodeRepository.findMain.mockResolvedValue(null);
      const startBroadcastingspy = jest
        .spyOn(service, 'startBroadcasting')
        .mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(startBroadcastingspy).not.toHaveBeenCalled();
    });
  });

  describe('startBroadcasting', () => {
    it('should initialize bonjour and publish service', async () => {
      await expect(service.startBroadcasting('node-1', 'Test Node')).resolves.not.toThrow();
    });
  });

  describe('stopBroadcasting', () => {
    it('should stop broadcasting without throwing', () => {
      expect(() => service.stopBroadcasting()).not.toThrow();
    });

    it('should clean up bonjour after startBroadcasting', async () => {
      await service.startBroadcasting('node-1', 'Test Node');
      service.stopBroadcasting();

      // Service field should be null after stopping
      expect((service as any).service).toBeNull();
      expect((service as any).bonjour).toBeNull();
    });
  });

  describe('discoverMainNodes', () => {
    it('should return empty array when no nodes discovered within timeout', async () => {
      // With mocked bonjour that never fires 'up' event, returns empty after timeout
      const result = await service.discoverMainNodes(100); // 100ms timeout

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });
});
