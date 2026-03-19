import { Test, type TestingModule } from '@nestjs/testing';
import { NodeRole } from '@prisma/client';
import { NodeRepository } from '../../../../common/repositories/node.repository';
import { NodeConfigService } from '../../node-config.service';

jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue(''),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

jest.mock('node:os', () => ({
  networkInterfaces: jest.fn().mockReturnValue({}),
}));

// Import mocked versions AFTER jest.mock declarations
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockFs = require('node:fs') as {
  existsSync: jest.Mock;
  readFileSync: jest.Mock;
  writeFileSync: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockOs = require('node:os') as { networkInterfaces: jest.Mock };

describe('NodeConfigService', () => {
  let service: NodeConfigService;
  let module: TestingModule;
  const originalEnv = process.env;

  const mockNodeRepository = {
    findWithSelect: jest.fn(),
    findFirstByRole: jest.fn(),
    findFirst: jest.fn(),
    findManyByIp: jest.fn(),
  };

  beforeAll(async () => {
    mockNodeRepository.findWithSelect.mockResolvedValue(null);
    mockNodeRepository.findFirstByRole.mockResolvedValue(null);
    mockNodeRepository.findFirst.mockResolvedValue(null);

    module = await Test.createTestingModule({
      providers: [NodeConfigService, { provide: NodeRepository, useValue: mockNodeRepository }],
    }).compile();

    service = module.get<NodeConfigService>(NodeConfigService);

    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NODE_ID = '';

    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('');
    mockFs.writeFileSync.mockImplementation(() => undefined);
    mockOs.networkInterfaces.mockReturnValue({});

    // Re-apply logger silencing after clearAllMocks
    jest.spyOn((service as any).logger, 'log').mockImplementation();
    jest.spyOn((service as any).logger, 'warn').mockImplementation();
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    jest.spyOn((service as any).logger, 'error').mockImplementation();

    // Reset internal service state
    (service as any).config = { nodeId: null, role: null, mainApiUrl: null, apiKey: null };
    (service as any).isLoaded = false;
  });

  afterEach(() => {
    process.env = originalEnv;
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
      mockNodeRepository.findFirstByRole.mockResolvedValue(null);
      mockNodeRepository.findWithSelect.mockResolvedValue(null);

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
      mockNodeRepository.findWithSelect.mockResolvedValue(mockNode);

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
      mockNodeRepository.findWithSelect.mockResolvedValue(mockNode);

      await service.loadConfig();

      expect(service.getRole()).toBe(NodeRole.LINKED);
      expect(service.isLinkedNode()).toBe(true);
      expect(service.isMainNode()).toBe(false);
      expect(service.getMainApiUrl()).toBe('http://192.168.1.100:3100');
    });

    it('should use persisted node ID when no env var', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('persisted-id');
      const mockNode = {
        id: 'persisted-id',
        role: NodeRole.MAIN,
        mainNodeUrl: null,
        apiKey: 'key',
        name: 'Main',
      };
      mockNodeRepository.findWithSelect.mockResolvedValue(mockNode);

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
      // findWithSelect must return the node so loadConfig() doesn't retry infinitely
      mockNodeRepository.findWithSelect.mockResolvedValue(mockNode);
      mockNodeRepository.findFirstByRole.mockImplementation((role: NodeRole) => {
        if (role === NodeRole.MAIN) return Promise.resolve(mockNode);
        return Promise.resolve(null);
      });

      await service.loadConfig();

      expect(service.getNodeId()).toBe('fallback-main');
    });

    it('should persist node ID on successful load', async () => {
      process.env.NODE_ID = 'node-1';
      mockNodeRepository.findWithSelect.mockResolvedValue({
        id: 'node-1',
        role: NodeRole.MAIN,
        mainNodeUrl: null,
        apiKey: 'key',
        name: 'Main',
      });

      await service.loadConfig();

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(expect.any(String), 'node-1', 'utf-8');
    });

    it('should detect node by IP address', async () => {
      mockOs.networkInterfaces.mockReturnValue({
        eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.100' }],
      });
      const mockNode = {
        id: 'ip-node',
        role: NodeRole.MAIN,
        mainNodeUrl: null,
        apiKey: 'key',
        name: 'IP Node',
      };
      // findManyByIp returns the node for IP strategy; findWithSelect loads its full config
      mockNodeRepository.findManyByIp.mockResolvedValue([mockNode]);
      mockNodeRepository.findWithSelect.mockResolvedValue(mockNode);

      await service.loadConfig();

      expect(service.getNodeId()).toBe('ip-node');
    });
  });

  describe('getConfig', () => {
    it('should return full config object', async () => {
      process.env.NODE_ID = 'node-1';
      mockNodeRepository.findWithSelect.mockResolvedValue({
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
      mockNodeRepository.findWithSelect.mockResolvedValue({
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
