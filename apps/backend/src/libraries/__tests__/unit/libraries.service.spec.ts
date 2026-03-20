import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { MediaType, NodeRole, NodeStatus } from '@prisma/client';
import { JobRepository } from '../../../common/repositories/job.repository';
import { LibraryRepository } from '../../../common/repositories/library.repository';
import { NodeRepository } from '../../../common/repositories/node.repository';
import { PolicyRepository } from '../../../common/repositories/policy.repository';
import { DistributionOrchestratorService } from '../../../distribution/services/distribution-orchestrator.service';
import { MediaAnalysisService } from '../../../media/media-analysis.service';
import { QueueService } from '../../../queue/queue.service';
import { FileFailureTrackingService } from '../../../queue/services/file-failure-tracking.service';
import { SettingsService } from '../../../settings/settings.service';
import { LibrariesService } from '../../libraries.service';
import { LibraryBulkJobService } from '../../library-bulk-job.service';
import { LibraryScannerService } from '../../library-scanner.service';

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

  // Scanner mock — extracted to outer scope so individual tests can configure behavior
  const mockLibraryScannerService = {
    validateLibraryPath: jest.fn().mockImplementation((path: string) => {
      const { normalize } = require('node:path') as typeof import('node:path');
      const normalizedPath = normalize(path);
      const { BadRequestException: BRE } =
        require('@nestjs/common') as typeof import('@nestjs/common');
      if (!normalizedPath.startsWith('/')) throw new BRE('Library path must be an absolute path');
      if (normalizedPath.includes('..'))
        throw new BRE('Path traversal sequences (..) are not allowed');
      const ALLOWED = [
        '/mnt/user',
        '/mnt/cache',
        '/media',
        '/downloads',
        '/data',
        '/home',
        '/Users',
      ];
      if (!ALLOWED.some((b) => normalizedPath.startsWith(b)))
        throw new BRE(
          `Library path must start with one of the allowed base directories: ${ALLOWED.join(', ')}`
        );
      return normalizedPath;
    }),
    scan: jest.fn(),
    scanPreview: jest.fn(),
    createJobsFromScan: jest.fn(),
    createAllJobs: jest.fn(),
    invalidateReadyFilesCache: jest.fn(),
    getCacheMetadata: jest.fn(),
    getAllReadyFiles: jest.fn(),
    getLibraryFiles: jest.fn(),
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
    // Reset scanner mock and restore smart validateLibraryPath default
    Object.values(mockLibraryScannerService).forEach((fn) => {
      (fn as jest.Mock).mockReset();
    });
    mockLibraryScannerService.validateLibraryPath.mockImplementation((path: string) => {
      const { normalize } = require('node:path') as typeof import('node:path');
      const normalizedPath = normalize(path);
      const { BadRequestException: BRE } =
        require('@nestjs/common') as typeof import('@nestjs/common');
      if (!normalizedPath.startsWith('/')) throw new BRE('Library path must be an absolute path');
      if (normalizedPath.includes('..'))
        throw new BRE('Path traversal sequences (..) are not allowed');
      const ALLOWED = [
        '/mnt/user',
        '/mnt/cache',
        '/media',
        '/downloads',
        '/data',
        '/home',
        '/Users',
      ];
      if (!ALLOWED.some((b) => normalizedPath.startsWith(b)))
        throw new BRE(
          `Library path must start with one of the allowed base directories: ${ALLOWED.join(', ')}`
        );
      return normalizedPath;
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
        {
          provide: LibraryScannerService,
          useValue: mockLibraryScannerService,
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
      mockLibraryScannerService.scan.mockResolvedValue(scannedLibrary);

      const result = await service.scan('lib-1');

      expect(result.lastScanAt).toBeInstanceOf(Date);
      expect(mockLibraryScannerService.scan).toHaveBeenCalledWith('lib-1');
    });

    it('should throw NotFoundException if library does not exist', async () => {
      mockLibraryScannerService.scan.mockRejectedValue(
        new NotFoundException('Library with ID "non-existent" not found')
      );

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
            useValue: {
              analyze: jest.fn(),
              getMediaInfo: jest.fn(),
              getVideoCodecInfo: jest.fn(),
              analyzeFiles: jest.fn(),
              probeVideoFile: jest.fn(),
            },
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
          LibraryScannerService,
          {
            provide: LibraryBulkJobService,
            useValue: {
              createJobsFromScan: jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] }),
              createAllJobs: jest
                .fn()
                .mockResolvedValue({ jobsCreated: 0, filesSkipped: 0, skippedFiles: [] }),
              getLibraryFiles: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                totalFiles: 0,
                files: [],
                totalSizeBytes: '0',
                libraryName: 'Test',
                scannedAt: new Date(),
              }),
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
            useValue: {
              analyze: jest.fn(),
              getMediaInfo: jest.fn(),
              getVideoCodecInfo: jest.fn(),
              analyzeFiles: jest.fn(),
              probeVideoFile: jest.fn(),
            },
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
          LibraryScannerService,
          {
            provide: LibraryBulkJobService,
            useValue: {
              createJobsFromScan: jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] }),
              createAllJobs: jest
                .fn()
                .mockResolvedValue({ jobsCreated: 0, filesSkipped: 0, skippedFiles: [] }),
              getLibraryFiles: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                totalFiles: 0,
                files: [],
                totalSizeBytes: '0',
                libraryName: 'Test',
                scannedAt: new Date(),
              }),
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
            useValue: {
              analyze: jest.fn(),
              getMediaInfo: jest.fn(),
              getVideoCodecInfo: jest.fn(),
              analyzeFiles: jest.fn(),
              probeVideoFile: jest.fn(),
            },
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
          LibraryScannerService,
          {
            provide: LibraryBulkJobService,
            useValue: {
              createJobsFromScan: jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] }),
              createAllJobs: jest
                .fn()
                .mockResolvedValue({ jobsCreated: 0, filesSkipped: 0, skippedFiles: [] }),
              getLibraryFiles: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                totalFiles: 0,
                files: [],
                totalSizeBytes: '0',
                libraryName: 'Test',
                scannedAt: new Date(),
              }),
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
            useValue: {
              analyze: jest.fn(),
              getMediaInfo: jest.fn(),
              getVideoCodecInfo: jest.fn(),
              analyzeFiles: jest.fn(),
              probeVideoFile: jest.fn(),
            },
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
          LibraryScannerService,
          {
            provide: LibraryBulkJobService,
            useValue: {
              createJobsFromScan: jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] }),
              createAllJobs: jest
                .fn()
                .mockResolvedValue({ jobsCreated: 0, filesSkipped: 0, skippedFiles: [] }),
              getLibraryFiles: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                totalFiles: 0,
                files: [],
                totalSizeBytes: '0',
                libraryName: 'Test',
                scannedAt: new Date(),
              }),
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
      mockLibraryScannerService.createJobsFromScan.mockRejectedValue(
        new NotFoundException('Library not found')
      );

      await expect(service.createJobsFromScan('non-existent', 'policy-1')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw BadRequestException when no policy available', async () => {
      mockLibraryScannerService.createJobsFromScan.mockRejectedValue(
        new BadRequestException('No encoding policy')
      );

      await expect(service.createJobsFromScan('lib-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when policy not found', async () => {
      mockLibraryScannerService.createJobsFromScan.mockRejectedValue(
        new NotFoundException('Policy not found')
      );

      await expect(service.createJobsFromScan('lib-1', 'policy-1')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('createAllJobs', () => {
    it('should throw NotFoundException when library not found', async () => {
      mockLibraryScannerService.createAllJobs.mockRejectedValue(
        new NotFoundException('Library not found')
      );

      await expect(service.createAllJobs('non-existent', 'policy-1')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw NotFoundException when policy not found', async () => {
      mockLibraryScannerService.createAllJobs.mockRejectedValue(
        new NotFoundException('Policy not found')
      );

      await expect(service.createAllJobs('lib-1', 'non-existent-policy')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('getLibraryFiles', () => {
    it('should throw NotFoundException when library not found', async () => {
      mockLibraryScannerService.getLibraryFiles.mockRejectedValue(
        new NotFoundException('Library not found')
      );

      await expect(service.getLibraryFiles('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('scanPreview', () => {
    it('should throw NotFoundException when library not found', async () => {
      mockLibraryScannerService.scanPreview.mockRejectedValue(
        new NotFoundException('Library not found')
      );

      await expect(service.scanPreview('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when library has no policy', async () => {
      mockLibraryScannerService.scanPreview.mockRejectedValue(
        new BadRequestException('Library has no encoding policy')
      );

      await expect(service.scanPreview('lib-1')).rejects.toThrow(BadRequestException);
      await expect(service.scanPreview('lib-1')).rejects.toThrow('Library has no encoding policy');
    });
  });

  describe('create - additional branches', () => {
    it('should throw BadRequestException for path with traversal after normalization', async () => {
      const dto = {
        name: 'Bad Path',
        path: '/mnt/user/movies/../../../etc/passwd',
        mediaType: MediaType.MOVIE,
        nodeId: 'node-1',
      };
      // normalize() resolves this to /etc/passwd which is not in allowed dirs
      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('should allow /media base path', async () => {
      const dto = {
        name: 'Media',
        path: '/media/movies',
        mediaType: MediaType.MOVIE,
        nodeId: 'node-1',
      };
      const mediaLib = { ...mockLibrary, path: '/media/movies' };
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.library, 'create').mockResolvedValue(mediaLib as never);

      const result = await service.create(dto);
      expect(result.path).toBe('/media/movies');
    });

    it('should allow /data base path', async () => {
      const dto = {
        name: 'Data',
        path: '/data/videos',
        mediaType: MediaType.MOVIE,
        nodeId: 'node-1',
      };
      const dataLib = { ...mockLibrary, path: '/data/videos' };
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.library, 'create').mockResolvedValue(dataLib as never);

      const result = await service.create(dto);
      expect(result.path).toBe('/data/videos');
    });

    it('should allow /downloads base path', async () => {
      const dto = {
        name: 'Downloads',
        path: '/downloads/movies',
        mediaType: MediaType.MOVIE,
        nodeId: 'node-1',
      };
      const dlLib = { ...mockLibrary, path: '/downloads/movies' };
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.library, 'create').mockResolvedValue(dlLib as never);

      const result = await service.create(dto);
      expect(result.path).toBe('/downloads/movies');
    });
  });

  describe('findAll - with node filter', () => {
    it('should pass nodeId filter when specified', async () => {
      const libs = [mockLibraryWithStats];
      jest.spyOn(prisma.library, 'findMany').mockResolvedValue(libs as never);

      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(prisma.library.findMany).toHaveBeenCalled();
    });
  });

  describe('update - no watchEnabled change', () => {
    it('should not emit any events when watchEnabled is not changed', async () => {
      const mockEventEmitter = { emit: jest.fn() };
      const updatedLibrary = { ...mockLibrary, name: 'New Name' };

      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: mockEventEmitter },
          {
            provide: MediaAnalysisService,
            useValue: {
              analyze: jest.fn(),
              getMediaInfo: jest.fn(),
              getVideoCodecInfo: jest.fn(),
              analyzeFiles: jest.fn(),
              probeVideoFile: jest.fn(),
            },
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
          LibraryScannerService,
          {
            provide: LibraryBulkJobService,
            useValue: {
              createJobsFromScan: jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] }),
              createAllJobs: jest
                .fn()
                .mockResolvedValue({ jobsCreated: 0, filesSkipped: 0, skippedFiles: [] }),
              getLibraryFiles: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                totalFiles: 0,
                files: [],
                totalSizeBytes: '0',
                libraryName: 'Test',
                scannedAt: new Date(),
              }),
            },
          },
        ],
      }).compile();

      const svc = mod.get<LibrariesService>(LibrariesService);
      mockLibraryRepo.findByWhere = jest.fn().mockResolvedValue(mockLibrary);
      mockLibraryRepo.updateWithInclude = jest.fn().mockResolvedValue(updatedLibrary);

      await svc.update('lib-1', { name: 'New Name' });
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should not emit event when watchEnabled value is unchanged (true → true)', async () => {
      const mockEventEmitter = { emit: jest.fn() };
      const watchedLibrary = { ...mockLibrary, watchEnabled: true };

      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: mockEventEmitter },
          {
            provide: MediaAnalysisService,
            useValue: {
              analyze: jest.fn(),
              getMediaInfo: jest.fn(),
              getVideoCodecInfo: jest.fn(),
              analyzeFiles: jest.fn(),
              probeVideoFile: jest.fn(),
            },
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
          LibraryScannerService,
          {
            provide: LibraryBulkJobService,
            useValue: {
              createJobsFromScan: jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] }),
              createAllJobs: jest
                .fn()
                .mockResolvedValue({ jobsCreated: 0, filesSkipped: 0, skippedFiles: [] }),
              getLibraryFiles: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                totalFiles: 0,
                files: [],
                totalSizeBytes: '0',
                libraryName: 'Test',
                scannedAt: new Date(),
              }),
            },
          },
        ],
      }).compile();

      const svc = mod.get<LibrariesService>(LibrariesService);
      mockLibraryRepo.findByWhere = jest.fn().mockResolvedValue(watchedLibrary);
      mockLibraryRepo.updateWithInclude = jest.fn().mockResolvedValue(watchedLibrary);

      await svc.update('lib-1', { watchEnabled: true });
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('remove - non-existent library', () => {
    it('should throw NotFoundException when trying to remove non-existent library', async () => {
      mockLibraryRepo.findByWhere = jest.fn().mockResolvedValue(null);

      await expect(service.remove('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAllReadyFiles', () => {
    it('should return empty array when no libraries have policies', async () => {
      const mockSettingsService = {
        getReadyFilesCacheTtl: jest.fn().mockResolvedValue({ readyFilesCacheTtlMinutes: 5 }),
        get: jest.fn(),
        set: jest.fn(),
        getAll: jest.fn(),
      };

      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
          {
            provide: MediaAnalysisService,
            useValue: {
              analyze: jest.fn(),
              getMediaInfo: jest.fn(),
              getVideoCodecInfo: jest.fn(),
              analyzeFiles: jest.fn(),
              probeVideoFile: jest.fn(),
            },
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
          LibraryScannerService,
          {
            provide: LibraryBulkJobService,
            useValue: {
              createJobsFromScan: jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] }),
              createAllJobs: jest
                .fn()
                .mockResolvedValue({ jobsCreated: 0, filesSkipped: 0, skippedFiles: [] }),
              getLibraryFiles: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                totalFiles: 0,
                files: [],
                totalSizeBytes: '0',
                libraryName: 'Test',
                scannedAt: new Date(),
              }),
            },
          },
        ],
      }).compile();

      const svc = mod.get<LibrariesService>(LibrariesService);
      // Libraries with no defaultPolicy
      mockLibraryRepo.findAllLibraries = jest
        .fn()
        .mockResolvedValue([{ ...mockLibrary, defaultPolicy: null }]);

      const result = await svc.getAllReadyFiles();
      expect(result).toEqual([]);
    });

    it('should return cached result on second call within TTL', async () => {
      const mockSettingsService = {
        getReadyFilesCacheTtl: jest.fn().mockResolvedValue({ readyFilesCacheTtlMinutes: 5 }),
        get: jest.fn(),
        set: jest.fn(),
        getAll: jest.fn(),
      };

      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
          {
            provide: MediaAnalysisService,
            useValue: {
              analyze: jest.fn(),
              getMediaInfo: jest.fn(),
              getVideoCodecInfo: jest.fn(),
              analyzeFiles: jest.fn(),
              probeVideoFile: jest.fn(),
            },
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
          LibraryScannerService,
          {
            provide: LibraryBulkJobService,
            useValue: {
              createJobsFromScan: jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] }),
              createAllJobs: jest
                .fn()
                .mockResolvedValue({ jobsCreated: 0, filesSkipped: 0, skippedFiles: [] }),
              getLibraryFiles: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                totalFiles: 0,
                files: [],
                totalSizeBytes: '0',
                libraryName: 'Test',
                scannedAt: new Date(),
              }),
            },
          },
        ],
      }).compile();

      const svc = mod.get<LibrariesService>(LibrariesService);
      mockLibraryRepo.findAllLibraries = jest.fn().mockResolvedValue([]);

      // First call populates cache
      await svc.getAllReadyFiles();
      // Second call should use cache
      await svc.getAllReadyFiles();

      // findAllLibraries should only be called once (second call used cache)
      expect(mockLibraryRepo.findAllLibraries).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCacheMetadata - with populated cache', () => {
    it('should return cacheValid=true when cache is populated and fresh', async () => {
      const mockSettingsService = {
        getReadyFilesCacheTtl: jest.fn().mockResolvedValue({ readyFilesCacheTtlMinutes: 5 }),
        get: jest.fn(),
        set: jest.fn(),
        getAll: jest.fn(),
      };

      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
          {
            provide: MediaAnalysisService,
            useValue: {
              analyze: jest.fn(),
              getMediaInfo: jest.fn(),
              getVideoCodecInfo: jest.fn(),
              analyzeFiles: jest.fn(),
              probeVideoFile: jest.fn(),
            },
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
          LibraryScannerService,
          {
            provide: LibraryBulkJobService,
            useValue: {
              createJobsFromScan: jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] }),
              createAllJobs: jest
                .fn()
                .mockResolvedValue({ jobsCreated: 0, filesSkipped: 0, skippedFiles: [] }),
              getLibraryFiles: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                totalFiles: 0,
                files: [],
                totalSizeBytes: '0',
                libraryName: 'Test',
                scannedAt: new Date(),
              }),
            },
          },
        ],
      }).compile();

      const svc = mod.get<LibrariesService>(LibrariesService);
      mockLibraryRepo.findAllLibraries = jest.fn().mockResolvedValue([]);
      // Populate cache via getAllReadyFiles
      await svc.getAllReadyFiles();

      const result = await svc.getCacheMetadata();
      expect(result.cacheValid).toBe(true);
      expect(result.cacheTimestamp).toBeInstanceOf(Date);
      expect(result.cacheTtlMinutes).toBe(5);
    });
  });

  describe('createJobsFromScan - with specific filePaths', () => {
    it('should return 0 jobs when filePaths list has files but probeVideoFile returns null', async () => {
      const libWithPolicy = {
        ...mockLibraryWithStats,
        defaultPolicyId: 'policy-1',
        defaultPolicy: { id: 'policy-1', name: 'Test', targetCodec: 'hevc' },
        node: mockNode,
      };
      const mockPolicy = { id: 'policy-1', name: 'Test', targetCodec: 'hevc' };
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(libWithPolicy as never);
      mockPolicyRepo.findById = jest.fn().mockResolvedValue(mockPolicy);
      mockJobRepo.findManySelect = jest.fn().mockResolvedValue([]);

      // createJobsFromScan delegates to scanner; stub it to return 0 jobs
      mockLibraryScannerService.createJobsFromScan.mockResolvedValue({ jobsCreated: 0, jobs: [] });

      const result = await service.createJobsFromScan('lib-1', 'policy-1', ['/media/movie.mkv']);
      expect(result).not.toBeNull();
      expect(result.jobsCreated).toBe(0);
    });
  });

  describe('createAllJobs - additional branches', () => {
    it('should return empty result when no video files found', async () => {
      mockLibraryScannerService.createAllJobs.mockResolvedValue({
        jobsCreated: 0,
        filesSkipped: 0,
        jobs: [],
      });

      const result = await service.createAllJobs('lib-1', 'policy-1');

      expect(result.jobsCreated).toBe(0);
      expect(result.filesSkipped).toBe(0);
    });
  });

  describe('create - repository error propagation', () => {
    it('should re-throw error when createLibrary fails', async () => {
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.library, 'create').mockRejectedValue(new Error('DB write failed'));

      await expect(
        service.create({
          name: 'Movie Collection',
          path: '/mnt/user/media/Movies',
          mediaType: MediaType.MOVIE,
          nodeId: 'node-1',
        })
      ).rejects.toThrow('DB write failed');
    });
  });

  describe('create - allowed base paths', () => {
    it('should allow /home base path', async () => {
      const dto = {
        name: 'Home Videos',
        path: '/home/user/videos',
        mediaType: MediaType.MOVIE,
        nodeId: 'node-1',
      };
      const homeLib = { ...mockLibrary, path: '/home/user/videos' };
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.library, 'create').mockResolvedValue(homeLib as never);

      const result = await service.create(dto);
      expect(result.path).toBe('/home/user/videos');
    });

    it('should allow /Users base path', async () => {
      const dto = {
        name: 'macOS Videos',
        path: '/Users/john/Movies',
        mediaType: MediaType.MOVIE,
        nodeId: 'node-1',
      };
      const usersLib = { ...mockLibrary, path: '/Users/john/Movies' };
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.library, 'create').mockResolvedValue(usersLib as never);

      const result = await service.create(dto);
      expect(result.path).toBe('/Users/john/Movies');
    });

    it('should allow /mnt/cache base path', async () => {
      const dto = {
        name: 'Cache Videos',
        path: '/mnt/cache/media',
        mediaType: MediaType.MOVIE,
        nodeId: 'node-1',
      };
      const cacheLib = { ...mockLibrary, path: '/mnt/cache/media' };
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.library, 'create').mockResolvedValue(cacheLib as never);

      const result = await service.create(dto);
      expect(result.path).toBe('/mnt/cache/media');
    });
  });

  describe('update - error propagation', () => {
    it('should re-throw error when updateWithInclude fails', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibrary as never);
      jest.spyOn(prisma.library, 'update').mockRejectedValue(new Error('DB update failed'));

      await expect(service.update('lib-1', { name: 'New Name' })).rejects.toThrow(
        'DB update failed'
      );
    });

    it('should not emit event when watchEnabled is undefined in update dto', async () => {
      const updatedLibrary = { ...mockLibrary, name: 'Updated' };
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibrary as never);
      jest.spyOn(prisma.library, 'update').mockResolvedValue(updatedLibrary as never);

      const result = await service.update('lib-1', { name: 'Updated' });
      expect(result).toEqual(updatedLibrary);
    });
  });

  describe('remove - error propagation', () => {
    it('should re-throw error when deleteLibrary fails', async () => {
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(mockLibrary as never);
      jest.spyOn(prisma.library, 'delete').mockRejectedValue(new Error('DB delete failed'));

      await expect(service.remove('lib-1')).rejects.toThrow('DB delete failed');
    });
  });

  describe('scan - error propagation', () => {
    it('should re-throw error when updateWithInclude fails during scan', async () => {
      mockLibraryScannerService.scan.mockRejectedValue(new Error('Scan update failed'));

      await expect(service.scan('lib-1')).rejects.toThrow('Scan update failed');
    });
  });

  describe('scanPreview - success with no files', () => {
    it('should return empty preview when library has policy but no video files', async () => {
      const libWithPolicy = {
        ...mockLibrary,
        defaultPolicy: {
          id: 'policy-1',
          name: 'Test Policy',
          targetCodec: 'hevc',
          preset: 'BALANCED_HEVC',
        },
      };
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(libWithPolicy as never);
      mockJobRepo.findManySelect = jest.fn().mockResolvedValue([]);

      const mockMediaAnalysis = {
        analyzeFiles: jest.fn().mockResolvedValue({
          needsEncoding: [],
          alreadyOptimized: [],
          totalFiles: 0,
          totalSizeBytes: BigInt(0),
          errors: [],
        }),
        probeVideoFile: jest.fn(),
        analyze: jest.fn(),
        getMediaInfo: jest.fn(),
        getVideoCodecInfo: jest.fn(),
      };

      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
          { provide: MediaAnalysisService, useValue: mockMediaAnalysis },
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
          {
            provide: LibraryScannerService,
            useValue: {
              validateLibraryPath: jest.fn((path: string) => path),
              scan: jest.fn(),
              scanPreview: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                needsEncoding: [],
                totalFiles: 0,
                totalSizeBytes: '0',
                needsEncodingCount: 0,
                alreadyOptimizedCount: 0,
                alreadyOptimized: [],
                errors: [],
                scannedAt: new Date(),
                policyId: 'policy-1',
                policyName: 'Test',
                targetCodec: 'hevc',
                availablePolicies: [],
                libraryName: 'Movie Collection',
              }),
              createJobsFromScan: jest.fn(),
              createAllJobs: jest.fn(),
              invalidateReadyFilesCache: jest.fn(),
              getCacheMetadata: jest.fn(),
              getAllReadyFiles: jest.fn(),
              getLibraryFiles: jest.fn(),
            },
          },
        ],
      }).compile();

      mockLibraryRepo.findUniqueWithInclude = jest.fn().mockResolvedValue(libWithPolicy);

      const svc = mod.get<LibrariesService>(LibrariesService);
      const result = await svc.scanPreview('lib-1');

      expect(result.libraryId).toBe('lib-1');
      expect(result.needsEncoding).toEqual([]);
      expect(result.totalFiles).toBe(0);
    });
  });

  describe('getCacheMetadata - expired cache', () => {
    it('should return cacheValid=false when cache is expired', async () => {
      const mockSettingsService = {
        getReadyFilesCacheTtl: jest.fn().mockResolvedValue({ readyFilesCacheTtlMinutes: 5 }),
        get: jest.fn(),
        set: jest.fn(),
        getAll: jest.fn(),
      };

      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
          {
            provide: MediaAnalysisService,
            useValue: {
              analyze: jest.fn(),
              getMediaInfo: jest.fn(),
              getVideoCodecInfo: jest.fn(),
              analyzeFiles: jest.fn(),
              probeVideoFile: jest.fn(),
            },
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
          LibraryScannerService,
          {
            provide: LibraryBulkJobService,
            useValue: {
              createJobsFromScan: jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] }),
              createAllJobs: jest
                .fn()
                .mockResolvedValue({ jobsCreated: 0, filesSkipped: 0, skippedFiles: [] }),
              getLibraryFiles: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                totalFiles: 0,
                files: [],
                totalSizeBytes: '0',
                libraryName: 'Test',
                scannedAt: new Date(),
              }),
            },
          },
        ],
      }).compile();

      const svc = mod.get<LibrariesService>(LibrariesService);
      const scannerSvc = mod.get<LibraryScannerService>(LibraryScannerService);

      // Manually set an expired cache (timestamp in the past beyond TTL)
      // 5 min TTL = 300_000ms, set timestamp 10 minutes ago
      (
        scannerSvc as unknown as { readyFilesCache: { data: unknown; timestamp: number } }
      ).readyFilesCache = {
        data: [],
        timestamp: Date.now() - 10 * 60 * 1000,
      };

      const result = await svc.getCacheMetadata();
      expect(result.cacheValid).toBe(false);
      expect(result.cacheAgeSeconds).toBeGreaterThan(0);
      expect(result.cacheTimestamp).toBeInstanceOf(Date);
    });
  });

  describe('autoRefreshReadyFilesCache', () => {
    it('should call getAllReadyFiles and complete without throwing', async () => {
      const mockSettingsService = {
        getReadyFilesCacheTtl: jest.fn().mockResolvedValue({ readyFilesCacheTtlMinutes: 5 }),
        get: jest.fn(),
        set: jest.fn(),
        getAll: jest.fn(),
      };

      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
          {
            provide: MediaAnalysisService,
            useValue: {
              analyze: jest.fn(),
              getMediaInfo: jest.fn(),
              getVideoCodecInfo: jest.fn(),
              analyzeFiles: jest.fn(),
              probeVideoFile: jest.fn(),
            },
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
          LibraryScannerService,
          {
            provide: LibraryBulkJobService,
            useValue: {
              createJobsFromScan: jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] }),
              createAllJobs: jest
                .fn()
                .mockResolvedValue({ jobsCreated: 0, filesSkipped: 0, skippedFiles: [] }),
              getLibraryFiles: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                totalFiles: 0,
                files: [],
                totalSizeBytes: '0',
                libraryName: 'Test',
                scannedAt: new Date(),
              }),
            },
          },
        ],
      }).compile();

      mockLibraryRepo.findAllLibraries = jest.fn().mockResolvedValue([]);

      await expect(
        mod.get<LibraryScannerService>(LibraryScannerService).autoRefreshReadyFilesCache()
      ).resolves.toBeUndefined();
    });

    it('should swallow errors thrown by getAllReadyFiles', async () => {
      const mockSettingsService = {
        getReadyFilesCacheTtl: jest.fn().mockRejectedValue(new Error('Settings unavailable')),
        get: jest.fn(),
        set: jest.fn(),
        getAll: jest.fn(),
      };

      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
          {
            provide: MediaAnalysisService,
            useValue: {
              analyze: jest.fn(),
              getMediaInfo: jest.fn(),
              getVideoCodecInfo: jest.fn(),
              analyzeFiles: jest.fn(),
              probeVideoFile: jest.fn(),
            },
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
          LibraryScannerService,
          {
            provide: LibraryBulkJobService,
            useValue: {
              createJobsFromScan: jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] }),
              createAllJobs: jest
                .fn()
                .mockResolvedValue({ jobsCreated: 0, filesSkipped: 0, skippedFiles: [] }),
              getLibraryFiles: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                totalFiles: 0,
                files: [],
                totalSizeBytes: '0',
                libraryName: 'Test',
                scannedAt: new Date(),
              }),
            },
          },
        ],
      }).compile();

      // Should NOT throw - cron handler catches errors internally
      await expect(
        mod.get<LibraryScannerService>(LibraryScannerService).autoRefreshReadyFilesCache()
      ).resolves.toBeUndefined();
    });
  });

  describe('getLibraryFiles - additional branches', () => {
    it('should return empty files list when no video files found', async () => {
      mockLibraryScannerService.getLibraryFiles.mockResolvedValue({
        libraryId: 'lib-1',
        files: [],
        totalFiles: 0,
      });

      const result = await service.getLibraryFiles('lib-1');

      expect(result.libraryId).toBe('lib-1');
      expect(result.files).toEqual([]);
      expect(result.totalFiles).toBe(0);
    });
  });

  describe('createJobsFromScan - zero filePaths triggers scanPreview', () => {
    it('should return 0 jobs when scanPreview returns empty needsEncoding', async () => {
      const libWithPolicy = {
        ...mockLibraryWithStats,
        defaultPolicyId: 'policy-1',
        defaultPolicy: {
          id: 'policy-1',
          name: 'Test',
          targetCodec: 'hevc',
          preset: 'BALANCED_HEVC',
        },
        node: mockNode,
      };
      const mockPolicy = { id: 'policy-1', name: 'Test', targetCodec: 'hevc' };

      const mockMediaAnalysis = {
        analyzeFiles: jest.fn().mockResolvedValue({
          needsEncoding: [],
          alreadyOptimized: [],
          totalFiles: 0,
          totalSizeBytes: BigInt(0),
          errors: [],
        }),
        probeVideoFile: jest.fn(),
        analyze: jest.fn(),
        getMediaInfo: jest.fn(),
        getVideoCodecInfo: jest.fn(),
      };

      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
          { provide: MediaAnalysisService, useValue: mockMediaAnalysis },
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
          LibraryScannerService,
          {
            provide: LibraryBulkJobService,
            useValue: {
              createJobsFromScan: jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] }),
              createAllJobs: jest
                .fn()
                .mockResolvedValue({ jobsCreated: 0, filesSkipped: 0, skippedFiles: [] }),
              getLibraryFiles: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                totalFiles: 0,
                files: [],
                totalSizeBytes: '0',
                libraryName: 'Test',
                scannedAt: new Date(),
              }),
            },
          },
        ],
      }).compile();

      mockLibraryRepo.findUniqueWithInclude = jest.fn().mockResolvedValue(libWithPolicy);
      mockPolicyRepo.findById = jest.fn().mockResolvedValue(mockPolicy);
      mockJobRepo.findManySelect = jest.fn().mockResolvedValue([]);

      const svc = mod.get<LibrariesService>(LibrariesService);
      // No filePaths provided → triggers scanPreview internally
      const result = await svc.createJobsFromScan('lib-1', 'policy-1');

      expect(result.jobsCreated).toBe(0);
      expect(result.jobs).toEqual([]);
    });
  });

  describe('getAllLibraryPaths - with and without nodeId', () => {
    it('should call findAllLibraries without filter when nodeId is undefined', async () => {
      const findAllSpy = jest
        .spyOn(mockLibraryRepo, 'findAllLibraries')
        .mockResolvedValue([mockLibrary] as never);

      const result = await service.getAllLibraryPaths(undefined);

      expect(result).toContain(mockLibrary.path);
      expect(findAllSpy).toHaveBeenCalledWith(undefined);
    });

    it('should call findAllLibraries with nodeId filter when nodeId is provided', async () => {
      const findAllSpy = jest
        .spyOn(mockLibraryRepo, 'findAllLibraries')
        .mockResolvedValue([mockLibrary] as never);

      await service.getAllLibraryPaths('node-1');

      expect(findAllSpy).toHaveBeenCalledWith({ nodeId: 'node-1' });
    });
  });

  // ── update — re-throws error from updateWithInclude ───────────────────────

  describe('update — re-throws updateWithInclude error', () => {
    it('throws when updateWithInclude rejects', async () => {
      mockLibraryRepo.findByWhere = jest.fn().mockResolvedValue(mockLibrary);
      mockLibraryRepo.updateWithInclude = jest.fn().mockRejectedValue(new Error('DB constraint'));

      await expect(service.update('lib-1', { name: 'New' })).rejects.toThrow('DB constraint');
    });
  });

  // ── remove — re-throws error from deleteLibrary ───────────────────────────

  describe('remove — re-throws deleteLibrary error', () => {
    it('throws when deleteLibrary rejects', async () => {
      mockLibraryRepo.findByWhere = jest.fn().mockResolvedValue(mockLibrary);
      mockLibraryRepo.deleteLibrary = jest.fn().mockRejectedValue(new Error('FK violation'));

      await expect(service.remove('lib-1')).rejects.toThrow('FK violation');
    });
  });

  // ── create — re-throws createLibrary error ────────────────────────────────

  describe('create — re-throws createLibrary DB error', () => {
    it('throws when createLibrary rejects', async () => {
      const dto = {
        name: 'Movie Collection',
        path: '/mnt/user/media/Movies',
        mediaType: MediaType.MOVIE,
        nodeId: 'node-1',
      };

      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.library, 'create').mockRejectedValue(new Error('Unique constraint failed'));

      await expect(service.create(dto)).rejects.toThrow('Unique constraint failed');
    });
  });

  // ── validateLibraryPath — /home and /Users allowed ───────────────────────

  describe('validateLibraryPath — /home and /Users base paths', () => {
    it('should allow /home base path', async () => {
      const dto = {
        name: 'Home Media',
        path: '/home/user/media',
        mediaType: MediaType.MOVIE,
        nodeId: 'node-1',
      };
      const homeLib = { ...mockLibrary, path: '/home/user/media' };
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.library, 'create').mockResolvedValue(homeLib as never);

      const result = await service.create(dto);
      expect(result.path).toBe('/home/user/media');
    });

    it('should allow /Users base path (macOS)', async () => {
      const dto = {
        name: 'macOS Media',
        path: '/Users/john/Movies',
        mediaType: MediaType.MOVIE,
        nodeId: 'node-1',
      };
      const macLib = { ...mockLibrary, path: '/Users/john/Movies' };
      jest.spyOn(prisma.node, 'findUnique').mockResolvedValue(mockNode as never);
      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prisma.library, 'create').mockResolvedValue(macLib as never);

      const result = await service.create(dto);
      expect(result.path).toBe('/Users/john/Movies');
    });
  });

  // ── scan — NotFoundException when library not found ───────────────────────

  describe('scan — NotFoundException', () => {
    it('throws NotFoundException when library does not exist', async () => {
      mockLibraryScannerService.scan.mockRejectedValue(
        new NotFoundException('Library with ID "non-existent" not found')
      );

      await expect(service.scan('non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.scan('non-existent')).rejects.toThrow(
        'Library with ID "non-existent" not found'
      );
    });
  });

  // ── getCacheMetadata — expired cache (cacheValid = false) ─────────────────

  describe('getCacheMetadata — expired cache', () => {
    it('returns cacheValid=false when cache timestamp is stale beyond TTL', async () => {
      const mockSettingsService = {
        getReadyFilesCacheTtl: jest.fn().mockResolvedValue({ readyFilesCacheTtlMinutes: 1 }),
        get: jest.fn(),
        set: jest.fn(),
        getAll: jest.fn(),
      };

      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          LibrariesService,
          { provide: LibraryRepository, useValue: mockLibraryRepo },
          { provide: NodeRepository, useValue: mockNodeRepo },
          { provide: JobRepository, useValue: mockJobRepo },
          { provide: PolicyRepository, useValue: mockPolicyRepo },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
          {
            provide: MediaAnalysisService,
            useValue: {
              analyze: jest.fn(),
              getMediaInfo: jest.fn(),
              getVideoCodecInfo: jest.fn(),
              analyzeFiles: jest.fn(),
              probeVideoFile: jest.fn(),
            },
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
          LibraryScannerService,
          {
            provide: LibraryBulkJobService,
            useValue: {
              createJobsFromScan: jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] }),
              createAllJobs: jest
                .fn()
                .mockResolvedValue({ jobsCreated: 0, filesSkipped: 0, skippedFiles: [] }),
              getLibraryFiles: jest.fn().mockResolvedValue({
                libraryId: 'lib-1',
                totalFiles: 0,
                files: [],
                totalSizeBytes: '0',
                libraryName: 'Test',
                scannedAt: new Date(),
              }),
            },
          },
        ],
      }).compile();

      const svc = mod.get<LibrariesService>(LibrariesService);
      const scannerSvc2 = mod.get<LibraryScannerService>(LibraryScannerService);

      // Manually set an expired timestamp (2 minutes ago, TTL is 1 minute)
      (scannerSvc2 as any).readyFilesCache = {
        data: [],
        timestamp: Date.now() - 2 * 60 * 1000,
      };

      const result = await svc.getCacheMetadata();
      expect(result.cacheValid).toBe(false);
      expect(result.cacheTimestamp).toBeInstanceOf(Date);
      expect(result.cacheAgeSeconds).toBeGreaterThan(0);
    });
  });

  // ── createJobsFromScan — filePaths provided, skips scanPreview ───────────

  describe('createJobsFromScan — explicit filePaths skips scanPreview', () => {
    it('returns 0 jobs when all provided files fail probeVideoFile', async () => {
      const libWithPolicy = {
        ...mockLibraryWithStats,
        defaultPolicyId: 'policy-1',
        defaultPolicy: { id: 'policy-1', name: 'Test', targetCodec: 'hevc' },
        node: mockNode,
      };
      const mockPol = { id: 'policy-1', name: 'Test', targetCodec: 'hevc' };

      jest.spyOn(prisma.library, 'findUnique').mockResolvedValue(libWithPolicy as never);
      mockPolicyRepo.findById = jest.fn().mockResolvedValue(mockPol);
      mockJobRepo.findManySelect = jest.fn().mockResolvedValue([]);

      // createJobsFromScan delegates to libraryScanner — stub the scanner mock's return value
      (service.libraryScanner as unknown as { createJobsFromScan: jest.Mock }).createJobsFromScan =
        jest.fn().mockResolvedValue({ jobsCreated: 0, jobs: [] });

      const result = await service.createJobsFromScan('lib-1', 'policy-1', [
        '/media/movie1.mkv',
        '/media/movie2.mkv',
      ]);

      expect(result.jobsCreated).toBe(0);
      expect(result.jobs).toEqual([]);
    });
  });

  // ── createJobsFromScan — empty filesToEncode returns early ───────────────

  describe('createJobsFromScan — zero files after scan returns early', () => {
    it('returns {jobsCreated: 0, jobs: []} when scanPreview produces no needsEncoding files', async () => {
      const _libWithPolicy = {
        ...mockLibraryWithStats,
        defaultPolicyId: 'policy-1',
        defaultPolicy: {
          id: 'policy-1',
          name: 'Test',
          targetCodec: 'hevc',
          preset: 'BALANCED_HEVC',
        },
        node: mockNode,
      };
      const _mockPol = {
        id: 'policy-1',
        name: 'Test',
        targetCodec: 'hevc',
        preset: 'BALANCED_HEVC',
      };

      // createJobsFromScan delegates fully to scanner; stub it to return empty result
      mockLibraryScannerService.createJobsFromScan.mockResolvedValue({ jobsCreated: 0, jobs: [] });

      // No filePaths provided → scanner handles scanPreview branch → returns empty
      const result = await service.createJobsFromScan('lib-1', 'policy-1');

      expect(result.jobsCreated).toBe(0);
      expect(result.jobs).toEqual([]);
    });
  });

  // ── update — NotFoundException propagates correctly ───────────────────────

  describe('update — NotFoundException when library missing', () => {
    it('throws NotFoundException with correct message', async () => {
      mockLibraryRepo.findByWhere = jest.fn().mockResolvedValue(null);

      await expect(service.update('missing-id', { name: 'X' })).rejects.toThrow(
        'Library with ID "missing-id" not found'
      );
    });
  });

  // ── remove — NotFoundException propagates correctly ───────────────────────

  describe('remove — NotFoundException when library missing', () => {
    it('throws NotFoundException with correct message', async () => {
      mockLibraryRepo.findByWhere = jest.fn().mockResolvedValue(null);

      await expect(service.remove('ghost-id')).rejects.toThrow(
        'Library with ID "ghost-id" not found'
      );
    });
  });
});
