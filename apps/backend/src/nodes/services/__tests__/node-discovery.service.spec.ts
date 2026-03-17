import { Test, type TestingModule } from '@nestjs/testing';
import { NodeRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
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

// Mock os.networkInterfaces
jest.mock('os', () => ({
  networkInterfaces: jest.fn(() => ({
    eth0: [
      { family: 'IPv4', address: '192.168.1.50', internal: false },
      { family: 'IPv6', address: '::1', internal: true },
    ],
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  })),
}));

describe('NodeDiscoveryService', () => {
  let service: NodeDiscoveryService;
  let prisma: PrismaService;

  const mockPrismaService = {
    node: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPublish.mockReturnValue({ stop: mockServiceStop });

    const module: TestingModule = await Test.createTestingModule({
      providers: [NodeDiscoveryService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<NodeDiscoveryService>(NodeDiscoveryService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('onModuleInit', () => {
    it('should start broadcasting if a MAIN node exists', async () => {
      mockPrismaService.node.findFirst.mockResolvedValue({
        id: 'main-1',
        name: 'Main Node',
        role: NodeRole.MAIN,
      });

      const spy = jest.spyOn(service, 'startBroadcasting').mockResolvedValue();

      await service.onModuleInit();

      expect(prisma.node.findFirst).toHaveBeenCalledWith({
        where: { role: NodeRole.MAIN },
      });
      expect(spy).toHaveBeenCalledWith('main-1', 'Main Node');
    });

    it('should not start broadcasting if no MAIN node exists', async () => {
      mockPrismaService.node.findFirst.mockResolvedValue(null);

      const spy = jest.spyOn(service, 'startBroadcasting');

      await service.onModuleInit();

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('startBroadcasting', () => {
    it('should publish mDNS service with correct parameters', async () => {
      const originalPort = process.env.PORT;
      const originalApiUrl = process.env.API_BASE_URL;
      process.env.PORT = '3100';
      process.env.API_BASE_URL = 'http://192.168.1.50:3100/api/v1';

      await service.startBroadcasting('node-1', 'TestNode');

      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'TestNode',
          type: 'bitbonsai-main',
          port: 3100,
          txt: expect.objectContaining({
            nodeId: 'node-1',
            apiUrl: 'http://192.168.1.50:3100/api/v1',
          }),
        })
      );

      process.env.PORT = originalPort;
      process.env.API_BASE_URL = originalApiUrl;
    });

    it('should use default port 3000 if PORT env is not set', async () => {
      const originalPort = process.env.PORT;
      delete process.env.PORT;

      await service.startBroadcasting('node-1', 'TestNode');

      expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ port: 3000 }));

      process.env.PORT = originalPort;
    });

    it('should handle broadcasting errors gracefully', async () => {
      mockPublish.mockImplementation(() => {
        throw new Error('mDNS failure');
      });

      // Should not throw
      await expect(service.startBroadcasting('node-1', 'TestNode')).resolves.toBeUndefined();
    });
  });

  describe('stopBroadcasting', () => {
    it('should stop service and destroy bonjour when broadcasting', async () => {
      // Start broadcasting first to set internal state
      await service.startBroadcasting('node-1', 'TestNode');

      service.stopBroadcasting();

      expect(mockServiceStop).toHaveBeenCalled();
      expect(mockDestroy).toHaveBeenCalled();
    });

    it('should handle stop when not broadcasting', () => {
      // Should not throw when no service is active
      expect(() => service.stopBroadcasting()).not.toThrow();
    });

    it('should handle errors during stop gracefully', async () => {
      await service.startBroadcasting('node-1', 'TestNode');
      mockServiceStop.mockImplementation(() => {
        throw new Error('Stop failed');
      });

      expect(() => service.stopBroadcasting()).not.toThrow();
    });
  });

  describe('onModuleDestroy', () => {
    it('should call stopBroadcasting', async () => {
      const spy = jest.spyOn(service, 'stopBroadcasting');

      await service.onModuleDestroy();

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('discoverMainNodes', () => {
    it('should discover main nodes via mDNS browser', async () => {
      const mockBrowser = {
        on: jest.fn(),
        stop: jest.fn(),
      };
      mockFind.mockReturnValue(mockBrowser);

      // Simulate a discovered service
      mockBrowser.on.mockImplementation((event: string, callback: any) => {
        if (event === 'up') {
          // Fire the callback with a mock service after a short delay
          setTimeout(() => {
            callback({
              name: 'RemoteMain',
              port: 3100,
              txt: {
                nodeId: 'remote-1',
                apiUrl: 'http://192.168.1.100:3100/api/v1',
                version: '1.0.0',
              },
              referer: { address: '192.168.1.100' },
              addresses: ['192.168.1.100'],
            });
          }, 10);
        }
        return mockBrowser;
      });

      const nodes = await service.discoverMainNodes(100);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toEqual(
        expect.objectContaining({
          nodeId: 'remote-1',
          nodeName: 'RemoteMain',
          ipAddress: '192.168.1.100',
          port: 3100,
          discovered: true,
        })
      );
    });

    it('should skip duplicate node IDs', async () => {
      const mockBrowser = {
        on: jest.fn(),
        stop: jest.fn(),
      };
      mockFind.mockReturnValue(mockBrowser);

      mockBrowser.on.mockImplementation((event: string, callback: any) => {
        if (event === 'up') {
          setTimeout(() => {
            // Same nodeId twice
            callback({
              name: 'Node1',
              port: 3100,
              txt: { nodeId: 'same-id', apiUrl: 'http://1.1.1.1:3100', version: '1.0.0' },
              referer: { address: '1.1.1.1' },
            });
            callback({
              name: 'Node1Dup',
              port: 3100,
              txt: { nodeId: 'same-id', apiUrl: 'http://1.1.1.2:3100', version: '1.0.0' },
              referer: { address: '1.1.1.2' },
            });
          }, 10);
        }
        return mockBrowser;
      });

      const nodes = await service.discoverMainNodes(100);
      expect(nodes).toHaveLength(1);
    });

    it('should return empty array when no nodes found', async () => {
      const mockBrowser = {
        on: jest.fn().mockReturnThis(),
        stop: jest.fn(),
      };
      mockFind.mockReturnValue(mockBrowser);

      const nodes = await service.discoverMainNodes(50);
      expect(nodes).toHaveLength(0);
    });
  });
});
