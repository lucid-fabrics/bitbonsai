import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../prisma/prisma.service';
import { NodeRepository } from '../../node.repository';

const mockNode = {
  id: 'node-1',
  name: 'Main Node',
  ipAddress: '192.168.1.100',
  role: 'MAIN' as const,
  status: 'ONLINE' as const,
  apiKey: 'api-key-123',
  maxWorkers: 4,
  cpuCores: 8,
  loadThresholdMultiplier: 1.5,
  estimatedFreeAt: null,
  lastHeartbeatLoad: 0.5,
  currentSystemLoad: 0.6,
  currentMemoryFreeGB: 16,
  avgEncodingSpeed: 2.5,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockPrismaNode = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  count: jest.fn(),
  aggregate: jest.fn(),
  groupBy: jest.fn(),
};

const mockPrisma = {
  node: mockPrismaNode,
};

describe('NodeRepository', () => {
  let repository: NodeRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [NodeRepository, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    repository = module.get<NodeRepository>(NodeRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeInstanceOf(NodeRepository);
  });

  describe('findById', () => {
    it('should return node when found', async () => {
      mockPrismaNode.findUnique.mockResolvedValue(mockNode);

      const result = await repository.findById('node-1');

      expect(result).toEqual(mockNode);
      expect(mockPrismaNode.findUnique).toHaveBeenCalledWith({ where: { id: 'node-1' } });
    });

    it('should return null when not found', async () => {
      mockPrismaNode.findUnique.mockResolvedValue(null);

      const result = await repository.findById('ghost');

      expect(result).toBeNull();
    });
  });

  describe('findOnline', () => {
    it('should return online nodes', async () => {
      mockPrismaNode.findMany.mockResolvedValue([mockNode]);

      const result = await repository.findOnline();

      expect(result).toEqual([mockNode]);
      expect(mockPrismaNode.findMany).toHaveBeenCalledWith({ where: { status: 'ONLINE' } });
    });

    it('should return empty array when no online nodes', async () => {
      mockPrismaNode.findMany.mockResolvedValue([]);

      const result = await repository.findOnline();

      expect(result).toEqual([]);
    });
  });

  describe('findByRole', () => {
    it('should return nodes with matching role', async () => {
      mockPrismaNode.findMany.mockResolvedValue([mockNode]);

      const result = await repository.findByRole('MAIN');

      expect(result).toEqual([mockNode]);
      expect(mockPrismaNode.findMany).toHaveBeenCalledWith({ where: { role: 'MAIN' } });
    });

    it('should return empty array when no nodes match role', async () => {
      mockPrismaNode.findMany.mockResolvedValue([]);

      const result = await repository.findByRole('LINKED');

      expect(result).toEqual([]);
    });
  });

  describe('findMain', () => {
    it('should return main node', async () => {
      mockPrismaNode.findFirst.mockResolvedValue(mockNode);

      const result = await repository.findMain();

      expect(result).toEqual(mockNode);
      expect(mockPrismaNode.findFirst).toHaveBeenCalledWith({ where: { role: 'MAIN' } });
    });

    it('should return null when no main node', async () => {
      mockPrismaNode.findFirst.mockResolvedValue(null);

      const result = await repository.findMain();

      expect(result).toBeNull();
    });
  });

  describe('findLinked', () => {
    it('should return linked nodes', async () => {
      const linkedNode = { ...mockNode, id: 'node-2', role: 'LINKED' as const };
      mockPrismaNode.findMany.mockResolvedValue([linkedNode]);

      const result = await repository.findLinked();

      expect(result).toEqual([linkedNode]);
      expect(mockPrismaNode.findMany).toHaveBeenCalledWith({ where: { role: 'LINKED' } });
    });

    it('should return empty array when no linked nodes', async () => {
      mockPrismaNode.findMany.mockResolvedValue([]);

      const result = await repository.findLinked();

      expect(result).toEqual([]);
    });
  });

  describe('updateStatus', () => {
    it('should update node status', async () => {
      const updated = { ...mockNode, status: 'OFFLINE' as const };
      mockPrismaNode.update.mockResolvedValue(updated);

      const result = await repository.updateStatus('node-1', 'OFFLINE');

      expect(result).toEqual(updated);
      expect(mockPrismaNode.update).toHaveBeenCalledWith({
        where: { id: 'node-1' },
        data: { status: 'OFFLINE' },
      });
    });

    it('should propagate errors', async () => {
      mockPrismaNode.update.mockRejectedValue(new Error('Record not found'));

      await expect(repository.updateStatus('ghost', 'OFFLINE')).rejects.toThrow('Record not found');
    });
  });

  describe('countOnline', () => {
    it('should return count of online nodes', async () => {
      mockPrismaNode.count.mockResolvedValue(3);

      const result = await repository.countOnline();

      expect(result).toBe(3);
      expect(mockPrismaNode.count).toHaveBeenCalledWith({ where: { status: 'ONLINE' } });
    });

    it('should return 0 when no online nodes', async () => {
      mockPrismaNode.count.mockResolvedValue(0);

      const result = await repository.countOnline();

      expect(result).toBe(0);
    });
  });

  describe('getNodeLoad', () => {
    it('should return node load data with job counts', async () => {
      const nodesWithCount = [{ ...mockNode, _count: { jobs: 2 } }];
      mockPrismaNode.findMany.mockResolvedValue(nodesWithCount);

      const result = await repository.getNodeLoad();

      expect(result).toEqual([{ nodeId: 'node-1', jobCount: 2 }]);
    });

    it('should return empty array when no online nodes', async () => {
      mockPrismaNode.findMany.mockResolvedValue([]);

      const result = await repository.getNodeLoad();

      expect(result).toEqual([]);
    });
  });

  describe('findByApiKey', () => {
    it('should return node for a given api key', async () => {
      mockPrismaNode.findUnique.mockResolvedValue(mockNode);

      const result = await repository.findByApiKey('api-key-123');

      expect(result).toEqual(mockNode);
      expect(mockPrismaNode.findUnique).toHaveBeenCalledWith({ where: { apiKey: 'api-key-123' } });
    });

    it('should return null for unknown api key', async () => {
      mockPrismaNode.findUnique.mockResolvedValue(null);

      const result = await repository.findByApiKey('unknown');

      expect(result).toBeNull();
    });
  });

  describe('createNode', () => {
    it('should create a node with provided data', async () => {
      mockPrismaNode.create.mockResolvedValue(mockNode);

      const result = await repository.createNode({ name: 'Main Node', ipAddress: '192.168.1.100' });

      expect(result).toEqual(mockNode);
      expect(mockPrismaNode.create).toHaveBeenCalledWith({
        data: { name: 'Main Node', ipAddress: '192.168.1.100' },
      });
    });

    it('should propagate errors on duplicate', async () => {
      mockPrismaNode.create.mockRejectedValue(new Error('Unique constraint failed'));

      await expect(repository.createNode({ name: 'Dup' })).rejects.toThrow(
        'Unique constraint failed'
      );
    });
  });

  describe('deleteById', () => {
    it('should delete node by id', async () => {
      mockPrismaNode.delete.mockResolvedValue(mockNode);

      const result = await repository.deleteById('node-1');

      expect(result).toEqual(mockNode);
      expect(mockPrismaNode.delete).toHaveBeenCalledWith({ where: { id: 'node-1' } });
    });

    it('should propagate errors when not found', async () => {
      mockPrismaNode.delete.mockRejectedValue(new Error('Record not found'));

      await expect(repository.deleteById('ghost')).rejects.toThrow('Record not found');
    });
  });

  describe('findFirstByRole', () => {
    it('should return first node with given role', async () => {
      mockPrismaNode.findFirst.mockResolvedValue(mockNode);

      const result = await repository.findFirstByRole('MAIN');

      expect(result).toEqual(mockNode);
      expect(mockPrismaNode.findFirst).toHaveBeenCalledWith({ where: { role: 'MAIN' } });
    });

    it('should pass orderBy when provided', async () => {
      mockPrismaNode.findFirst.mockResolvedValue(mockNode);

      await repository.findFirstByRole('LINKED', { orderBy: { createdAt: 'asc' } });

      expect(mockPrismaNode.findFirst).toHaveBeenCalledWith({
        where: { role: 'LINKED' },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should return null when no node with role', async () => {
      mockPrismaNode.findFirst.mockResolvedValue(null);

      const result = await repository.findFirstByRole('LINKED');

      expect(result).toBeNull();
    });
  });

  describe('findManyByIp', () => {
    it('should return nodes matching ip address', async () => {
      mockPrismaNode.findMany.mockResolvedValue([mockNode]);

      const result = await repository.findManyByIp('192.168.1.100');

      expect(result).toEqual([mockNode]);
      expect(mockPrismaNode.findMany).toHaveBeenCalledWith({
        where: { ipAddress: '192.168.1.100' },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should return empty array when no nodes match ip', async () => {
      mockPrismaNode.findMany.mockResolvedValue([]);

      const result = await repository.findManyByIp('10.0.0.1');

      expect(result).toEqual([]);
    });
  });

  describe('aggregateMaxEncodingSpeed', () => {
    it('should return max encoding speed', async () => {
      mockPrismaNode.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: 5.0 } });

      const result = await repository.aggregateMaxEncodingSpeed();

      expect(result).toBe(5.0);
    });

    it('should return 0 when no nodes have encoding speed', async () => {
      mockPrismaNode.aggregate.mockResolvedValue({ _max: { avgEncodingSpeed: null } });

      const result = await repository.aggregateMaxEncodingSpeed();

      expect(result).toBe(0);
    });
  });

  describe('findOnlineWithActiveJobCount', () => {
    it('should return online nodes with active job counts', async () => {
      const withCount = [{ ...mockNode, _count: { jobs: 3 } }];
      mockPrismaNode.findMany.mockResolvedValue(withCount);

      const result = await repository.findOnlineWithActiveJobCount();

      expect(result).toEqual(withCount);
      expect(mockPrismaNode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ONLINE' },
          include: expect.objectContaining({ _count: expect.anything() }),
        })
      );
    });
  });

  describe('findOnlineIds', () => {
    it('should return only id fields for online nodes', async () => {
      mockPrismaNode.findMany.mockResolvedValue([{ id: 'node-1' }, { id: 'node-2' }]);

      const result = await repository.findOnlineIds();

      expect(result).toEqual([{ id: 'node-1' }, { id: 'node-2' }]);
      expect(mockPrismaNode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ONLINE' },
          select: { id: true },
        })
      );
    });
  });

  describe('groupByStatusCount', () => {
    it('should return status counts', async () => {
      const grouped = [
        { status: 'ONLINE', _count: { status: 2 } },
        { status: 'OFFLINE', _count: { status: 1 } },
      ];
      mockPrismaNode.groupBy.mockResolvedValue(grouped);

      const result = await repository.groupByStatusCount();

      expect(result).toEqual(grouped);
      expect(mockPrismaNode.groupBy).toHaveBeenCalled();
    });
  });

  describe('findManyWithJobCountOrdered', () => {
    it('should return nodes with job counts ordered by role and name', async () => {
      const withCount = [{ ...mockNode, _count: { jobs: 5 } }];
      mockPrismaNode.findMany.mockResolvedValue(withCount);

      const result = await repository.findManyWithJobCountOrdered();

      expect(result).toEqual(withCount);
      expect(mockPrismaNode.findMany).toHaveBeenCalledWith({
        include: { _count: { select: { jobs: true } } },
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
      });
    });
  });

  describe('findFirstByIpAddresses', () => {
    it('should return first node matching any of the ip addresses', async () => {
      mockPrismaNode.findFirst.mockResolvedValue(mockNode);

      const result = await repository.findFirstByIpAddresses(['192.168.1.100', '192.168.1.101']);

      expect(result).toEqual(mockNode);
      expect(mockPrismaNode.findFirst).toHaveBeenCalledWith({
        where: { ipAddress: { in: ['192.168.1.100', '192.168.1.101'] } },
      });
    });

    it('should return null when no node matches any ip', async () => {
      mockPrismaNode.findFirst.mockResolvedValue(null);

      const result = await repository.findFirstByIpAddresses(['10.0.0.1']);

      expect(result).toBeNull();
    });
  });
});
