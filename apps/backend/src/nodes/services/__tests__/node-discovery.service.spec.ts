import { Test, type TestingModule } from '@nestjs/testing';
import { NodeRepository } from '../../../common/repositories/node.repository';
import { NodeDiscoveryService } from '../node-discovery.service';

// Mock bonjour-service
const mockPublish = jest.fn();
const mockFind = jest.fn();
const mockDestroy = jest.fn();
const mockServiceStop = jest.fn();

jest.mock('bonjour-service', () => {
  return jest.fn().mockImplementation(() => ({
    publish: mockPublish,
    find: mockFind,
    destroy: mockDestroy,
  }));
});

describe('NodeDiscoveryService', () => {
  let service: NodeDiscoveryService;

  const mockNodeRepository = {
    findMain: jest.fn().mockResolvedValue(null),
    findById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPublish.mockReturnValue({ stop: mockServiceStop });

    const module: TestingModule = await Test.createTestingModule({
      providers: [NodeDiscoveryService, { provide: NodeRepository, useValue: mockNodeRepository }],
    }).compile();

    service = module.get<NodeDiscoveryService>(NodeDiscoveryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should initialize without error when no node is configured', async () => {
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('onModuleDestroy', () => {
    it('should clean up resources without error', async () => {
      await service.onModuleInit();
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  describe('discoverMainNodes', () => {
    it('should return discovered nodes array', async () => {
      const mockBrowser = {
        on: jest.fn().mockReturnThis(),
        start: jest.fn(),
        stop: jest.fn(),
      };
      mockFind.mockReturnValue(mockBrowser);

      const nodesPromise = service.discoverMainNodes(100);

      const nodes = await nodesPromise;
      expect(Array.isArray(nodes)).toBe(true);
    });
  });
});
