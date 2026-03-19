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

  // ============================================================================
  // onModuleInit - additional branches
  // ============================================================================

  describe('onModuleInit - additional branches', () => {
    it('should use PORT env var when broadcasting', async () => {
      process.env.PORT = '4000';
      const freshModule = await buildModule();
      const freshService = freshModule.get<NodeDiscoveryService>(NodeDiscoveryService);
      mockNodesService.getCurrentNode.mockResolvedValue(mockMainNode);
      mockHardwareDetectionService.detectHardware.mockResolvedValue(mockHardware);

      await freshService.onModuleInit();

      expect(bonjourMock.__mockBonjour.publish).toHaveBeenCalledWith(
        expect.objectContaining({ port: 4000 })
      );

      process.env.PORT = undefined as any;
    });

    it('should default to port 3100 when PORT env var is empty string', async () => {
      process.env.PORT = '';
      const freshModule = await buildModule();
      const freshService = freshModule.get<NodeDiscoveryService>(NodeDiscoveryService);
      mockNodesService.getCurrentNode.mockResolvedValue(mockMainNode);
      mockHardwareDetectionService.detectHardware.mockResolvedValue(mockHardware);

      await freshService.onModuleInit();

      expect(bonjourMock.__mockBonjour.publish).toHaveBeenCalledWith(
        expect.objectContaining({ port: 3100 })
      );
    });

    it('should include hardware info in TXT records when broadcasting', async () => {
      const freshModule = await buildModule();
      const freshService = freshModule.get<NodeDiscoveryService>(NodeDiscoveryService);
      mockNodesService.getCurrentNode.mockResolvedValue(mockMainNode);
      mockHardwareDetectionService.detectHardware.mockResolvedValue(mockHardware);

      await freshService.onModuleInit();

      expect(bonjourMock.__mockBonjour.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          txt: expect.objectContaining({
            accelerationType: 'NVIDIA_CUDA',
            gpuCount: '1',
            cpuCores: '8',
            platform: 'linux',
          }),
        })
      );
    });

    it('should not throw when hardware detection fails during broadcast (error is caught internally)', async () => {
      const freshModule = await buildModule();
      const freshService = freshModule.get<NodeDiscoveryService>(NodeDiscoveryService);

      mockNodesService.getCurrentNode.mockResolvedValue(mockMainNode);
      mockHardwareDetectionService.detectHardware.mockRejectedValue(
        new Error('Hardware detection failed')
      );

      // onModuleInit catches startBroadcast errors and does NOT re-throw
      await expect(freshService.onModuleInit()).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // onModuleDestroy - additional branches
  // ============================================================================

  describe('onModuleDestroy - additional branches', () => {
    it('should handle missing stop method on published service', async () => {
      mockNodesService.getCurrentNode.mockResolvedValue(mockMainNode);
      mockHardwareDetectionService.detectHardware.mockResolvedValue(mockHardware);

      // Return a service without a stop method
      bonjourMock.__mockBonjour.publish.mockReturnValueOnce({ name: 'no-stop' });

      await service.onModuleInit();
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });

    it('should stop an active browser on destroy', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('No node'));
      await service.onModuleInit();

      // Inject a browser
      const fakeBrowser = { stop: jest.fn() };
      (service as unknown as { browser: typeof fakeBrowser }).browser = fakeBrowser;

      await service.onModuleDestroy();

      expect(fakeBrowser.stop).toHaveBeenCalledTimes(1);
    });

    it('should clear discoveredNodes map on destroy', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('No node'));
      await service.onModuleInit();

      const internalMap = (service as unknown as { discoveredNodes: Map<string, DiscoveredNode> })
        .discoveredNodes;
      internalMap.set('x', {
        nodeId: 'x',
        name: 'X',
        version: '1.0.0',
        apiPort: 3100,
        ipAddress: '10.0.0.1',
        hostname: 'x-host',
        discoveredAt: new Date(),
      });

      await service.onModuleDestroy();

      expect(internalMap.size).toBe(0);
    });
  });

  // ============================================================================
  // scanForMainNodes - additional branches
  // ============================================================================

  describe('scanForMainNodes - additional branches', () => {
    it('should fetch hardware and attach it when hardware endpoint responds ok', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('No node'));
      await service.onModuleInit();

      jest.useFakeTimers();

      const hardwarePayload = { accelerationType: 'CUDA' };
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(hardwarePayload),
      } as unknown as Response);

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
          txt: { nodeId: 'hw-node', name: 'HW Node', version: '1.0.0', apiPort: '3100' },
          addresses: ['192.168.1.10'],
          host: 'hw-host',
          port: 3100,
          name: 'HW Node',
        });
      }

      jest.advanceTimersByTime(5000);
      const result = await scanPromise;

      expect(result[0]?.hardware).toEqual(hardwarePayload);

      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('should emit node.lost and remove node when browser emits down event', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('No node'));
      await service.onModuleInit();

      jest.useFakeTimers();
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as Response);

      const handlers: Record<string, (svc: unknown) => void> = {};
      bonjourMock.__mockBrowser.on.mockImplementation(
        (event: string, handler: (svc: unknown) => void) => {
          handlers[event] = handler;
          return bonjourMock.__mockBrowser;
        }
      );

      mockNotificationsService.createNotification.mockResolvedValue({ id: 'notif-2' });

      const scanPromise = service.scanForMainNodes();

      // First add a node via 'up'
      if (handlers.up) {
        await (handlers.up as (svc: unknown) => Promise<void>)({
          txt: { nodeId: 'down-node', name: 'Down Node', version: '1.0.0', apiPort: '3100' },
          addresses: ['192.168.1.20'],
          host: 'down-host',
          port: 3100,
          name: 'Down Node',
        });
      }

      // Then simulate node going down
      if (handlers.down) {
        handlers.down({
          txt: { nodeId: 'down-node' },
        });
      }

      jest.advanceTimersByTime(5000);
      const result = await scanPromise;

      expect(result).toHaveLength(0);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('node.lost', 'down-node');

      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('should ignore down event for unknown nodeId', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('No node'));
      await service.onModuleInit();

      jest.useFakeTimers();

      const handlers: Record<string, (svc: unknown) => void> = {};
      bonjourMock.__mockBrowser.on.mockImplementation(
        (event: string, handler: (svc: unknown) => void) => {
          handlers[event] = handler;
          return bonjourMock.__mockBrowser;
        }
      );

      const scanPromise = service.scanForMainNodes();

      // Emit down for a node that was never added
      if (handlers.down) {
        handlers.down({ txt: { nodeId: 'ghost-node' } });
      }

      jest.advanceTimersByTime(5000);
      await scanPromise;

      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith('node.lost', 'ghost-node');

      jest.useRealTimers();
    });

    it('should reject when browser emits error event', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('No node'));
      await service.onModuleInit();

      jest.useFakeTimers();

      const handlers: Record<string, (arg: unknown) => void> = {};
      bonjourMock.__mockBrowser.on.mockImplementation(
        (event: string, handler: (arg: unknown) => void) => {
          handlers[event] = handler;
          return bonjourMock.__mockBrowser;
        }
      );

      const scanPromise = service.scanForMainNodes();

      if (handlers.error) {
        handlers.error(new Error('mDNS error'));
      }

      await expect(scanPromise).rejects.toThrow('mDNS error');

      jest.useRealTimers();
    });

    it('should use service.name as fallback when txt.name is missing', async () => {
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

      const scanPromise = service.scanForMainNodes();

      if (upHandler) {
        await upHandler({
          txt: { nodeId: 'fallback-node' }, // no txt.name
          addresses: ['192.168.1.30'],
          host: 'fallback-host',
          port: 3100,
          name: 'Service Name Fallback',
        });
      }

      jest.advanceTimersByTime(5000);
      const result = await scanPromise;

      expect(result[0]?.name).toBe('Service Name Fallback');

      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('should use service.port as fallback when txt.apiPort is missing', async () => {
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

      const scanPromise = service.scanForMainNodes();

      if (upHandler) {
        await upHandler({
          txt: { nodeId: 'port-fallback', name: 'Port Node' }, // no apiPort in txt
          addresses: ['192.168.1.40'],
          host: 'port-host',
          port: 9000,
          name: 'Port Node',
        });
      }

      jest.advanceTimersByTime(5000);
      const result = await scanPromise;

      expect(result[0]?.apiPort).toBe(9000);

      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('should use unknown as ipAddress fallback when addresses array is empty', async () => {
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

      const scanPromise = service.scanForMainNodes();

      if (upHandler) {
        await upHandler({
          txt: { nodeId: 'no-ip-node', name: 'No IP Node', version: '1.0.0' },
          addresses: [], // empty
          host: 'no-ip-host',
          port: 3100,
          name: 'No IP Node',
        });
      }

      jest.advanceTimersByTime(5000);
      const result = await scanPromise;

      expect(result[0]?.ipAddress).toBe('unknown');

      jest.useRealTimers();
      jest.restoreAllMocks();
    });
  });

  // ============================================================================
  // completePairing
  // ============================================================================

  describe('completePairing', () => {
    it('should throw when pairing completion returns non-ok status', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        statusText: 'Forbidden',
      }) as unknown as typeof fetch;

      await expect(service.completePairing('http://192.168.1.100:3100', '123456')).rejects.toThrow(
        'Pairing completion failed: Forbidden'
      );
    });

    it('should propagate network errors during completePairing', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

      await expect(service.completePairing('http://192.168.1.100:3100', '123456')).rejects.toThrow(
        'ECONNREFUSED'
      );
    });

    it('should return willRestart=true and schedule process.exit on successful pairing', async () => {
      const mockData = { nodeId: 'node-99', apiKey: 'abc123key456', name: 'Paired Node' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockData),
      }) as unknown as typeof fetch;

      // Spy on fs via jest require mock at the module level
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        /* noop */
      });

      jest.useFakeTimers();
      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation((_code?: string | number | null | undefined) => undefined as never);

      const result = await service.completePairing('http://192.168.1.100:3100', '123456');

      expect(result).toMatchObject({ nodeId: 'node-99', apiKey: 'abc123key456' });
      expect((result as Record<string, unknown>).willRestart).toBe(true);

      jest.advanceTimersByTime(2100);
      expect(exitSpy).toHaveBeenCalledWith(0);

      jest.useRealTimers();
      exitSpy.mockRestore();
      jest.restoreAllMocks();
    });

    it('should throw when .env write fails during completePairing', async () => {
      const mockData = { nodeId: 'node-88', apiKey: 'key888', name: 'Write Fail Node' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockData),
      }) as unknown as typeof fetch;

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(service.completePairing('http://192.168.1.100:3100', '654321')).rejects.toThrow(
        'Failed to write configuration file: Permission denied'
      );

      jest.restoreAllMocks();
    });
  });

  // ============================================================================
  // scanForMainNodes - browser cleanup branches
  // ============================================================================

  describe('scanForMainNodes - browser cleanup', () => {
    it('should stop existing browser before starting a new scan', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('No node'));
      await service.onModuleInit();

      jest.useFakeTimers();

      const existingBrowser = { stop: jest.fn() };
      (service as unknown as { browser: typeof existingBrowser }).browser = existingBrowser;

      bonjourMock.__mockBrowser.on.mockImplementation(
        (event: string, handler: (svc: unknown) => void) => {
          return bonjourMock.__mockBrowser;
        }
      );

      const scanPromise = service.scanForMainNodes();
      jest.advanceTimersByTime(5000);
      await scanPromise;

      expect(existingBrowser.stop).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('should handle notification creation failure gracefully', async () => {
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

      // Make notification creation fail
      mockNotificationsService.createNotification.mockRejectedValue(
        new Error('DB connection lost')
      );

      const scanPromise = service.scanForMainNodes();

      if (upHandler) {
        await upHandler({
          txt: {
            nodeId: 'notif-fail-node',
            name: 'Notif Fail Node',
            version: '1.0.0',
            apiPort: '3100',
          },
          addresses: ['192.168.1.55'],
          host: 'notif-fail-host',
          port: 3100,
          name: 'Notif Fail Node',
        });
      }

      jest.advanceTimersByTime(5000);
      // Should resolve despite notification failure
      const result = await scanPromise;

      expect(result).toHaveLength(1);
      expect(result[0].nodeId).toBe('notif-fail-node');

      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('should handle down event with no txt property without throwing', async () => {
      mockNodesService.getCurrentNode.mockRejectedValue(new Error('No node'));
      await service.onModuleInit();

      jest.useFakeTimers();

      const handlers: Record<string, (svc: unknown) => void> = {};
      bonjourMock.__mockBrowser.on.mockImplementation(
        (event: string, handler: (svc: unknown) => void) => {
          handlers[event] = handler;
          return bonjourMock.__mockBrowser;
        }
      );

      const scanPromise = service.scanForMainNodes();

      // Emit down with no txt property
      if (handlers.down) {
        handlers.down({ name: 'no-txt-service' });
      }

      jest.advanceTimersByTime(5000);
      await expect(scanPromise).resolves.not.toThrow();

      jest.useRealTimers();
    });
  });
});
