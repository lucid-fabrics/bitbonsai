import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { MediaType, NodeRole, NodeStatus } from '@prisma/client';
import { FileWatcherService } from '../../../file-watcher/file-watcher.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { LibrariesService } from '../../libraries.service';

describe('LibrariesService', () => {
  let service: LibrariesService;
  let prisma: PrismaService;

  const mockNode = {
    id: 'node-1',
    name: 'Main Server',
    status: NodeStatus.ONLINE,
    role: NodeRole.MAIN,
  };

  const mockLibrary = {
    id: 'lib-1',
    name: 'Movie Collection',
    path: '/mnt/user/media/Movies',
    mediaType: MediaType.MOVIE,
    enabled: true,
    lastScanAt: null,
    totalFiles: 0,
    totalSizeBytes: BigInt(0),
    nodeId: 'node-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockLibraryWithStats = {
    ...mockLibrary,
    node: {
      id: mockNode.id,
      name: mockNode.name,
      status: mockNode.status,
    },
    policies: [
      {
        id: 'policy-1',
        name: 'Balanced HEVC',
        preset: 'BALANCED_HEVC',
      },
    ],
    _count: {
      jobs: 42,
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LibrariesService,
        {
          provide: PrismaService,
          useValue: {
            node: {
              findUnique: jest.fn(),
            },
            library: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: FileWatcherService,
          useValue: {
            watchLibrary: jest.fn(),
            unwatchLibrary: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<LibrariesService>(LibrariesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createDto = {
      name: 'Movie Collection',
      path: '/mnt/user/media/Movies',
      mediaType: MediaType.MOVIE,
      nodeId: 'node-1',
    };

    it('should create a library successfully', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.library, 'create').mockResolvedValue(mockLibrary as never);

      const result = await service.create(createDto);

      expect(result).toEqual(mockLibrary);
      expect(prisma.node.findUnique).toHaveBeenCalledWith({
        where: { id: 'node-1' },
      });
      expect(prisma.library.create).toHaveBeenCalledWith({
        data: createDto,
      });
    });

    it('should throw NotFoundException if node does not exist', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(NotFoundException);
      await expect(service.create(createDto)).rejects.toThrow('Node with ID "node-1" not found');
    });

    it('should throw ConflictException if library path already exists on node', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibrary as never);

      await expect(service.create(createDto)).rejects.toThrow(ConflictException);
      await expect(service.create(createDto)).rejects.toThrow(
        'Library with path "/mnt/user/media/Movies" already exists on node "Main Server"'
      );
    });
  });

  describe('findAll', () => {
    it('should return all libraries', async () => {
      const mockLibraries = [mockLibraryWithStats];
      jest.spyOn(prisma.library, 'findMany').mockResolvedValue(mockLibraries as never);

      const result = await service.findAll();

      expect(result).toEqual(mockLibraries);
      expect(prisma.library.findMany).toHaveBeenCalledWith({
        include: {
          node: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
          _count: {
            select: {
              jobs: true,
              policies: true,
            },
          },
        },
      });
    });
  });

  describe('findOne', () => {
    it('should return a library with statistics', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibraryWithStats as never);

      const result = await service.findOne('lib-1');

      expect(result).toEqual(mockLibraryWithStats);
      expect(prisma.library.findUnique).toHaveBeenCalledWith({
        where: { id: 'lib-1' },
        include: {
          node: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
          policies: {
            select: {
              id: true,
              name: true,
              preset: true,
            },
          },
          _count: {
            select: {
              jobs: true,
            },
          },
        },
      });
    });

    it('should throw NotFoundException if library does not exist', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('non-existent')).rejects.toThrow(
        'Library with ID "non-existent" not found'
      );
    });
  });

  describe('update', () => {
    const updateDto = {
      name: 'Updated Movie Collection',
      enabled: false,
    };

    it('should update a library successfully', async () => {
      const updatedLibrary = { ...mockLibrary, ...updateDto };
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibrary as never);
      jest.spyOn(prisma.library, 'update').mockResolvedValue(updatedLibrary as never);

      const result = await service.update('lib-1', updateDto);

      expect(result).toEqual(updatedLibrary);
      expect(prisma.library.update).toHaveBeenCalledWith({
        where: { id: 'lib-1' },
        data: updateDto,
      });
    });

    it('should throw NotFoundException if library does not exist', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);

      await expect(service.update('non-existent', updateDto)).rejects.toThrow(NotFoundException);
      await expect(service.update('non-existent', updateDto)).rejects.toThrow(
        'Library with ID "non-existent" not found'
      );
    });
  });

  describe('remove', () => {
    it('should delete a library successfully', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibrary as never);
      jest.spyOn(prisma.library, 'delete').mockResolvedValue(mockLibrary as never);

      await service.remove('lib-1');

      expect(prisma.library.delete).toHaveBeenCalledWith({
        where: { id: 'lib-1' },
      });
    });

    it('should throw NotFoundException if library does not exist', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);

      await expect(service.remove('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.remove('non-existent')).rejects.toThrow(
        'Library with ID "non-existent" not found'
      );
    });
  });

  describe('scan', () => {
    it('should update lastScanAt timestamp', async () => {
      const scannedLibrary = {
        ...mockLibrary,
        lastScanAt: new Date(),
      };
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibrary as never);
      jest.spyOn(prisma.library, 'update').mockResolvedValue(scannedLibrary as never);

      const result = await service.scan('lib-1');

      expect(result.lastScanAt).toBeTruthy();
      expect(prisma.library.update).toHaveBeenCalledWith({
        where: { id: 'lib-1' },
        data: {
          lastScanAt: expect.any(Date),
        },
      });
    });

    it('should throw NotFoundException if library does not exist', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);

      await expect(service.scan('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.scan('non-existent')).rejects.toThrow(
        'Library with ID "non-existent" not found'
      );
    });
  });
});
