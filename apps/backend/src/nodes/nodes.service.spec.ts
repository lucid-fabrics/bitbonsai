import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AccelerationType, LicenseStatus, NodeRole, NodeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NodesService } from './nodes.service';

describe('NodesService', () => {
  let service: NodesService;
  let prisma: PrismaService;

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
    apiKey: 'bb_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2',
    pairingToken: '123456',
    pairingExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    lastHeartbeat: new Date(),
    uptimeSeconds: 0,
    licenseId: 'license-1',
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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NodesService,
        {
          provide: PrismaService,
          useValue: {
            license: {
              findUnique: jest.fn(),
            },
            node: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<NodesService>(NodesService);
    prisma = module.get<PrismaService>(PrismaService);
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
      jest.spyOn(prisma.license, 'findUnique').mockResolvedValue({ ...mockLicense } as any);
      jest.spyOn(prisma.node, 'create').mockResolvedValue(mockNode as any);

      const result = await service.registerNode(registerDto);

      expect(result.id).toBe('node-1');
      expect(result.role).toBe(NodeRole.MAIN);
      expect(result.apiKey).toMatch(/^bb_[a-f0-9]{64}$/);
      expect(result.pairingToken).toMatch(/^\d{6}$/);
      expect(result.pairingExpiresAt).toBeInstanceOf(Date);
      expect(prisma.node.create).toHaveBeenCalledWith({
        data: {
          name: registerDto.name,
          role: NodeRole.MAIN,
          status: NodeStatus.ONLINE,
          version: registerDto.version,
          acceleration: registerDto.acceleration,
          apiKey: expect.any(String),
          pairingToken: expect.any(String),
          pairingExpiresAt: expect.any(Date),
          lastHeartbeat: expect.any(Date),
          licenseId: mockLicense.id,
        },
      });
    });

    it('should register a new node as LINKED role when nodes already exist', async () => {
      const licenseWithNodes = {
        ...mockLicense,
        _count: { nodes: 1 },
      };
      const linkedNode = { ...mockNode, role: NodeRole.LINKED };

      jest.spyOn(prisma.license, 'findUnique').mockResolvedValue(licenseWithNodes as any);
      jest.spyOn(prisma.node, 'create').mockResolvedValue(linkedNode as any);

      const result = await service.registerNode(registerDto);

      expect(result.role).toBe(NodeRole.LINKED);
      expect(prisma.node.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          role: NodeRole.LINKED,
        }),
      });
    });

    it('should throw BadRequestException if license is invalid', async () => {
      jest.spyOn(prisma.license, 'findUnique').mockResolvedValue(null);

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
      jest.spyOn(prisma.license, 'findUnique').mockResolvedValue(inactiveLicense as any);

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
      jest.spyOn(prisma.license, 'findUnique').mockResolvedValue(fullLicense as any);

      await expect(service.registerNode(registerDto)).rejects.toThrow(ConflictException);
      await expect(service.registerNode(registerDto)).rejects.toThrow(
        'Maximum nodes (3) reached for this license'
      );
    });
  });

  describe('pairNode', () => {
    it('should pair a node successfully with valid token', async () => {
      const futureExpiration = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now
      const nodeWithToken = {
        ...mockNode,
        pairingToken: '123456',
        pairingExpiresAt: futureExpiration,
      };
      const pairedNode = {
        ...mockNode,
        pairingToken: null,
        pairingExpiresAt: null,
      };

      jest.spyOn(prisma.node, 'findFirst').mockResolvedValue(nodeWithToken as any);
      jest.spyOn(prisma.node, 'update').mockResolvedValue(pairedNode as any);

      const result = await service.pairNode('123456');

      expect(result.pairingToken).toBeNull();
      expect(result.pairingExpiresAt).toBeNull();
      expect(prisma.node.update).toHaveBeenCalledWith({
        where: { id: 'node-1' },
        data: {
          pairingToken: null,
          pairingExpiresAt: null,
        },
      });
    });

    it('should throw NotFoundException if token is invalid', async () => {
      jest.spyOn(prisma.node, 'findFirst').mockResolvedValue(null);

      await expect(service.pairNode('999999')).rejects.toThrow(NotFoundException);
      await expect(service.pairNode('999999')).rejects.toThrow('Invalid or expired pairing token');
    });

    it('should throw NotFoundException if token is expired', async () => {
      jest.spyOn(prisma.node, 'findFirst').mockResolvedValue(null);

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

      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as any);
      jest.spyOn(prisma.node, 'update').mockResolvedValue(updatedNode as any);

      const result = await service.generatePairingTokenForNode('node-1');

      expect(result.pairingToken).toMatch(/^\d{6}$/);
      expect(result.pairingExpiresAt).toBeInstanceOf(Date);
      expect(prisma.node.update).toHaveBeenCalledWith({
        where: { id: 'node-1' },
        data: {
          pairingToken: expect.any(String),
          pairingExpiresAt: expect.any(Date),
        },
      });
    });

    it('should throw NotFoundException if node does not exist', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(null);

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

      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as any);
      jest.spyOn(prisma.node, 'update').mockResolvedValue(updatedNode as any);

      const result = await service.heartbeat('node-1');

      expect(result.lastHeartbeat).toBeInstanceOf(Date);
      expect(prisma.node.update).toHaveBeenCalledWith({
        where: { id: 'node-1' },
        data: {
          status: NodeStatus.ONLINE,
          lastHeartbeat: expect.any(Date),
          uptimeSeconds: { increment: 60 },
        },
      });
    });

    it('should update status if provided in heartbeat data', async () => {
      const updatedNode = {
        ...mockNode,
        status: NodeStatus.MAINTENANCE,
      };

      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as any);
      jest.spyOn(prisma.node, 'update').mockResolvedValue(updatedNode as any);

      await service.heartbeat('node-1', { status: NodeStatus.MAINTENANCE });

      expect(prisma.node.update).toHaveBeenCalledWith({
        where: { id: 'node-1' },
        data: {
          status: NodeStatus.MAINTENANCE,
          lastHeartbeat: expect.any(Date),
          uptimeSeconds: { increment: 60 },
        },
      });
    });

    it('should throw NotFoundException if node does not exist', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(null);

      await expect(service.heartbeat('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.heartbeat('non-existent')).rejects.toThrow(
        'Node with ID non-existent not found'
      );
    });
  });

  describe('getNodeStats', () => {
    it('should return node with comprehensive statistics', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNodeWithStats as any);

      const result = await service.getNodeStats('node-1');

      expect(result.id).toBe('node-1');
      expect(result.license).toBeDefined();
      expect(result.libraries).toHaveLength(1);
      expect(result.activeJobCount).toBe(5);
      expect(prisma.node.findUnique).toHaveBeenCalledWith({
        where: { id: 'node-1' },
        include: {
          license: {
            select: {
              tier: true,
              maxConcurrentJobs: true,
              maxNodes: true,
              status: true,
            },
          },
          libraries: {
            select: {
              id: true,
              name: true,
              totalFiles: true,
              totalSizeBytes: true,
              mediaType: true,
            },
          },
          _count: {
            select: {
              jobs: {
                where: {
                  stage: { in: ['QUEUED', 'ENCODING', 'VERIFYING'] },
                },
              },
            },
          },
        },
      });
    });

    it('should throw NotFoundException if node does not exist', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(null);

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

      jest.spyOn(prisma.node, 'findMany').mockResolvedValue(mockNodes as any);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(prisma.node.findMany).toHaveBeenCalledWith({
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      });
    });
  });

  describe('findOne', () => {
    it('should return a specific node by ID', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as any);

      const result = await service.findOne('node-1');

      expect(result.id).toBe('node-1');
      expect(prisma.node.findUnique).toHaveBeenCalledWith({
        where: { id: 'node-1' },
      });
    });

    it('should throw NotFoundException if node does not exist', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('non-existent')).rejects.toThrow(
        'Node with ID non-existent not found'
      );
    });
  });

  describe('remove', () => {
    it('should delete a node successfully', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as any);
      jest.spyOn(prisma.node, 'delete').mockResolvedValue(mockNode as any);

      await service.remove('node-1');

      expect(prisma.node.delete).toHaveBeenCalledWith({
        where: { id: 'node-1' },
      });
    });

    it('should throw NotFoundException if node does not exist', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(null);

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

      jest.spyOn(prisma.license, 'findUnique').mockResolvedValue({ ...mockLicense } as any);
      jest.spyOn(prisma.node, 'create').mockResolvedValue(mockNode as any);

      const result = await service.registerNode(registerDto);

      // API key should be bb_ followed by 64 hex characters
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

      jest.spyOn(prisma.license, 'findUnique').mockResolvedValue({ ...mockLicense } as any);
      jest.spyOn(prisma.node, 'create').mockResolvedValue(mockNode as any);

      const result = await service.registerNode(registerDto);

      // Pairing token should be exactly 6 digits
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
      jest.spyOn(prisma.license, 'findUnique').mockResolvedValue({ ...mockLicense } as any);
      jest.spyOn(prisma.node, 'create').mockResolvedValue(mockNode as any);

      const result = await service.registerNode(registerDto);

      const expirationTime = result.pairingExpiresAt.getTime();
      const expectedExpiration = now + 10 * 60 * 1000;

      // Allow 1 second tolerance for test execution time
      expect(expirationTime).toBeGreaterThanOrEqual(expectedExpiration - 1000);
      expect(expirationTime).toBeLessThanOrEqual(expectedExpiration + 1000);
    });
  });
});
