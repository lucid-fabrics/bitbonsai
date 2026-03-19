import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { NotificationsService } from '../../../notifications/notifications.service';
import { HardwareDetectionService } from '../../../system/hardware-detection.service';
import { NodesService } from '../../nodes.service';
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

  const mockNodesService = {
    getCurrentNode: jest.fn().mockRejectedValue(new Error('No node configured')),
    findOne: jest.fn(),
  };

  const mockHardwareDetectionService = {
    detectHardware: jest.fn().mockResolvedValue({
      accelerationType: 'CPU',
      gpus: [],
      cpu: { cores: 4 },
      platform: 'linux',
    }),
  };

  const mockNotificationsService = {
    createNotification: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPublish.mockReturnValue({ stop: mockServiceStop });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NodeDiscoveryService,
        { provide: NodesService, useValue: mockNodesService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: HardwareDetectionService, useValue: mockHardwareDetectionService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
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

  describe('getDiscoveredNodes', () => {
    it('should return empty array initially', () => {
      expect(service.getDiscoveredNodes()).toEqual([]);
    });
  });

  describe('clearDiscoveredNodes', () => {
    it('should clear without error', () => {
      expect(() => service.clearDiscoveredNodes()).not.toThrow();
    });
  });

  describe('scanForMainNodes', () => {
    it('should return discovered nodes', async () => {
      const mockBrowser = {
        on: jest.fn().mockReturnThis(),
        start: jest.fn(),
        stop: jest.fn(),
      };
      mockFind.mockReturnValue(mockBrowser);

      const nodesPromise = service.scanForMainNodes();

      // Resolve after timeout
      const nodes = await nodesPromise;
      expect(Array.isArray(nodes)).toBe(true);
    });
  });
});
