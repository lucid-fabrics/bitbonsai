import { Test, type TestingModule } from '@nestjs/testing';
import { NodeRole } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { NodeConfigService } from '../../node-config.service';

// Mock fs and os
jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

jest.mock('node:os', () => ({
  networkInterfaces: jest.fn().mockReturnValue({}),
}));

import * as fs from 'node:fs';
import * as os from 'node:os';

const mockExistsSync = fs.existsSync as jest.Mock;
const mockReadFileSync = fs.readFileSync as jest.Mock;
const mockWriteFileSync = fs.writeFileSync as jest.Mock;
const mockNetworkInterfaces = os.networkInterfaces as jest.Mock;

function createMockPrisma() {
  return {
    node: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  };
}

describe('NodeConfigService', () => {
  let service: NodeConfigService;
  let prisma: ReturnType<typeof createMockPrisma>;
  const originalEnv = process.env;

  beforeEach(async () => {
    prisma = createMockPrisma();

    // Reset env
    process.env = { ...originalEnv };
    process.env.NODE_ID = undefined;

    // Default fs mocks
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('');
    mockWriteFileSync.mockImplementation();
    mockNetworkInterfaces.mockReturnValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [NodeConfigService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<NodeConfigService>(NodeConfigService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('getters (before loadConfig)', () => {
    it('should return null role before loading', () => {
      expect(service.getRole()).toBeNull();
    });

    it('should return null nodeId before loading', () => {
      expect(service.getNodeId()).toBeNull();
    });

    it('should return null mainApiUrl before loading', () => {
      expect(service.getMainApiUrl()).toBeNull();
    });

    it('should return null apiKey before loading', () => {
      expect(service.getApiKey()).toBeNull();
    });

    it('should return false for isMainNode before loading', () => {
      expect(service.isMainNode()).toBe(false);
    });

    it('should return false for isLinkedNode before loading', () => {
      expect(service.isLinkedNode()).toBe(false);
    });

    it('should return false for isConfigLoaded before loading', () => {
      expect(service.isConfigLoaded()).toBe(false);
    });
  });

  describe('loadConfig', () => {
    it('should warn when no node found', async () => {
      prisma.node.findFirst.mockResolvedValue(null);
      prisma.node.findUnique.mockResolvedValue(null);

      await service.loadConfig();

      expect(service.isConfigLoaded()).toBe(false);
    });

    it('should load MAIN node config via NODE_ID env var', async () => {
      process.env.NODE_ID = 'main-node-id';
      const mockNode = {
        id: 'main-node-id',
        role: NodeRole.MAIN,
        mainNodeUrl: null,
        apiKey: 'api-key-123',
        name: 'Main Node',
      };
      prisma.node.findUnique.mockResolvedValue(mockNode);

      await service.loadConfig();

      expect(service.getNodeId()).toBe('main-node-id');
      expect(service.getRole()).toBe(NodeRole.MAIN);
      expect(service.isMainNode()).toBe(true);
      expect(service.isLinkedNode()).toBe(false);
      expect(service.isConfigLoaded()).toBe(true);
    });

    it('should load LINKED node config', async () => {
      process.env.NODE_ID = 'linked-node-id';
      const mockNode = {
        id: 'linked-node-id',
        role: NodeRole.LINKED,
        mainNodeUrl: 'http://192.168.1.100:3100',
        apiKey: 'linked-key',
        name: 'Worker 1',
      };
      prisma.node.findUnique.mockResolvedValue(mockNode);

      await service.loadConfig();

      expect(service.getRole()).toBe(NodeRole.LINKED);
      expect(service.isLinkedNode()).toBe(true);
      expect(service.isMainNode()).toBe(false);
      expect(service.getMainApiUrl()).toBe('http://192.168.1.100:3100');
    });

    it('should use persisted node ID when no env var', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('persisted-id');
      const mockNode = {
        id: 'persisted-id',
        role: NodeRole.MAIN,
        mainNodeUrl: null,
        apiKey: 'key',
        name: 'Main',
      };
      prisma.node.findUnique.mockResolvedValue(mockNode);

      await service.loadConfig();

      expect(service.getNodeId()).toBe('persisted-id');
    });

    it('should fall back to MAIN node when no other strategy works', async () => {
      const mockNode = {
        id: 'fallback-main',
        role: NodeRole.MAIN,
        mainNodeUrl: null,
        apiKey: 'key',
        name: 'Main',
      };
      prisma.node.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === 'fallback-main') return Promise.resolve(mockNode);
        return Promise.resolve(null);
      });
      prisma.node.findFirst.mockImplementation(
        ({ where }: { where: { role?: NodeRole; ipAddress?: string } }) => {
          if (where.role === NodeRole.MAIN) return Promise.resolve(mockNode);
          return Promise.resolve(null);
        }
      );

      await service.loadConfig();

      expect(service.getNodeId()).toBe('fallback-main');
    });

    it('should persist node ID on successful load', async () => {
      process.env.NODE_ID = 'node-1';
      prisma.node.findUnique.mockResolvedValue({
        id: 'node-1',
        role: NodeRole.MAIN,
        mainNodeUrl: null,
        apiKey: 'key',
        name: 'Main',
      });

      await service.loadConfig();

      expect(mockWriteFileSync).toHaveBeenCalledWith(expect.any(String), 'node-1', 'utf-8');
    });

    it('should detect node by IP address', async () => {
      mockNetworkInterfaces.mockReturnValue({
        eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.100' }],
      });
      const mockNode = {
        id: 'ip-node',
        role: NodeRole.MAIN,
        mainNodeUrl: null,
        apiKey: 'key',
        name: 'IP Node',
      };
      prisma.node.findFirst.mockImplementation(
        ({ where }: { where: { ipAddress?: string; role?: NodeRole } }) => {
          if (where.ipAddress === '192.168.1.100') return Promise.resolve(mockNode);
          return Promise.resolve(null);
        }
      );
      prisma.node.findUnique.mockResolvedValue(mockNode);

      await service.loadConfig();

      expect(service.getNodeId()).toBe('ip-node');
    });
  });

  describe('getConfig', () => {
    it('should return full config object', async () => {
      process.env.NODE_ID = 'node-1';
      prisma.node.findUnique.mockResolvedValue({
        id: 'node-1',
        role: NodeRole.MAIN,
        mainNodeUrl: null,
        apiKey: 'key',
        name: 'Main',
      });

      await service.loadConfig();
      const config = service.getConfig();

      expect(config).toEqual({
        nodeId: 'node-1',
        role: NodeRole.MAIN,
        mainApiUrl: null,
        isMainNode: true,
        isLinkedNode: false,
        isLoaded: true,
      });
    });
  });

  describe('reload', () => {
    it('should reload configuration', async () => {
      process.env.NODE_ID = 'node-1';
      prisma.node.findUnique.mockResolvedValue({
        id: 'node-1',
        role: NodeRole.MAIN,
        mainNodeUrl: null,
        apiKey: 'key',
        name: 'Main',
      });

      await service.reload();

      expect(service.isConfigLoaded()).toBe(true);
    });
  });
});
