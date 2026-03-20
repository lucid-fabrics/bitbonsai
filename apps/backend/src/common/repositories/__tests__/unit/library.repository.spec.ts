import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../prisma/prisma.service';
import { LibraryRepository } from '../../library.repository';

const mockLibrary = {
  id: 'lib-1',
  name: 'Movies',
  path: '/mnt/movies',
  nodeId: 'node-1',
  isActive: true,
  lastScanAt: null,
  totalSizeBytes: BigInt(0),
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockPrismaLibrary = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  count: jest.fn(),
  aggregate: jest.fn(),
  upsert: jest.fn(),
};

const mockPrisma = {
  library: mockPrismaLibrary,
};

describe('LibraryRepository', () => {
  let repository: LibraryRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [LibraryRepository, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    repository = module.get<LibraryRepository>(LibraryRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeInstanceOf(LibraryRepository);
  });

  describe('findById', () => {
    it('should return library when found', async () => {
      mockPrismaLibrary.findUnique.mockResolvedValue(mockLibrary);

      const result = await repository.findById('lib-1');

      expect(result).toEqual(mockLibrary);
      expect(mockPrismaLibrary.findUnique).toHaveBeenCalledWith({
        where: { id: 'lib-1' },
      });
    });

    it('should return null when not found', async () => {
      mockPrismaLibrary.findUnique.mockResolvedValue(null);

      const result = await repository.findById('ghost');

      expect(result).toBeNull();
    });
  });

  describe('findByNodeId', () => {
    it('should return libraries for a node', async () => {
      mockPrismaLibrary.findMany.mockResolvedValue([mockLibrary]);

      const result = await repository.findByNodeId('node-1');

      expect(result).toEqual([mockLibrary]);
      expect(mockPrismaLibrary.findMany).toHaveBeenCalledWith({
        where: { nodeId: 'node-1' },
      });
    });

    it('should return empty array when no libraries for node', async () => {
      mockPrismaLibrary.findMany.mockResolvedValue([]);

      const result = await repository.findByNodeId('node-99');

      expect(result).toEqual([]);
    });
  });

  describe('findActive', () => {
    it('should return active libraries', async () => {
      mockPrismaLibrary.findMany.mockResolvedValue([mockLibrary]);

      const result = await repository.findActive();

      expect(result).toEqual([mockLibrary]);
      expect(mockPrismaLibrary.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
      });
    });

    it('should return empty array when no active libraries', async () => {
      mockPrismaLibrary.findMany.mockResolvedValue([]);

      const result = await repository.findActive();

      expect(result).toEqual([]);
    });
  });

  describe('findByPath', () => {
    it('should return library matching path', async () => {
      mockPrismaLibrary.findFirst.mockResolvedValue(mockLibrary);

      const result = await repository.findByPath('/mnt/movies');

      expect(result).toEqual(mockLibrary);
      expect(mockPrismaLibrary.findFirst).toHaveBeenCalledWith({
        where: { path: '/mnt/movies' },
      });
    });

    it('should return null when path not found', async () => {
      mockPrismaLibrary.findFirst.mockResolvedValue(null);

      const result = await repository.findByPath('/mnt/unknown');

      expect(result).toBeNull();
    });
  });

  describe('countActive', () => {
    it('should return count of active libraries', async () => {
      mockPrismaLibrary.count.mockResolvedValue(3);

      const result = await repository.countActive();

      expect(result).toBe(3);
      expect(mockPrismaLibrary.count).toHaveBeenCalledWith({
        where: { isActive: true },
      });
    });

    it('should return 0 when no active libraries', async () => {
      mockPrismaLibrary.count.mockResolvedValue(0);

      const result = await repository.countActive();

      expect(result).toBe(0);
    });
  });

  describe('updateLastScan', () => {
    it('should update lastScanAt for a library', async () => {
      const updated = { ...mockLibrary, lastScanAt: new Date() };
      mockPrismaLibrary.update.mockResolvedValue(updated);

      const result = await repository.updateLastScan('lib-1');

      expect(result).toEqual(updated);
      expect(mockPrismaLibrary.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lib-1' },
          data: expect.objectContaining({ lastScanAt: expect.any(Date) }),
        })
      );
    });

    it('should propagate errors', async () => {
      mockPrismaLibrary.update.mockRejectedValue(new Error('Not found'));

      await expect(repository.updateLastScan('ghost')).rejects.toThrow('Not found');
    });
  });

  describe('getTotalSize', () => {
    it('should return total size bytes from aggregate', async () => {
      mockPrismaLibrary.aggregate.mockResolvedValue({
        _sum: { sizeBytes: BigInt(1024) },
      });

      const result = await repository.getTotalSize();

      expect(result).toBe(BigInt(1024));
      expect(mockPrismaLibrary.aggregate).toHaveBeenCalledWith({
        _sum: { sizeBytes: true },
        where: { isActive: true },
      });
    });

    it('should return BigInt(0) when aggregate sum is null', async () => {
      mockPrismaLibrary.aggregate.mockResolvedValue({ _sum: { sizeBytes: null } });

      const result = await repository.getTotalSize();

      expect(result).toBe(BigInt(0));
    });
  });

  describe('aggregateTotalSizeBytes', () => {
    it('should aggregate totalSizeBytes', async () => {
      const aggResult = { _sum: { totalSizeBytes: BigInt(2048) } };
      mockPrismaLibrary.aggregate.mockResolvedValue(aggResult);

      const result = await repository.aggregateTotalSizeBytes();

      expect(result).toEqual(aggResult);
      expect(mockPrismaLibrary.aggregate).toHaveBeenCalledWith({
        _sum: { totalSizeBytes: true },
      });
    });

    it('should return null sum when no data', async () => {
      mockPrismaLibrary.aggregate.mockResolvedValue({ _sum: { totalSizeBytes: null } });

      const result = await repository.aggregateTotalSizeBytes();

      expect(result._sum.totalSizeBytes).toBeNull();
    });
  });

  describe('findManyWithJobCountOrdered', () => {
    it('should return libraries with job counts ordered desc', async () => {
      const withCount = [{ ...mockLibrary, _count: { jobs: 5 } }];
      mockPrismaLibrary.findMany.mockResolvedValue(withCount);

      const result = await repository.findManyWithJobCountOrdered(10);

      expect(result).toEqual(withCount);
      expect(mockPrismaLibrary.findMany).toHaveBeenCalledWith({
        include: { _count: { select: { jobs: true } } },
        orderBy: { jobs: { _count: 'desc' } },
        take: 10,
      });
    });

    it('should return empty array when no libraries', async () => {
      mockPrismaLibrary.findMany.mockResolvedValue([]);

      const result = await repository.findManyWithJobCountOrdered(5);

      expect(result).toEqual([]);
    });
  });

  describe('findByWhere', () => {
    it('should call findUnique with provided where clause', async () => {
      mockPrismaLibrary.findUnique.mockResolvedValue(mockLibrary);

      const result = await repository.findByWhere({ id: 'lib-1' });

      expect(result).toEqual(mockLibrary);
      expect(mockPrismaLibrary.findUnique).toHaveBeenCalledWith({ where: { id: 'lib-1' } });
    });

    it('should return null when not found', async () => {
      mockPrismaLibrary.findUnique.mockResolvedValue(null);

      const result = await repository.findByWhere({ id: 'ghost' });

      expect(result).toBeNull();
    });
  });

  describe('findUniqueWithInclude', () => {
    it('should call findUnique with where and include', async () => {
      const withJobs = { ...mockLibrary, jobs: [] };
      mockPrismaLibrary.findUnique.mockResolvedValue(withJobs);

      const result = await repository.findUniqueWithInclude({ id: 'lib-1' }, { jobs: true });

      expect(result).toEqual(withJobs);
      expect(mockPrismaLibrary.findUnique).toHaveBeenCalledWith({
        where: { id: 'lib-1' },
        include: { jobs: true },
      });
    });

    it('should return null when not found', async () => {
      mockPrismaLibrary.findUnique.mockResolvedValue(null);

      const result = await repository.findUniqueWithInclude({ id: 'ghost' }, { jobs: true });

      expect(result).toBeNull();
    });
  });

  describe('findFirstWhere', () => {
    it('should call findFirst with where clause', async () => {
      mockPrismaLibrary.findFirst.mockResolvedValue(mockLibrary);

      const result = await repository.findFirstWhere({ id: 'lib-1' });

      expect(result).toEqual(mockLibrary);
      expect(mockPrismaLibrary.findFirst).toHaveBeenCalledWith({ where: { id: 'lib-1' } });
    });

    it('should return null when not found', async () => {
      mockPrismaLibrary.findFirst.mockResolvedValue(null);

      const result = await repository.findFirstWhere({ nodeId: 'node-99' });

      expect(result).toBeNull();
    });
  });

  describe('findAllLibraries', () => {
    it('should call findMany without args when none provided', async () => {
      mockPrismaLibrary.findMany.mockResolvedValue([mockLibrary]);

      const result = await repository.findAllLibraries();

      expect(result).toEqual([mockLibrary]);
      expect(mockPrismaLibrary.findMany).toHaveBeenCalledWith({});
    });

    it('should call findMany with where when provided', async () => {
      mockPrismaLibrary.findMany.mockResolvedValue([mockLibrary]);

      await repository.findAllLibraries({ nodeId: 'node-1' });

      expect(mockPrismaLibrary.findMany).toHaveBeenCalledWith({ where: { nodeId: 'node-1' } });
    });

    it('should call findMany with include when provided', async () => {
      mockPrismaLibrary.findMany.mockResolvedValue([mockLibrary]);

      await repository.findAllLibraries(undefined, { jobs: true });

      expect(mockPrismaLibrary.findMany).toHaveBeenCalledWith({ include: { jobs: true } });
    });

    it('should call findMany with both where and include', async () => {
      mockPrismaLibrary.findMany.mockResolvedValue([mockLibrary]);

      await repository.findAllLibraries({ nodeId: 'node-1' }, { jobs: true });

      expect(mockPrismaLibrary.findMany).toHaveBeenCalledWith({
        where: { nodeId: 'node-1' },
        include: { jobs: true },
      });
    });
  });

  describe('createLibrary', () => {
    it('should create a library with provided data', async () => {
      mockPrismaLibrary.create.mockResolvedValue(mockLibrary);

      const createData = { name: 'Movies', path: '/mnt/movies', nodeId: 'node-1' } as Parameters<
        typeof repository.createLibrary
      >[0];
      const result = await repository.createLibrary(createData);

      expect(result).toEqual(mockLibrary);
      expect(mockPrismaLibrary.create).toHaveBeenCalledWith({
        data: createData,
      });
    });

    it('should propagate errors', async () => {
      mockPrismaLibrary.create.mockRejectedValue(new Error('Unique constraint failed'));

      const createData = { name: 'Dup', path: '/mnt/movies', nodeId: 'node-1' } as Parameters<
        typeof repository.createLibrary
      >[0];
      await expect(repository.createLibrary(createData)).rejects.toThrow(
        'Unique constraint failed'
      );
    });
  });

  describe('updateLibrary', () => {
    it('should update a library', async () => {
      const updated = { ...mockLibrary, name: 'TV Shows' };
      mockPrismaLibrary.update.mockResolvedValue(updated);

      const result = await repository.updateLibrary({ id: 'lib-1' }, { name: 'TV Shows' });

      expect(result).toEqual(updated);
      expect(mockPrismaLibrary.update).toHaveBeenCalledWith({
        where: { id: 'lib-1' },
        data: { name: 'TV Shows' },
      });
    });
  });

  describe('updateWithInclude', () => {
    it('should update and return with included relations', async () => {
      const withJobs = { ...mockLibrary, jobs: [] };
      mockPrismaLibrary.update.mockResolvedValue(withJobs);

      const result = await repository.updateWithInclude(
        { id: 'lib-1' },
        { name: 'Updated' },
        { jobs: true }
      );

      expect(result).toEqual(withJobs);
      expect(mockPrismaLibrary.update).toHaveBeenCalledWith({
        where: { id: 'lib-1' },
        data: { name: 'Updated' },
        include: { jobs: true },
      });
    });
  });

  describe('deleteLibrary', () => {
    it('should delete library by where clause', async () => {
      mockPrismaLibrary.delete.mockResolvedValue(mockLibrary);

      const result = await repository.deleteLibrary({ id: 'lib-1' });

      expect(result).toEqual(mockLibrary);
      expect(mockPrismaLibrary.delete).toHaveBeenCalledWith({ where: { id: 'lib-1' } });
    });

    it('should propagate errors when not found', async () => {
      mockPrismaLibrary.delete.mockRejectedValue(new Error('Record not found'));

      await expect(repository.deleteLibrary({ id: 'ghost' })).rejects.toThrow('Record not found');
    });
  });

  describe('upsertLibrary', () => {
    it('should call prisma upsert with where, create, and update', async () => {
      mockPrismaLibrary.upsert.mockResolvedValue(mockLibrary);

      const createData = { name: 'Movies', path: '/mnt/movies', nodeId: 'node-1' } as Parameters<
        typeof repository.upsertLibrary
      >[1];
      const result = await repository.upsertLibrary({ id: 'lib-1' }, createData, {
        name: 'Movies Updated',
      });

      expect(result).toEqual(mockLibrary);
      expect(mockPrismaLibrary.upsert).toHaveBeenCalledWith({
        where: { id: 'lib-1' },
        create: createData,
        update: { name: 'Movies Updated' },
      });
    });
  });
});
