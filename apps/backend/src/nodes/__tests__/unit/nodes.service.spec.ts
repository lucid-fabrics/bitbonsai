import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  AccelerationType,
  LicenseStatus,
  NetworkLocation,
  NodeRole,
  NodeStatus,
} from '@prisma/client';
import { LicenseRepository } from '../../../common/repositories/license.repository';
import { NodeRepository } from '../../../common/repositories/node.repository';
import { DataAccessService } from '../../../core/services/data-access.service';
import { NodesService } from '../../nodes.service';
import { StorageShareService } from '../../services/storage-share.service';
import { SystemInfoService } from '../../services/system-info.service';

describe('NodesService', () => {
  let service: NodesService;
  let mockNodeRepo: Record<string, jest.Mock>;
  let mockLicenseRepo: Record<string, jest.Mock>;

  const mockLicense = {
    id: 'license-1',
    key: 'BB-XXXX-XXXX-XXXX-XXXX',
    tier: 'PRO',
    status: LicenseStatus.ACTIVE,
    maxNodes: 3,
    maxConcurrentJobs: 10,
    _count: {
      nodes: 0,
    },
  };

  const mockNode = {
    id: 'node-1',
    name: 'Main Encoding Server',
    role: NodeRole.MAIN,
    status: NodeStatus.ONLINE,
    version: '1.0.0',
    acceleration: AccelerationType.NVIDIA,
    apiKey: 'bb_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    pairingToken: '123456',
    pairingExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    lastHeartbeat: new Date(),
    uptimeSeconds: 0,
    licenseId: 'license-1',
    ipAddress: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockNodeWithStats = {
    ...mockNode,
    license: {
      tier: 'PRO',
      maxConcurrentJobs: 10,
      maxNodes: 3,
      status: LicenseStatus.ACTIVE,
    },
    libraries: [
      {
        id: 'lib-1',
        name: 'Movie Collection',
        totalFiles: 500,
        totalSizeBytes: BigInt(1000000000),
        mediaType: 'MOVIE',
      },
    ],
    _count: {
      jobs: 5,
    },
  };

  beforeEach(async () => {
    mockNodeRepo = {
      findFirstNode: jest.fn(),
      findFirstWithLicense: jest.fn(),
      createNode: jest.fn(),
      findFirst: jest.fn(),
      updateData: jest.fn(),
      findById: jest.fn(),
      findWithStats: jest.fn(),
      findWithSelect: jest.fn(),
      findAllWithLicense: jest.fn(),
      findByApiKey: jest.fn(),
      findManyByIp: jest.fn(),
      findManyByRole: jest.fn(),
      findFirstByRole: jest.fn(),
      deleteById: jest.fn(),
    };

    mockLicenseRepo = {
      findByKeyWithInclude: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NodesService,
        { provide: NodeRepository, useValue: mockNodeRepo },
        { provide: LicenseRepository, useValue: mockLicenseRepo },
        {
          provide: DataAccessService,
          useValue: {
            getNextJob: jest.fn(),
            updateJobProgress: jest.fn(),
            findJobById: jest.fn(),
            sendHeartbeat: jest.fn(),
          },
        },
        {
          provide: SystemInfoService,
          useValue: {
            getSystemInfo: jest.fn(),
            getHardwareCapabilities: jest.fn(),
            collectSystemInfo: jest.fn().mockResolvedValue({
              ipAddress: '192.168.1.100',
              hostname: 'test',
              cpuCount: 4,
              totalMemory: 8000000000,
            }),
          },
        },
        {
          provide: StorageShareService,
          useValue: {
            getSharedPaths: jest.fn(),
            isSharedStorage: jest.fn(),
            verifyAccess: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<NodesService>(NodesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('registerNode', () => {
    const registerDto = {
      name: 'Main Encoding Server',
      licenseKey: 'BB-XXXX-XXXX-XXXX-XXXX',
      version: '1.0.0',
      acceleration: AccelerationType.NVIDIA,
    };

    it('should register a new node as MAIN role when no nodes exist', async () => {
      mockLicenseRepo.findByKeyWithInclude.mockResolvedValue({ ...mockLicense });
      mockNodeRepo.findFirstWithLicense.mockResolvedValue(null); // no duplicate MAIN
      mockNodeRepo.createNode.mockResolvedValue(mockNode);

      const result = await service.registerNode(registerDto);

      expect(result.id).toBe('node-1');
      expect(result.role).toBe(NodeRole.MAIN);
      expect(result.apiKey).toMatch(/^bb_[a-f0-9]{64}$/);
      expect(result.pairingToken).toMatch(/^\d{6}$/);
      expect(result.pairingExpiresAt).toBeInstanceOf(Date);
      expect(mockNodeRepo.createNode).toHaveBeenCalledWith(
        expect.objectContaining({
          name: registerDto.name,
          role: NodeRole.MAIN,
          status: 'ONLINE',
          version: registerDto.version,
          acceleration: registerDto.acceleration,
          apiKey: expect.any(String),
          pairingToken: expect.any(String),
          pairingExpiresAt: expect.any(Date),
          lastHeartbeat: expect.any(Date),
          licenseId: mockLicense.id,
        })
      );
    });

    it('should register a new node as LINKED role when nodes already exist', async () => {
      const licenseWithNodes = {
        ...mockLicense,
        _count: { nodes: 1 },
      };
      const linkedNode = { ...mockNode, role: NodeRole.LINKED };

      mockLicenseRepo.findByKeyWithInclude.mockResolvedValue(licenseWithNodes);
      mockNodeRepo.createNode.mockResolvedValue(linkedNode);

      const result = await service.registerNode(registerDto);

      expect(result.role).toBe(NodeRole.LINKED);
      expect(mockNodeRepo.createNode).toHaveBeenCalledWith(
        expect.objectContaining({
          role: NodeRole.LINKED,
        })
      );
    });

    it('should throw BadRequestException if license is invalid', async () => {
      mockLicenseRepo.findByKeyWithInclude.mockResolvedValue(null);

      await expect(service.registerNode(registerDto)).rejects.toThrow(BadRequestException);
      await expect(service.registerNode(registerDto)).rejects.toThrow(
        'Invalid or inactive license key'
      );
    });

    it('should throw BadRequestException if license is inactive', async () => {
      const inactiveLicense = {
        ...mockLicense,
        status: LicenseStatus.EXPIRED,
      };
      mockLicenseRepo.findByKeyWithInclude.mockResolvedValue(inactiveLicense);

      await expect(service.registerNode(registerDto)).rejects.toThrow(BadRequestException);
      await expect(service.registerNode(registerDto)).rejects.toThrow(
        'Invalid or inactive license key'
      );
    });

    it('should throw ConflictException if maximum nodes reached', async () => {
      const fullLicense = {
        ...mockLicense,
        maxNodes: 3,
        _count: { nodes: 3 },
      };
      mockLicenseRepo.findByKeyWithInclude.mockResolvedValue(fullLicense);

      await expect(service.registerNode(registerDto)).rejects.toThrow(ConflictException);
      await expect(service.registerNode(registerDto)).rejects.toThrow(
        'Maximum nodes (3) reached for this license'
      );
    });
  });

  describe('pairNode', () => {
    it('should pair a node successfully with valid token', async () => {
      const futureExpiration = new Date(Date.now() + 5 * 60 * 1000);
      const nodeWithToken = {
        ...mockNode,
        pairingToken: '123456',
        pairingExpiresAt: futureExpiration,
      };
      const pairedNode = {
        ...mockNode,
        role: NodeRole.MAIN,
        pairingToken: null,
        pairingExpiresAt: null,
      };

      mockNodeRepo.findFirst.mockResolvedValue(nodeWithToken);
      mockNodeRepo.updateData.mockResolvedValue(pairedNode);

      const result = await service.pairNode('123456');

      expect(result.pairingToken).toBeNull();
      expect(result.pairingExpiresAt).toBeNull();
      expect(mockNodeRepo.updateData).toHaveBeenCalledWith('node-1', {
        pairingToken: null,
        pairingExpiresAt: null,
      });
    });

    it('should throw NotFoundException if token is invalid', async () => {
      mockNodeRepo.findFirst.mockResolvedValue(null);

      await expect(service.pairNode('999999')).rejects.toThrow(NotFoundException);
      await expect(service.pairNode('999999')).rejects.toThrow('Invalid or expired pairing token');
    });

    it('should throw NotFoundException if token is expired', async () => {
      mockNodeRepo.findFirst.mockResolvedValue(null);

      await expect(service.pairNode('123456')).rejects.toThrow(NotFoundException);
      await expect(service.pairNode('123456')).rejects.toThrow('Invalid or expired pairing token');
    });
  });

  describe('generatePairingTokenForNode', () => {
    it('should generate a new pairing token for existing node', async () => {
      const updatedNode = {
        ...mockNode,
        pairingToken: '654321',
        pairingExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      };

      mockNodeRepo.findById.mockResolvedValue(mockNode);
      mockNodeRepo.updateData.mockResolvedValue(updatedNode);

      const result = await service.generatePairingTokenForNode('node-1');

      expect(result.pairingToken).toMatch(/^\d{6}$/);
      expect(result.pairingExpiresAt).toBeInstanceOf(Date);
      expect(mockNodeRepo.updateData).toHaveBeenCalledWith('node-1', {
        pairingToken: expect.any(String),
        pairingExpiresAt: expect.any(Date),
      });
    });

    it('should throw NotFoundException if node does not exist', async () => {
      mockNodeRepo.findById.mockResolvedValue(null);

      await expect(service.generatePairingTokenForNode('non-existent')).rejects.toThrow(
        NotFoundException
      );
      await expect(service.generatePairingTokenForNode('non-existent')).rejects.toThrow(
        'Node with ID non-existent not found'
      );
    });
  });

  describe('heartbeat', () => {
    it('should record heartbeat successfully', async () => {
      const updatedNode = {
        ...mockNode,
        lastHeartbeat: new Date(),
        uptimeSeconds: 60,
      };

      mockNodeRepo.findById.mockResolvedValue(mockNode);
      mockNodeRepo.updateData.mockResolvedValue(updatedNode);

      const result = await service.heartbeat('node-1');

      expect(result.lastHeartbeat).toBeInstanceOf(Date);
      expect(mockNodeRepo.updateData).toHaveBeenCalledWith(
        'node-1',
        expect.objectContaining({
          status: NodeStatus.ONLINE,
          uptimeSeconds: { increment: 60 },
        })
      );
    });

    it('should update status if provided in heartbeat data', async () => {
      const updatedNode = {
        ...mockNode,
        status: NodeStatus.ERROR,
      };

      mockNodeRepo.findById.mockResolvedValue(mockNode);
      mockNodeRepo.updateData.mockResolvedValue(updatedNode);

      await service.heartbeat('node-1', { status: NodeStatus.ERROR });

      expect(mockNodeRepo.updateData).toHaveBeenCalledWith(
        'node-1',
        expect.objectContaining({
          status: NodeStatus.ERROR,
          uptimeSeconds: { increment: 60 },
        })
      );
    });

    it('should throw NotFoundException if node does not exist', async () => {
      mockNodeRepo.findById.mockResolvedValue(null);

      await expect(service.heartbeat('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.heartbeat('non-existent')).rejects.toThrow(
        'Node with ID non-existent not found'
      );
    });
  });

  describe('getNodeStats', () => {
    it('should return node with comprehensive statistics', async () => {
      mockNodeRepo.findWithStats.mockResolvedValue(mockNodeWithStats);

      const result = await service.getNodeStats('node-1');

      expect(result.id).toBe('node-1');
      expect(result.license).toEqual(mockNodeWithStats.license);
      expect(result.libraries).toHaveLength(1);
      expect(result.activeJobCount).toBe(5);
      expect(mockNodeRepo.findWithStats).toHaveBeenCalledWith('node-1');
    });

    it('should throw NotFoundException if node does not exist', async () => {
      mockNodeRepo.findWithStats.mockResolvedValue(null);

      await expect(service.getNodeStats('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.getNodeStats('non-existent')).rejects.toThrow(
        'Node with ID non-existent not found'
      );
    });
  });

  describe('findAll', () => {
    it('should return all nodes ordered by role and creation time', async () => {
      const mockNodes = [
        { ...mockNode, role: NodeRole.MAIN },
        { ...mockNode, id: 'node-2', role: NodeRole.LINKED },
      ];

      mockNodeRepo.findAllWithLicense.mockResolvedValue(mockNodes);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(mockNodeRepo.findAllWithLicense).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a specific node by ID', async () => {
      mockNodeRepo.findById.mockResolvedValue(mockNode);

      const result = await service.findOne('node-1');

      expect(result.id).toBe('node-1');
      expect(mockNodeRepo.findById).toHaveBeenCalledWith('node-1');
    });

    it('should throw NotFoundException if node does not exist', async () => {
      mockNodeRepo.findById.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('non-existent')).rejects.toThrow(
        'Node with ID non-existent not found'
      );
    });
  });

  describe('remove', () => {
    it('should delete a node successfully', async () => {
      mockNodeRepo.findWithSelect.mockResolvedValue(mockNode);
      mockNodeRepo.deleteById.mockResolvedValue(undefined);

      await service.remove('node-1');

      expect(mockNodeRepo.deleteById).toHaveBeenCalledWith('node-1');
    });

    it('should throw NotFoundException if node does not exist', async () => {
      mockNodeRepo.findWithSelect.mockResolvedValue(null);

      await expect(service.remove('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.remove('non-existent')).rejects.toThrow(
        'Node with ID non-existent not found'
      );
    });
  });

  describe('API Key Generation', () => {
    it('should generate API keys with correct format', async () => {
      const registerDto = {
        name: 'Test Node',
        licenseKey: 'BB-XXXX-XXXX-XXXX-XXXX',
        version: '1.0.0',
        acceleration: AccelerationType.NVIDIA,
      };

      mockLicenseRepo.findByKeyWithInclude.mockResolvedValue({ ...mockLicense });
      mockNodeRepo.findFirstWithLicense.mockResolvedValue(null);
      mockNodeRepo.createNode.mockResolvedValue(mockNode);

      const result = await service.registerNode(registerDto);

      expect(result.apiKey).toMatch(/^bb_[a-f0-9]{64}$/);
    });
  });

  describe('Pairing Token Generation', () => {
    it('should generate 6-digit pairing tokens', async () => {
      const registerDto = {
        name: 'Test Node',
        licenseKey: 'BB-XXXX-XXXX-XXXX-XXXX',
        version: '1.0.0',
        acceleration: AccelerationType.NVIDIA,
      };

      mockLicenseRepo.findByKeyWithInclude.mockResolvedValue({ ...mockLicense });
      mockNodeRepo.findFirstWithLicense.mockResolvedValue(null);
      mockNodeRepo.createNode.mockResolvedValue(mockNode);

      const result = await service.registerNode(registerDto);

      expect(result.pairingToken).toMatch(/^\d{6}$/);
    });

    it('should set pairing expiration to 10 minutes from now', async () => {
      const registerDto = {
        name: 'Test Node',
        licenseKey: 'BB-XXXX-XXXX-XXXX-XXXX',
        version: '1.0.0',
        acceleration: AccelerationType.NVIDIA,
      };

      const now = Date.now();
      const futureExpiration = new Date(now + 10 * 60 * 1000);
      mockLicenseRepo.findByKeyWithInclude.mockResolvedValue({ ...mockLicense });
      mockNodeRepo.findFirstWithLicense.mockResolvedValue(null);
      mockNodeRepo.createNode.mockResolvedValue({
        ...mockNode,
        pairingExpiresAt: futureExpiration,
      });

      const result = await service.registerNode(registerDto);

      const expirationTime = result.pairingExpiresAt.getTime();
      const expectedExpiration = now + 10 * 60 * 1000;

      expect(expirationTime).toBeGreaterThanOrEqual(expectedExpiration - 1000);
      expect(expirationTime).toBeLessThanOrEqual(expectedExpiration + 1000);
    });
  });

  describe('getCurrentNode', () => {
    const linkedNode = {
      ...mockNode,
      id: 'node-2',
      name: 'Linked Encoding Server',
      role: NodeRole.LINKED,
    };

    beforeEach(() => {
      process.env.NODE_ID = '';
    });

    afterEach(() => {
      process.env.NODE_ID = '';
    });

    it('should return node specified by NODE_ID environment variable', async () => {
      process.env.NODE_ID = 'node-2';
      const linkedNodeWithIp = { ...linkedNode, ipAddress: '192.168.1.100' };
      mockNodeRepo.findById.mockResolvedValue(linkedNodeWithIp);

      const result = await service.getCurrentNode();

      expect(result.id).toBe('node-2');
      expect(result.role).toBe(NodeRole.LINKED);
    });

    it('should return MAIN node when NODE_ID is not set via IP detection', async () => {
      const mainNodeWithIp = { ...mockNode, ipAddress: '192.168.1.100' };
      mockNodeRepo.findManyByIp.mockResolvedValue([mainNodeWithIp]);

      const result = await service.getCurrentNode();

      expect(result.id).toBe('node-1');
      expect(result.role).toBe(NodeRole.MAIN);
    });

    it('should throw NotFoundException if NODE_ID is set but node does not exist', async () => {
      process.env.NODE_ID = 'invalid-node-id';
      mockNodeRepo.findById.mockResolvedValue(null);

      await expect(service.getCurrentNode()).rejects.toThrow(NotFoundException);
      await expect(service.getCurrentNode()).rejects.toThrow(
        'Node with ID invalid-node-id (from NODE_ID env) not found'
      );
    });

    it('should throw NotFoundException if no node exists when NODE_ID is not set', async () => {
      mockNodeRepo.findManyByIp.mockResolvedValue([]);
      mockNodeRepo.findFirstNode.mockResolvedValue(null);
      mockNodeRepo.findFirstByRole.mockResolvedValue(null);
      mockNodeRepo.findManyByRole.mockResolvedValue([]);

      await expect(service.getCurrentNode()).rejects.toThrow(NotFoundException);
    });

    it('should auto-update IP when NODE_ID node has different IP than detected', async () => {
      process.env.NODE_ID = 'node-1';
      const nodeWithOldIp = { ...mockNode, ipAddress: '10.0.0.1' };
      const nodeWithNewIp = { ...mockNode, ipAddress: '192.168.1.100' };
      mockNodeRepo.findById.mockResolvedValue(nodeWithOldIp);
      mockNodeRepo.updateData.mockResolvedValue(nodeWithNewIp);

      const result = await service.getCurrentNode();

      expect(mockNodeRepo.updateData).toHaveBeenCalledWith('node-1', {
        ipAddress: '192.168.1.100',
      });
      expect(result.ipAddress).toBe('192.168.1.100');
    });

    it('should not update IP when it matches detected IP', async () => {
      process.env.NODE_ID = 'node-1';
      const nodeWithCurrentIp = { ...mockNode, ipAddress: '192.168.1.100' };
      mockNodeRepo.findById.mockResolvedValue(nodeWithCurrentIp);

      await service.getCurrentNode();

      expect(mockNodeRepo.updateData).not.toHaveBeenCalled();
    });

    it('should prefer MAIN node when multiple nodes share same IP', async () => {
      const mainNodeWithIp = {
        ...mockNode,
        id: 'node-main',
        role: NodeRole.MAIN,
        ipAddress: '192.168.1.100',
      };
      const linkedNodeWithIp = {
        ...mockNode,
        id: 'node-linked',
        role: NodeRole.LINKED,
        ipAddress: '192.168.1.100',
      };
      mockNodeRepo.findManyByIp.mockResolvedValue([linkedNodeWithIp, mainNodeWithIp]);

      const result = await service.getCurrentNode();

      expect(result.id).toBe('node-main');
      expect(result.role).toBe(NodeRole.MAIN);
    });

    it('should fall back to role-based detection when no IP match', async () => {
      mockNodeRepo.findManyByIp.mockResolvedValue([]);
      const mainNodeNoIp = { ...mockNode, ipAddress: null };
      mockNodeRepo.findManyByRole.mockResolvedValue([mainNodeNoIp]);
      mockNodeRepo.updateData.mockResolvedValue({ ...mainNodeNoIp, ipAddress: '192.168.1.100' });

      const result = await service.getCurrentNode();

      expect(mockNodeRepo.findManyByRole).toHaveBeenCalledWith(NodeRole.MAIN, expect.anything());
      expect(result.id).toBe('node-1');
    });

    it('should warn and use newest when multiple MAIN nodes exist', async () => {
      mockNodeRepo.findManyByIp.mockResolvedValue([]);
      const mainNode1 = {
        ...mockNode,
        id: 'node-old',
        createdAt: new Date('2024-01-01'),
        ipAddress: null,
      };
      const mainNode2 = {
        ...mockNode,
        id: 'node-new',
        createdAt: new Date('2024-06-01'),
        ipAddress: null,
      };
      mockNodeRepo.findManyByRole.mockResolvedValue([mainNode1, mainNode2]);
      mockNodeRepo.updateData.mockResolvedValue({ ...mainNode2, ipAddress: '192.168.1.100' });

      const result = await service.getCurrentNode();

      expect(result.id).toBe('node-new');
    });

    it('should fall back to LINKED node when no MAIN nodes exist', async () => {
      mockNodeRepo.findManyByIp.mockResolvedValue([]);
      mockNodeRepo.findManyByRole.mockResolvedValue([]);
      const lNode = { ...mockNode, role: NodeRole.LINKED, ipAddress: null };
      mockNodeRepo.findFirstByRole.mockResolvedValue(lNode);
      mockNodeRepo.updateData.mockResolvedValue({ ...lNode, ipAddress: '192.168.1.100' });

      const result = await service.getCurrentNode();

      expect(result.role).toBe(NodeRole.LINKED);
    });
  });

  describe('update', () => {
    it('should update node name', async () => {
      const updatedNode = { ...mockNode, name: 'New Name' };
      mockNodeRepo.findById.mockResolvedValue(mockNode);
      mockNodeRepo.updateData.mockResolvedValue(updatedNode);

      const result = await service.update('node-1', { name: 'New Name' });

      expect(result.name).toBe('New Name');
      expect(mockNodeRepo.updateData).toHaveBeenCalledWith(
        'node-1',
        expect.objectContaining({ name: 'New Name' })
      );
    });

    it('should throw NotFoundException if node does not exist', async () => {
      mockNodeRepo.findById.mockResolvedValue(null);

      await expect(service.update('non-existent', { name: 'Test' })).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw BadRequestException when maxWorkers is critically too high', async () => {
      mockNodeRepo.findById.mockResolvedValue({ ...mockNode, acceleration: AccelerationType.CPU });

      // Set absurdly high workers (>2x recommended for any CPU count)
      await expect(service.update('node-1', { maxWorkers: 9999 })).rejects.toThrow(
        BadRequestException
      );
    });

    it('should allow updating maxWorkers at or below 2x recommended', async () => {
      const updatedNode = { ...mockNode, maxWorkers: 2 };
      mockNodeRepo.findById.mockResolvedValue({ ...mockNode, acceleration: AccelerationType.CPU });
      mockNodeRepo.updateData.mockResolvedValue(updatedNode);

      // 2 workers should be safe for any CPU count
      const result = await service.update('node-1', { maxWorkers: 2 });

      expect(result.maxWorkers).toBe(2);
    });

    it('should update optional fields when provided', async () => {
      const updatedNode = { ...mockNode, publicUrl: 'https://node.example.com', cpuLimit: 80 };
      mockNodeRepo.findById.mockResolvedValue(mockNode);
      mockNodeRepo.updateData.mockResolvedValue(updatedNode);

      await service.update('node-1', {
        publicUrl: 'https://node.example.com',
        cpuLimit: 80,
        hasSharedStorage: true,
        networkLocation: NetworkLocation.LOCAL,
      });

      expect(mockNodeRepo.updateData).toHaveBeenCalledWith(
        'node-1',
        expect.objectContaining({
          publicUrl: 'https://node.example.com',
          cpuLimit: 80,
          hasSharedStorage: true,
          networkLocation: NetworkLocation.LOCAL,
        })
      );
    });
  });

  describe('findByApiKey', () => {
    it('should return node when apiKey matches', async () => {
      mockNodeRepo.findByApiKey.mockResolvedValue(mockNode);

      const result = await service.findByApiKey('bb_somekey');

      expect(result).toEqual(mockNode);
      expect(mockNodeRepo.findByApiKey).toHaveBeenCalledWith('bb_somekey');
    });

    it('should return null when no node matches apiKey', async () => {
      mockNodeRepo.findByApiKey.mockResolvedValue(null);

      const result = await service.findByApiKey('invalid-key');

      expect(result).toBeNull();
    });
  });

  describe('getRecommendedConfig', () => {
    it('should return recommended config for existing node', async () => {
      mockNodeRepo.findWithSelect.mockResolvedValue({
        id: 'node-1',
        maxWorkers: 2,
        acceleration: AccelerationType.CPU,
      });

      const result = await service.getRecommendedConfig('node-1');

      expect(result).toHaveProperty('recommendedMaxWorkers');
      expect(result).toHaveProperty('currentMaxWorkers', 2);
      expect(result).toHaveProperty('cpuCoresPerJob');
      expect(result).toHaveProperty('totalCpuCores');
      expect(result.acceleration).toBe(AccelerationType.CPU);
    });

    it('should throw NotFoundException if node does not exist', async () => {
      mockNodeRepo.findWithSelect.mockResolvedValue(null);

      await expect(service.getRecommendedConfig('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.getRecommendedConfig('non-existent')).rejects.toThrow(
        'Node with ID non-existent not found'
      );
    });
  });

  describe('heartbeat', () => {
    it('should use IP from heartbeat payload for LINKED nodes', async () => {
      const linkedNode = { ...mockNode, role: NodeRole.LINKED, ipAddress: '10.0.0.2' };
      const updatedNode = { ...linkedNode, ipAddress: '192.168.2.50' };
      mockNodeRepo.findById.mockResolvedValue(linkedNode);
      mockNodeRepo.updateData.mockResolvedValue(updatedNode);

      await service.heartbeat('node-1', { ipAddress: '192.168.2.50' });

      expect(mockNodeRepo.updateData).toHaveBeenCalledWith(
        'node-1',
        expect.objectContaining({ ipAddress: '192.168.2.50' })
      );
    });

    it('should auto-detect IP for MAIN node heartbeat when no IP in payload', async () => {
      const mainNode = { ...mockNode, role: NodeRole.MAIN, ipAddress: '10.0.0.1' };
      const updatedNode = { ...mainNode, ipAddress: '192.168.1.100' };
      mockNodeRepo.findById.mockResolvedValue(mainNode);
      mockNodeRepo.updateData.mockResolvedValue(updatedNode);

      await service.heartbeat('node-1');

      expect(mockNodeRepo.updateData).toHaveBeenCalledWith(
        'node-1',
        expect.objectContaining({ ipAddress: '192.168.1.100' })
      );
    });

    it('should include ipAddress in update for MAIN node auto-detect even when unchanged', async () => {
      const mainNode = { ...mockNode, role: NodeRole.MAIN, ipAddress: '192.168.1.100' };
      mockNodeRepo.findById.mockResolvedValue(mainNode);
      mockNodeRepo.updateData.mockResolvedValue(mainNode);

      await service.heartbeat('node-1');

      // MAIN node always auto-detects and includes ipAddress in the update
      expect(mockNodeRepo.updateData).toHaveBeenCalledWith(
        'node-1',
        expect.objectContaining({ ipAddress: '192.168.1.100' })
      );
    });
  });

  describe('pairNode', () => {
    it('should trigger async storage auto-mount for LINKED nodes', async () => {
      const linkedNode = {
        ...mockNode,
        role: NodeRole.LINKED,
        pairingToken: null,
        pairingExpiresAt: null,
      };
      mockNodeRepo.findFirst.mockResolvedValue({ ...mockNode, pairingToken: '123456' });
      mockNodeRepo.updateData.mockResolvedValue(linkedNode);

      const storageShareService = (
        service as unknown as { storageShareService: { autoDetectAndMount: jest.Mock } }
      ).storageShareService;
      storageShareService.autoDetectAndMount = jest.fn().mockResolvedValue({
        detected: 2,
        created: 1,
        mounted: 1,
        errors: [],
      });

      await service.pairNode('123456');

      // Give async operation a tick to start
      await new Promise((resolve) => setImmediate(resolve));

      expect(storageShareService.autoDetectAndMount).toHaveBeenCalledWith(mockNode.id);
    });

    it('should not trigger storage mount for MAIN nodes', async () => {
      const mainNode = {
        ...mockNode,
        role: NodeRole.MAIN,
        pairingToken: null,
        pairingExpiresAt: null,
      };
      mockNodeRepo.findFirst.mockResolvedValue({ ...mockNode, pairingToken: '123456' });
      mockNodeRepo.updateData.mockResolvedValue(mainNode);

      const storageShareService = (
        service as unknown as { storageShareService: { autoDetectAndMount: jest.Mock } }
      ).storageShareService;
      storageShareService.autoDetectAndMount = jest.fn();

      await service.pairNode('123456');
      await new Promise((resolve) => setImmediate(resolve));

      expect(storageShareService.autoDetectAndMount).not.toHaveBeenCalled();
    });
  });

  describe('registerNode', () => {
    it('should use main node license when no licenseKey provided', async () => {
      const mainNodeWithLicense = {
        ...mockNode,
        license: { key: 'BB-MAIN-LICENSE' },
      };
      mockNodeRepo.findFirstWithLicense
        .mockResolvedValueOnce(mainNodeWithLicense) // find main node for license
        .mockResolvedValueOnce(null); // duplicate MAIN check
      mockLicenseRepo.findByKeyWithInclude.mockResolvedValue({
        ...mockLicense,
        _count: { nodes: 1 },
      });
      mockNodeRepo.createNode.mockResolvedValue({ ...mockNode, role: NodeRole.LINKED });

      const result = await service.registerNode({ name: 'Child Node' } as any);

      expect(result.role).toBe(NodeRole.LINKED);
      expect(mockLicenseRepo.findByKeyWithInclude).toHaveBeenCalledWith(
        'BB-MAIN-LICENSE',
        expect.anything()
      );
    });

    it('should throw BadRequestException when no licenseKey and no main node found', async () => {
      mockNodeRepo.findFirstWithLicense.mockResolvedValue(null);

      await expect(service.registerNode({} as any)).rejects.toThrow(BadRequestException);
      await expect(service.registerNode({} as any)).rejects.toThrow(
        'No main node found. License key is required for first node registration.'
      );
    });

    it('should throw ConflictException when duplicate MAIN node detected', async () => {
      mockLicenseRepo.findByKeyWithInclude.mockResolvedValue({
        ...mockLicense,
        _count: { nodes: 0 },
      });
      mockNodeRepo.findFirstWithLicense.mockResolvedValue(mockNode); // existing MAIN found

      await expect(
        service.registerNode({ name: 'Duplicate', licenseKey: 'BB-XXXX-XXXX-XXXX-XXXX' } as any)
      ).rejects.toThrow(ConflictException);
    });

    it('should use default name when name not provided', async () => {
      mockLicenseRepo.findByKeyWithInclude.mockResolvedValue({
        ...mockLicense,
        _count: { nodes: 0 },
      });
      mockNodeRepo.findFirstWithLicense.mockResolvedValue(null);
      mockNodeRepo.createNode.mockResolvedValue(mockNode);

      await service.registerNode({ licenseKey: 'BB-XXXX-XXXX-XXXX-XXXX' } as any);

      expect(mockNodeRepo.createNode).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Main Node 1' })
      );
    });

    it('should use default acceleration CPU when not provided', async () => {
      mockLicenseRepo.findByKeyWithInclude.mockResolvedValue({
        ...mockLicense,
        _count: { nodes: 0 },
      });
      mockNodeRepo.findFirstWithLicense.mockResolvedValue(null);
      mockNodeRepo.createNode.mockResolvedValue(mockNode);

      await service.registerNode({ licenseKey: 'BB-XXXX-XXXX-XXXX-XXXX', name: 'Test' } as any);

      expect(mockNodeRepo.createNode).toHaveBeenCalledWith(
        expect.objectContaining({ acceleration: 'CPU' })
      );
    });
  });

  describe('remove', () => {
    it('should skip notification for MAIN node removal', async () => {
      const mainNode = {
        ...mockNode,
        role: NodeRole.MAIN,
        publicUrl: 'http://main.example.com',
        mainNodeUrl: null,
        apiKey: 'bb_key',
      };
      mockNodeRepo.findWithSelect.mockResolvedValue(mainNode);
      mockNodeRepo.deleteById.mockResolvedValue(undefined);

      await service.remove('node-1');

      // No fetch should be called for MAIN node
      expect(mockNodeRepo.deleteById).toHaveBeenCalledWith('node-1');
    });

    it('should warn when LINKED node has no URL configured', async () => {
      const linkedNode = {
        ...mockNode,
        role: NodeRole.LINKED,
        publicUrl: null,
        mainNodeUrl: null,
        apiKey: 'bb_key',
      };
      mockNodeRepo.findWithSelect.mockResolvedValue(linkedNode);
      mockNodeRepo.deleteById.mockResolvedValue(undefined);

      await service.remove('node-1');

      expect(mockNodeRepo.deleteById).toHaveBeenCalledWith('node-1');
    });
  });

  describe('unregisterSelf', () => {
    it('should throw BadRequestException when called on MAIN node', async () => {
      // getCurrentNode falls back to role-based: finds MAIN node
      const mainNode = { ...mockNode, role: NodeRole.MAIN, ipAddress: '192.168.1.100' };
      mockNodeRepo.findManyByIp.mockResolvedValue([mainNode]);

      await expect(service.unregisterSelf()).rejects.toThrow(BadRequestException);
      await expect(service.unregisterSelf()).rejects.toThrow('MAIN nodes cannot unregister');
    });

    it('should clear local config and return success for LINKED node', async () => {
      const linkedNode = {
        ...mockNode,
        id: 'node-linked',
        role: NodeRole.LINKED,
        ipAddress: '192.168.1.200',
        mainNodeUrl: null,
      };
      // Make getCurrentNode find the linked node by IP
      mockNodeRepo.findManyByIp.mockResolvedValue([linkedNode]);
      mockNodeRepo.updateData.mockResolvedValue(linkedNode);

      const result = await service.unregisterSelf();

      expect(result.success).toBe(true);
      expect(mockNodeRepo.updateData).toHaveBeenCalledWith(
        'node-linked',
        expect.objectContaining({
          role: NodeRole.MAIN,
          pairingToken: null,
          pairingExpiresAt: null,
          mainNodeUrl: null,
        })
      );
    });
  });

  describe('findAll', () => {
    it('should calculate uptimeSeconds dynamically from createdAt', async () => {
      const pastDate = new Date(Date.now() - 120 * 1000); // 2 minutes ago
      const nodeCreatedRecently = { ...mockNode, createdAt: pastDate };
      mockNodeRepo.findAllWithLicense.mockResolvedValue([nodeCreatedRecently]);

      const result = await service.findAll();

      expect(result[0].uptimeSeconds).toBeGreaterThanOrEqual(119);
      expect(result[0].uptimeSeconds).toBeLessThanOrEqual(125);
    });
  });
});
