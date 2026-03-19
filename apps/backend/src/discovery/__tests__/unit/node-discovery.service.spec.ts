import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { NodeRole } from '@prisma/client';
import { NodesService } from '../../../nodes/nodes.service';
import { NotificationsService } from '../../../notifications/notifications.service';
import { HardwareDetectionService } from '../../../system/hardware-detection.service';
import { type DiscoveredNode, NodeDiscoveryService } from '../../node-discovery.service';

// Mock bonjour-service before imports resolve
jest.mock('bonjour-service', () => {
  const mockBrowser = {
    on: jest.fn().mockReturnThis(),
    start: jest.fn(),
    stop: jest.fn(),
  };
  const mockService = {
    stop: jest.fn(),
  };
  const mockBonjour = {
    publish: jest.fn().mockReturnValue(mockService),
    find: jest.fn().mockReturnValue(mockBrowser),
    destroy: jest.fn(),
  };
  return {
    Bonjour: jest.fn().mockImplementation(() => mockBonjour),
    __mockBonjour: mockBonjour,
    __mockBrowser: mockBrowser,
    __mockService: mockService,
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bonjourMock = require('bonjour-service');

describe('NodeDiscoveryService (discovery module)', () => {
  let service: NodeDiscoveryService;

  const mockNodesService = {
    getCurrentNode: jest.fn(),
    findOne: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockHardwareDetectionService = {
    detectHardware: jest.fn(),
  };

  const mockNotificationsService = {
    createNotification: jest.fn(),
  };

  const mockMainNode = {
    id: 'node-1',
    name: 'Main Node',
    role: NodeRole.MAIN,
    version: '1.0.0',
    status: 'ONLINE',
  };

  const mockLinkedNode = {
    id: 'node-2',
    name: 'Worker Node',
    role: NodeRole.LINKED,
    version: '1.0.0',
    status: 'ONLINE',
  };

  const mockHardware = {
    accelerationType: 'NVIDIA_CUDA',
    gpus: [{ model: 'RTX 3080' }],
    cpu: { cores: 8, model: 'Intel i7' },
    platform: 'linux',
  };

  async function buildModule() {
    jest.clearAllMocks();
    bonjourMock.__mockBonjour.publish.mockReturnValue(bonjourMock.__mockService);
    bonjourMock.__mockBonjour.find.mockReturnValue(bonjourMock.__mockBrowser);
    bonjourMock.__mockBrowser.on.mockReturnValue(bonjourMock.__mockBrowser);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NodeDiscoveryService,
        { provide: NodesService, useValue: mockNodesService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: HardwareDetectionService, useValue: mockHardwareDetectionService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    return module;
  }

  beforeEach(async () => {
    const module = await buildModule();
    service = module.get<NodeDiscoveryService>(NodeDiscoveryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================================================
  // onModuleInit
  // ============================================================================

  describe('onModuleInit', () => {
    it('should initialize Bonjour and start broadcasting for MAIN node', async () => {
      mockNodesService.getCurrentNode.mockResolvedValue(mockMainNode);
      mockHardwareDetectionService.detectHardware.mockResolvedValue(mockHardware);

      await service.onModuleInit();

      expect(mockNodesService.getCurrentNode).toHaveBeenCalledTimes(1);
      expect(mockHardwareDetectionService.detectHardware).toHaveBeenCalledTimes(1);
      expect(bonjourMock.__mockBonjour.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Main Node',
          type: 'bitbonsai',
        })
      );
    });

    it('should initialize Bonjour but skip broadcasting for LINKED node', async () => {
      mockNodesService.getCurrentNode.mockResolvedValue(mockLinkedNode);

      await service.onModuleInit();

      expect(mockNodesService.getCurrentNode).toHaveBeenCalledTimes(1);
      expect(bonjourMock.__mockBonjour.publish).not.toHaveBeenCalled();
    });

    it('should initialize without error when no node is configured yet', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('No node configured'));

      await expect(service.onModuleInit()).resolves.not.toThrow();

      expect(bonjourMock.__mockBonjour.publish).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // onModuleDestroy
  // ============================================================================

  describe('onModuleDestroy', () => {
    it('should destroy bonjour on module destroy', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('No node'));
      await service.onModuleInit();

      await service.onModuleDestroy();

      expect(bonjourMock.__mockBonjour.destroy).toHaveBeenCalledTimes(1);
    });

    it('should stop published service on destroy when broadcasting', async () => {
      mockNodesService.getCurrentNode.mockResolvedValue(mockMainNode);
      mockHardwareDetectionService.detectHardware.mockResolvedValue(mockHardware);
      await service.onModuleInit();

      await service.onModuleDestroy();

      expect(bonjourMock.__mockService.stop).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // getDiscoveredNodes
  // ============================================================================

  describe('getDiscoveredNodes', () => {
    it('should return empty array when no nodes discovered', () => {
      const result = service.getDiscoveredNodes();

      expect(result).toEqual([]);
    });

    it('should return discovered nodes from internal cache', () => {
      // Access private map via type casting to seed data
      const internalMap = (service as unknown as { discoveredNodes: Map<string, DiscoveredNode> })
        .discoveredNodes;
      const node: DiscoveredNode = {
        nodeId: 'node-abc',
        name: 'Discovered Node',
        version: '1.0.0',
        apiPort: 3100,
        ipAddress: '192.168.1.50',
        hostname: 'worker-host',
        discoveredAt: new Date(),
      };
      internalMap.set('node-abc', node);

      const result = service.getDiscoveredNodes();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ nodeId: 'node-abc', name: 'Discovered Node' });
    });
  });

  // ============================================================================
  // clearDiscoveredNodes
  // ============================================================================

  describe('clearDiscoveredNodes', () => {
    it('should clear the discovered nodes cache', () => {
      const internalMap = (service as unknown as { discoveredNodes: Map<string, DiscoveredNode> })
        .discoveredNodes;
      internalMap.set('node-abc', {
        nodeId: 'node-abc',
        name: 'Test',
        version: '1.0.0',
        apiPort: 3100,
        ipAddress: '192.168.1.50',
        hostname: 'host',
        discoveredAt: new Date(),
      });

      service.clearDiscoveredNodes();

      expect(service.getDiscoveredNodes()).toEqual([]);
    });
  });

  // ============================================================================
  // scanForMainNodes
  // ============================================================================

  describe('scanForMainNodes', () => {
    it('should throw when bonjour is not initialized', async () => {
      // Force bonjour to null
      (service as unknown as { bonjour: null }).bonjour = null;

      await expect(service.scanForMainNodes()).rejects.toThrow('Bonjour not initialized');
    });

    it('should prevent concurrent scans by returning existing promise', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('No node'));
      await service.onModuleInit();

      // Inject a fake active scan
      const fakeResult: DiscoveredNode[] = [];
      const fakeScan = Promise.resolve(fakeResult);
      (service as unknown as { activeScan: Promise<DiscoveredNode[]> }).activeScan = fakeScan;

      const result = await service.scanForMainNodes();

      expect(result).toBe(fakeResult);
    });

    it('should start browser and resolve with discovered nodes after timeout', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('No node'));
      await service.onModuleInit();

      jest.useFakeTimers();
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as Response);

      // Capture the 'up' handler registered on the browser mock
      let upHandler: ((svc: unknown) => Promise<void>) | undefined;
      bonjourMock.__mockBrowser.on.mockImplementation(
        (event: string, handler: (svc: unknown) => Promise<void>) => {
          if (event === 'up') upHandler = handler;
          return bonjourMock.__mockBrowser;
        }
      );

      const scanPromise = service.scanForMainNodes();

      // Simulate a service being discovered
      if (upHandler) {
        await upHandler({
          txt: { nodeId: 'found-node', name: 'Found Node', version: '2.0.0', apiPort: '3100' },
          addresses: ['192.168.1.77'],
          host: 'found-host',
          port: 3100,
          name: 'Found Node',
        });
      }

      // Advance past the 5-second scan timeout
      jest.advanceTimersByTime(5000);

      const result = await scanPromise;

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ nodeId: 'found-node', name: 'Found Node' });

      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('should emit node.discovered event when a node is found', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('No node'));
      await service.onModuleInit();

      jest.useFakeTimers();
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as Response);

      let upHandler: ((svc: unknown) => Promise<void>) | undefined;
      bonjourMock.__mockBrowser.on.mockImplementation(
        (event: string, handler: (svc: unknown) => Promise<void>) => {
          if (event === 'up') upHandler = handler;
          return bonjourMock.__mockBrowser;
        }
      );

      mockNotificationsService.createNotification.mockResolvedValue({ id: 'notif-1' });

      const scanPromise = service.scanForMainNodes();

      if (upHandler) {
        await upHandler({
          txt: { nodeId: 'emit-node', name: 'Emit Node', version: '1.0.0', apiPort: '3100' },
          addresses: ['192.168.1.88'],
          host: 'emit-host',
          port: 3100,
          name: 'Emit Node',
        });
      }

      jest.advanceTimersByTime(5000);
      await scanPromise;

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'node.discovered',
        expect.objectContaining({ nodeId: 'emit-node' })
      );

      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('should skip service with no nodeId in txt records', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('No node'));
      await service.onModuleInit();

      jest.useFakeTimers();

      let upHandler: ((svc: unknown) => Promise<void>) | undefined;
      bonjourMock.__mockBrowser.on.mockImplementation(
        (event: string, handler: (svc: unknown) => Promise<void>) => {
          if (event === 'up') upHandler = handler;
          return bonjourMock.__mockBrowser;
        }
      );

      const scanPromise = service.scanForMainNodes();

      if (upHandler) {
        await upHandler({
          txt: { name: 'No ID Node' }, // no nodeId
          addresses: ['192.168.1.99'],
          host: 'no-id-host',
          port: 3100,
          name: 'No ID Node',
        });
      }

      jest.advanceTimersByTime(5000);
      const result = await scanPromise;

      expect(result).toHaveLength(0);

      jest.useRealTimers();
    });
  });

  // ============================================================================
  // requestPairing
  // ============================================================================

  describe('requestPairing', () => {
    it('should fetch pairing token from MAIN node and return it', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ pairingToken: '654321' }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await service.requestPairing('http://192.168.1.100:3100', 'node-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://192.168.1.100:3100/api/v1/nodes/node-1/pairing-token',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result).toBe('654321');
    });

    it('should throw when pairing request returns non-ok status', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      }) as unknown as typeof fetch;

      await expect(
        service.requestPairing('http://192.168.1.100:3100', 'missing-node')
      ).rejects.toThrow('Pairing request failed: Not Found');
    });

    it('should propagate network errors', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('Network failure')) as unknown as typeof fetch;

      await expect(service.requestPairing('http://192.168.1.100:3100', 'node-1')).rejects.toThrow(
        'Network failure'
      );
    });
  });

  // ============================================================================
  // approveNode
  // ============================================================================

  describe('approveNode', () => {
    it('should return node from nodesService.findOne', async () => {
      const node = { id: 'node-3', name: 'Worker', role: NodeRole.LINKED };
      mockNodesService.findOne.mockResolvedValue(node);

      const result = await service.approveNode('node-3');

      expect(mockNodesService.findOne).toHaveBeenCalledWith('node-3');
      expect(result).toEqual(node);
    });

    it('should propagate NotFoundException for unknown node', async () => {
      mockNodesService.findOne.mockRejectedValue(new Error('Node not found'));

      await expect(service.approveNode('missing')).rejects.toThrow('Node not found');
    });
  });

  // ============================================================================
  // rejectNode
  // ============================================================================

  describe('rejectNode', () => {
    it('should remove the node from the discovered cache', async () => {
      const internalMap = (service as unknown as { discoveredNodes: Map<string, DiscoveredNode> })
        .discoveredNodes;
      internalMap.set('node-abc', {
        nodeId: 'node-abc',
        name: 'To Reject',
        version: '1.0.0',
        apiPort: 3100,
        ipAddress: '192.168.1.50',
        hostname: 'host',
        discoveredAt: new Date(),
      });

      await service.rejectNode('node-abc');

      expect(internalMap.has('node-abc')).toBe(false);
    });

    it('should not throw when rejecting a node not in the cache', async () => {
      await expect(service.rejectNode('non-existent')).resolves.not.toThrow();
    });
  });
});
