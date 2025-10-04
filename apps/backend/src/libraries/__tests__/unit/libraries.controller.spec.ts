import { Test, type TestingModule } from '@nestjs/testing';
import { MediaType } from '@prisma/client';
import { LibrariesController } from './libraries.controller';
import { LibrariesService } from './libraries.service';

describe('LibrariesController', () => {
  let controller: LibrariesController;
  let service: LibrariesService;

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

  const mockLibraryStats = {
    ...mockLibrary,
    node: {
      id: 'node-1',
      name: 'Main Server',
      status: 'ONLINE',
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
      controllers: [LibrariesController],
      providers: [
        {
          provide: LibrariesService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            scan: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<LibrariesController>(LibrariesController);
    service = module.get<LibrariesService>(LibrariesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a library', async () => {
      const createDto = {
        name: 'Movie Collection',
        path: '/mnt/user/media/Movies',
        mediaType: MediaType.MOVIE,
        nodeId: 'node-1',
      };

      jest.spyOn(service, 'create').mockResolvedValue(mockLibrary as never);

      const result = await controller.create(createDto);

      expect(result).toEqual(mockLibrary);
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('findAll', () => {
    it('should return all libraries', async () => {
      const mockLibraries = [mockLibrary];
      jest.spyOn(service, 'findAll').mockResolvedValue(mockLibraries as never);

      const result = await controller.findAll();

      expect(result).toEqual(mockLibraries);
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a library with statistics', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(mockLibraryStats as never);

      const result = await controller.findOne('lib-1');

      expect(result).toEqual(mockLibraryStats);
      expect(service.findOne).toHaveBeenCalledWith('lib-1');
    });
  });

  describe('update', () => {
    it('should update a library', async () => {
      const updateDto = {
        name: 'Updated Movie Collection',
        enabled: false,
      };
      const updatedLibrary = { ...mockLibrary, ...updateDto };

      jest.spyOn(service, 'update').mockResolvedValue(updatedLibrary as never);

      const result = await controller.update('lib-1', updateDto);

      expect(result).toEqual(updatedLibrary);
      expect(service.update).toHaveBeenCalledWith('lib-1', updateDto);
    });
  });

  describe('remove', () => {
    it('should delete a library', async () => {
      jest.spyOn(service, 'remove').mockResolvedValue(undefined);

      await controller.remove('lib-1');

      expect(service.remove).toHaveBeenCalledWith('lib-1');
    });
  });

  describe('scan', () => {
    it('should trigger a library scan', async () => {
      const scannedLibrary = {
        ...mockLibrary,
        lastScanAt: new Date(),
      };

      jest.spyOn(service, 'scan').mockResolvedValue(scannedLibrary as never);

      const result = await controller.scan('lib-1');

      expect(result).toEqual(scannedLibrary);
      expect(service.scan).toHaveBeenCalledWith('lib-1');
    });
  });
});
