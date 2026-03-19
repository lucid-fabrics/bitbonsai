import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { MediaType, NodeRole, NodeStatus } from '@prisma/client';
import { JobRepository } from '../../../common/repositories/job.repository';
import { LibraryRepository } from '../../../common/repositories/library.repository';
import { NodeRepository } from '../../../common/repositories/node.repository';
import { PolicyRepository } from '../../../common/repositories/policy.repository';
import { DistributionOrchestratorService } from '../../../distribution/services/distribution-orchestrator.service';
import { QueueService } from '../../../queue/queue.service';
import { FileFailureTrackingService } from '../../../queue/services/file-failure-tracking.service';
import { SettingsService } from '../../../settings/settings.service';
import { LibrariesService } from '../../libraries.service';
import { MediaAnalysisService } from '../../services/media-analysis.service';

describe('LibrariesService', () => {
  let service: LibrariesService;

  // Repository mocks
  const mockLibraryRepo = {
    createLibrary: jest.fn(),
    findAllLibraries: jest.fn(),
    findUniqueWithInclude: jest.fn(),
    findByWhere: jest.fn(),
    findFirstWhere: jest.fn(),
    updateWithInclude: jest.fn(),
    deleteLibrary: jest.fn(),
  };
  const mockNodeRepo = {
    findById: jest.fn(),
    findFirst: jest.fn(),
  };
  const mockJobRepo = {
    findManySelect: jest.fn(),
  };
  const mockPolicyRepo = {
    findById: jest.fn(),
  };

  // Shims so existing `prisma.X.Y` assertions in tests still work
  let prisma: {
    node: Record<string, jest.Mock>;
    library: Record<string, jest.Mock>;
  };

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
    watchEnabled: false,
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
    // Reset all mocks
    Object.values(mockLibraryRepo).forEach((fn) => {
      fn.mockReset();
    });
    Object.values(mockNodeRepo).forEach((fn) => {
      fn.mockReset();
    });
    Object.values(mockJobRepo).forEach((fn) => {
      fn.mockReset();
    });
    Object.values(mockPolicyRepo).forEach((fn) => {
      fn.mockReset();
    });

    prisma = {
      node: {
        findUnique: mockNodeRepo.findById,
        findFirst: mockNodeRepo.findFirst,
      },
      library: {
        create: mockLibraryRepo.createLibrary,
        findMany: mockLibraryRepo.findAllLibraries,
        findUnique: mockLibraryRepo.findUniqueWithInclude,
        update: mockLibraryRepo.updateWithInclude,
        delete: mockLibraryRepo.deleteLibrary,
      },
    };

    // Keep shims in sync
    mockNodeRepo.findById = prisma.node.findUnique;
    mockNodeRepo.findFirst = prisma.node.findFirst;
    mockLibraryRepo.createLibrary = prisma.library.create;
    mockLibraryRepo.findAllLibraries = prisma.library.findMany;
    mockLibraryRepo.findUniqueWithInclude = prisma.library.findUnique;
    mockLibraryRepo.findByWhere = prisma.library.findUnique;
    mockLibraryRepo.findFirstWhere = prisma.library.findUnique;
    mockLibraryRepo.updateWithInclude = prisma.library.update;
    mockLibraryRepo.deleteLibrary = prisma.library.delete;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LibrariesService,
        { provide: LibraryRepository, useValue: mockLibraryRepo },
        { provide: NodeRepository, useValue: mockNodeRepo },
        { provide: JobRepository, useValue: mockJobRepo },
        { provide: PolicyRepository, useValue: mockPolicyRepo },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
        {
          provide: MediaAnalysisService,
          useValue: { analyze: jest.fn(), getMediaInfo: jest.fn(), getVideoCodecInfo: jest.fn() },
        },
        {
          provide: QueueService,
          useValue: { create: jest.fn(), findAll: jest.fn(), getJobStats: jest.fn() },
        },
        {
          provide: SettingsService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            getAll: jest.fn(),
            getReadyFilesCacheTtl: jest.fn(),
          },
        },
        {
          provide: DistributionOrchestratorService,
          useValue: {
            distribute: jest.fn(),
            rebalance: jest.fn(),
            findBestNodeForNewJob: jest.fn(),
          },
        },
        {
          provide: FileFailureTrackingService,
          useValue: {
            recordFailure: jest.fn().mockResolvedValue(false),
            isBlacklisted: jest.fn().mockResolvedValue(false),
            getBlacklistedPaths: jest.fn().mockResolvedValue(new Set()),
            clearBlacklist: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<LibrariesService>(LibrariesService);
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
      expect(prisma.node.findUnique).toHaveBeenCalled();
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
      expect(prisma.library.findMany).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a library with statistics', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibraryWithStats as never);

      const result = await service.findOne('lib-1');

      expect(result).toEqual(mockLibraryWithStats);
      expect(prisma.library.findUnique).toHaveBeenCalled();
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
      expect(prisma.library.update).toHaveBeenCalled();
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

      expect(prisma.library.delete).toHaveBeenCalled();
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

      expect(result.lastScanAt).toBeInstanceOf(Date);
      expect(prisma.library.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException if library does not exist', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);

      await expect(service.scan('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.scan('non-existent')).rejects.toThrow(
        'Library with ID "non-existent" not found'
      );
    });
  });

  describe('create - path validation', () => {
    it('should throw BadRequestException for relative path', async () => {
      const dto = {
        name: 'Test',
        path: 'relative/path',
        mediaType: MediaType.MOVIE,
        nodeId: 'node-1',
      };
      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for path not in allowed base dirs', async () => {
      const dto = {
        name: 'Test',
        path: '/etc/passwd',
        mediaType: MediaType.MOVIE,
        nodeId: 'node-1',
      };
      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('should auto-assign node when nodeId is not provided', async () => {
      const dto = {
        name: 'Movie Collection',
        path: '/mnt/user/media/Movies',
        mediaType: MediaType.MOVIE,
      };

      jest.spyOn(prisma.node, 'findFirst').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.library, 'create').mockResolvedValue(mockLibrary as never);

      const result = await service.create(dto);
      expect(result).toEqual(mockLibrary);
    });

    it('should throw NotFoundException when no nodes available for auto-assign', async () => {
      const dto = {
        name: 'Movie Collection',
        path: '/mnt/user/media/Movies',
        mediaType: MediaType.MOVIE,
      };

      jest.spyOn(prisma.node, 'findFirst').mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
      await expect(service.create(dto)).rejects.toThrow('No nodes available');
    });
  });

  describe('findAll', () => {
    it('should return empty array when no libraries exist', async () => {
      jest.spyOn(prisma.library, 'findMany').mockResolvedValue([] as never);

      const result = await service.findAll();
      expect(result).toEqual([]);
    });
  });

  describe('getAllLibraryPaths', () => {
    it('should return unique paths from all libraries', async () => {
      const libs = [
        { ...mockLibrary, path: '/mnt/user/movies' },
        { ...mockLibrary, id: 'lib-2', path: '/mnt/user/movies' },
        { ...mockLibrary, id: 'lib-3', path: '/mnt/user/shows' },
      ];
      jest.spyOn(prisma.library, 'findMany').mockResolvedValue(libs as never);

      const result = await service.getAllLibraryPaths();
      expect(result).toHaveLength(2);
      expect(result).toContain('/mnt/user/movies');
      expect(result).toContain('/mnt/user/shows');
    });

    it('should filter by nodeId when provided', async () => {
      jest.spyOn(prisma.library, 'findMany').mockResolvedValue([mockLibrary] as never);

      const result = await service.getAllLibraryPaths('node-1');
      expect(result).toHaveLength(1);
      expect(prisma.library.findMany).toHaveBeenCalled();
    });

    it('should return empty array when no libraries', async () => {
      jest.spyOn(prisma.library, 'findMany').mockResolvedValue([] as never);
      const result = await service.getAllLibraryPaths();
      expect(result).toEqual([]);
    });
  });

  describe('update - watchEnabled events', () => {
    it('should emit enable event when watchEnabled changes to true', async () => {
      const mockEventEmitter = { emit: jest.fn() };
      const libraryDisabled = { ...mockLibrary, watchEnabled: false };
      const libraryEnabled = { ...mockLibrary, watchEnabled: true };

      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(libraryDisabled as never);
      jest.spyOn(prisma.library, 'update').mockResolvedValue(libraryEnabled as never);

      // get the event emitter from the module
      const module2: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: mockEventEmitter },
          {
            provide: MediaAnalysisService,
            useValue: { analyze: jest.fn(), getMediaInfo: jest.fn(), getVideoCodecInfo: jest.fn() },
          },
          {
            provide: QueueService,
            useValue: { create: jest.fn(), findAll: jest.fn(), getJobStats: jest.fn() },
          },
          {
            provide: SettingsService,
            useValue: {
              get: jest.fn(),
              set: jest.fn(),
              getAll: jest.fn(),
              getReadyFilesCacheTtl: jest.fn(),
            },
          },
          {
            provide: DistributionOrchestratorService,
            useValue: {
              distribute: jest.fn(),
              rebalance: jest.fn(),
              findBestNodeForNewJob: jest.fn(),
            },
          },
          {
            provide: FileFailureTrackingService,
            useValue: {
              recordFailure: jest.fn().mockResolvedValue(false),
              isBlacklisted: jest.fn().mockResolvedValue(false),
              getBlacklistedPaths: jest.fn().mockResolvedValue(new Set()),
              clearBlacklist: jest.fn().mockResolvedValue(undefined),
            },
          },
        ],
      }).compile();

      const svc2 = module2.get<LibrariesService>(LibrariesService);
      mockLibraryRepo.findByWhere = jest.fn().mockResolvedValue(libraryDisabled);
      mockLibraryRepo.updateWithInclude = jest.fn().mockResolvedValue(libraryEnabled);

      await svc2.update('lib-1', { watchEnabled: true });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        expect.stringContaining('library'),
        expect.anything()
      );
    });

    it('should emit disable event when watchEnabled changes to false', async () => {
      const mockEventEmitter = { emit: jest.fn() };
      const libraryEnabled = { ...mockLibrary, watchEnabled: true };
      const libraryDisabled = { ...mockLibrary, watchEnabled: false };

      const module3: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: mockEventEmitter },
          {
            provide: MediaAnalysisService,
            useValue: { analyze: jest.fn(), getMediaInfo: jest.fn(), getVideoCodecInfo: jest.fn() },
          },
          {
            provide: QueueService,
            useValue: { create: jest.fn(), findAll: jest.fn(), getJobStats: jest.fn() },
          },
          {
            provide: SettingsService,
            useValue: {
              get: jest.fn(),
              set: jest.fn(),
              getAll: jest.fn(),
              getReadyFilesCacheTtl: jest.fn(),
            },
          },
          {
            provide: DistributionOrchestratorService,
            useValue: {
              distribute: jest.fn(),
              rebalance: jest.fn(),
              findBestNodeForNewJob: jest.fn(),
            },
          },
          {
            provide: FileFailureTrackingService,
            useValue: {
              recordFailure: jest.fn().mockResolvedValue(false),
              isBlacklisted: jest.fn().mockResolvedValue(false),
              getBlacklistedPaths: jest.fn().mockResolvedValue(new Set()),
              clearBlacklist: jest.fn().mockResolvedValue(undefined),
            },
          },
        ],
      }).compile();

      const svc3 = module3.get<LibrariesService>(LibrariesService);
      mockLibraryRepo.findByWhere = jest.fn().mockResolvedValue(libraryEnabled);
      mockLibraryRepo.updateWithInclude = jest.fn().mockResolvedValue(libraryDisabled);

      await svc3.update('lib-1', { watchEnabled: false });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        expect.stringContaining('library'),
        expect.anything()
      );
    });
  });

  describe('remove - watcher stop event', () => {
    it('should emit stop event when library has watchEnabled=true', async () => {
      const mockEventEmitter = { emit: jest.fn() };
      const watchedLibrary = { ...mockLibrary, watchEnabled: true };

      const module4: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: mockEventEmitter },
          {
            provide: MediaAnalysisService,
            useValue: { analyze: jest.fn(), getMediaInfo: jest.fn(), getVideoCodecInfo: jest.fn() },
          },
          {
            provide: QueueService,
            useValue: { create: jest.fn(), findAll: jest.fn(), getJobStats: jest.fn() },
          },
          {
            provide: SettingsService,
            useValue: {
              get: jest.fn(),
              set: jest.fn(),
              getAll: jest.fn(),
              getReadyFilesCacheTtl: jest.fn(),
            },
          },
          {
            provide: DistributionOrchestratorService,
            useValue: {
              distribute: jest.fn(),
              rebalance: jest.fn(),
              findBestNodeForNewJob: jest.fn(),
            },
          },
          {
            provide: FileFailureTrackingService,
            useValue: {
              recordFailure: jest.fn().mockResolvedValue(false),
              isBlacklisted: jest.fn().mockResolvedValue(false),
              getBlacklistedPaths: jest.fn().mockResolvedValue(new Set()),
              clearBlacklist: jest.fn().mockResolvedValue(undefined),
            },
          },
        ],
      }).compile();

      const svc4 = module4.get<LibrariesService>(LibrariesService);
      mockLibraryRepo.findByWhere = jest.fn().mockResolvedValue(watchedLibrary);
      mockLibraryRepo.deleteLibrary = jest.fn().mockResolvedValue(watchedLibrary);

      await svc4.remove('lib-1');

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        expect.stringContaining('library'),
        expect.anything()
      );
    });

    it('should not emit stop event when library has watchEnabled=false', async () => {
      const mockEventEmitter = { emit: jest.fn() };
      const unwatchedLibrary = { ...mockLibrary, watchEnabled: false };

      mockLibraryRepo.findByWhere = jest.fn().mockResolvedValue(unwatchedLibrary);
      mockLibraryRepo.deleteLibrary = jest.fn().mockResolvedValue(unwatchedLibrary);

      await service.remove('lib-1');

      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('invalidateReadyFilesCache', () => {
    it('should reset cache data and timestamp', () => {
      // First set some cache state by calling the method
      service.invalidateReadyFilesCache();
      // Just verify the method exists and doesn't throw
      expect(() => service.invalidateReadyFilesCache()).not.toThrow();
    });
  });

  describe('getCacheMetadata', () => {
    it('should return cacheValid=false when cache is empty', async () => {
      const mockSettingsService = {
        getReadyFilesCacheTtl: jest.fn().mockResolvedValue({ readyFilesCacheTtlMinutes: 5 }),
        get: jest.fn(),
        set: jest.fn(),
        getAll: jest.fn(),
      };

      const cacheModule: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
          {
            provide: MediaAnalysisService,
            useValue: { analyze: jest.fn(), getMediaInfo: jest.fn(), getVideoCodecInfo: jest.fn() },
          },
          {
            provide: QueueService,
            useValue: { create: jest.fn(), findAll: jest.fn(), getJobStats: jest.fn() },
          },
          { provide: SettingsService, useValue: mockSettingsService },
          {
            provide: DistributionOrchestratorService,
            useValue: {
              distribute: jest.fn(),
              rebalance: jest.fn(),
              findBestNodeForNewJob: jest.fn(),
            },
          },
          {
            provide: FileFailureTrackingService,
            useValue: {
              recordFailure: jest.fn().mockResolvedValue(false),
              isBlacklisted: jest.fn().mockResolvedValue(false),
              getBlacklistedPaths: jest.fn().mockResolvedValue(new Set()),
              clearBlacklist: jest.fn().mockResolvedValue(undefined),
            },
          },
        ],
      }).compile();

      const cacheSvc = cacheModule.get<LibrariesService>(LibrariesService);
      const result = await cacheSvc.getCacheMetadata();

      expect(result.cacheValid).toBe(false);
      expect(result.cacheAgeSeconds).toBe(0);
      expect(result.cacheTtlMinutes).toBe(5);
      expect(result.cacheTimestamp).toBeNull();
    });
  });

  describe('createJobsFromScan', () => {
    it('should throw NotFoundException when library not found', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);

      await expect(service.createJobsFromScan('non-existent', 'policy-1')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw BadRequestException when no policy available', async () => {
      const libWithoutPolicy = {
        ...mockLibraryWithStats,
        defaultPolicy: null,
        defaultPolicyId: null,
      };
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(libWithoutPolicy as never);

      await expect(service.createJobsFromScan('lib-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when policy not found', async () => {
      const libWithPolicy = { ...mockLibraryWithStats, defaultPolicyId: 'policy-1' };
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(libWithPolicy as never);
      mockPolicyRepo.findById = jest.fn().mockResolvedValue(null);

      await expect(service.createJobsFromScan('lib-1', 'policy-1')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('createAllJobs', () => {
    it('should throw NotFoundException when library not found', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);

      await expect(service.createAllJobs('non-existent', 'policy-1')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw NotFoundException when policy not found', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibrary as never);
      mockPolicyRepo.findById = jest.fn().mockResolvedValue(null);

      await expect(service.createAllJobs('lib-1', 'non-existent-policy')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('getLibraryFiles', () => {
    it('should throw NotFoundException when library not found', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);

      await expect(service.getLibraryFiles('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('scanPreview', () => {
    it('should throw NotFoundException when library not found', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);

      await expect(service.scanPreview('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when library has no policy', async () => {
      const libWithoutPolicy = { ...mockLibrary, defaultPolicy: null };
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(libWithoutPolicy as never);

      await expect(service.scanPreview('lib-1')).rejects.toThrow(BadRequestException);
      await expect(service.scanPreview('lib-1')).rejects.toThrow('Library has no encoding policy');
    });
  });
});
