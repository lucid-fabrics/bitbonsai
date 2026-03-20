import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import type { Library } from '@prisma/client';
import { LibraryRepository } from '../../../common/repositories/library.repository';
import { FileWatcherService } from '../../file-watcher.service';

describe('FileWatcherService', () => {
  let service: FileWatcherService;
  let libraryRepository: LibraryRepository;
  let eventEmitter: EventEmitter2;

  const mockLibrary: Library = {
    id: 'test-lib-1',
    name: 'Test Library',
    path: '/media/test',
    mediaType: 'MOVIE',
    nodeId: 'test-node-1',
    enabled: true,
    watchEnabled: true,
    lastScanAt: null,
    totalFiles: 0,
    totalSizeBytes: BigInt(0),
    defaultPolicyId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileWatcherService,
        {
          provide: LibraryRepository,
          useValue: {
            findAllLibraries: jest.fn(),
            findById: jest.fn(),
            updateLibrary: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FileWatcherService>(FileWatcherService);
    libraryRepository = module.get<LibraryRepository>(LibraryRepository);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('onModuleInit', () => {
    it('should initialize watchers for enabled libraries', async () => {
      jest.spyOn(libraryRepository, 'findAllLibraries').mockResolvedValue([mockLibrary]);
      const startWatcherSpy = jest.spyOn(service, 'startWatcher');

      await service.onModuleInit();

      expect(libraryRepository.findAllLibraries).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, watchEnabled: true })
      );
      expect(startWatcherSpy).toHaveBeenCalledWith(mockLibrary.id, mockLibrary.path);
    });

    it('should start 0 watchers when no libraries have watchEnabled=true', async () => {
      jest.spyOn(libraryRepository, 'findAllLibraries').mockResolvedValue([]);

      await service.onModuleInit();

      expect(libraryRepository.findAllLibraries).toHaveBeenCalled();
      expect(service.getAllWatcherStatuses()).toHaveLength(0);
    });

    it('should not fail if findAllLibraries throws error', async () => {
      jest.spyOn(libraryRepository, 'findAllLibraries').mockRejectedValue(new Error('DB error'));

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('enableWatcher', () => {
    it('should enable watcher and update database', async () => {
      jest.spyOn(libraryRepository, 'findById').mockResolvedValue(mockLibrary);
      jest.spyOn(libraryRepository, 'updateLibrary').mockResolvedValue(mockLibrary);
      const startWatcherSpy = jest.spyOn(service, 'startWatcher').mockResolvedValue();

      await service.enableWatcher(mockLibrary.id);

      expect(libraryRepository.updateLibrary).toHaveBeenCalledWith(
        { id: mockLibrary.id },
        { watchEnabled: true }
      );
      expect(startWatcherSpy).toHaveBeenCalledWith(mockLibrary.id, mockLibrary.path);
    });

    it('should throw error if library not found', async () => {
      jest.spyOn(libraryRepository, 'findById').mockResolvedValue(null);

      await expect(service.enableWatcher('invalid-id')).rejects.toThrow(
        'Library invalid-id not found'
      );
    });

    it('should throw error if library is disabled', async () => {
      const disabledLibrary = { ...mockLibrary, enabled: false };
      jest.spyOn(libraryRepository, 'findById').mockResolvedValue(disabledLibrary);

      await expect(service.enableWatcher(mockLibrary.id)).rejects.toThrow(
        `Library ${mockLibrary.id} is disabled`
      );
    });
  });

  describe('disableWatcher', () => {
    it('should disable watcher and update database', async () => {
      jest.spyOn(libraryRepository, 'updateLibrary').mockResolvedValue(mockLibrary);
      const stopWatcherSpy = jest.spyOn(service, 'stopWatcher').mockResolvedValue();

      await service.disableWatcher(mockLibrary.id);

      expect(libraryRepository.updateLibrary).toHaveBeenCalledWith(
        { id: mockLibrary.id },
        { watchEnabled: false }
      );
      expect(stopWatcherSpy).toHaveBeenCalledWith(mockLibrary.id);
    });
  });

  describe('getWatcherStatus', () => {
    it('should return inactive status for non-existent watcher', () => {
      const status = service.getWatcherStatus('non-existent');

      expect(status).toEqual({
        active: false,
        path: undefined,
      });
    });
  });

  describe('getAllWatcherStatuses', () => {
    it('should return empty array when no watchers active', () => {
      const statuses = service.getAllWatcherStatuses();

      expect(statuses).toEqual([]);
    });
  });

  describe('video file extension filtering', () => {
    it('should support all major video formats', () => {
      const supportedExtensions = [
        '.mkv',
        '.mp4',
        '.avi',
        '.mov',
        '.wmv',
        '.flv',
        '.webm',
        '.m4v',
        '.mpg',
        '.mpeg',
        '.m2ts',
        '.ts',
      ];

      // This test verifies that the service's videoExtensions Set includes all expected formats
      // Access private property for testing (this is a white-box test)
      const service = new FileWatcherService(libraryRepository, eventEmitter);
      const videoExtensions = (service as unknown as { videoExtensions: Set<string> })
        .videoExtensions;

      supportedExtensions.forEach((ext) => {
        expect(videoExtensions.has(ext)).toBe(true);
      });
    });
  });

  describe('startWatcher', () => {
    it('should warn and return early when watcher already exists for library', async () => {
      jest.spyOn(libraryRepository, 'findAllLibraries').mockResolvedValue([mockLibrary]);
      await service.onModuleInit();

      // Calling startWatcher again for the same libraryId should early-return
      const loggerWarnSpy = jest.spyOn(
        (service as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn'
      );

      await service.startWatcher(mockLibrary.id, mockLibrary.path);

      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining(mockLibrary.id));
    });
  });

  describe('stopWatcher', () => {
    it('should warn and return early when no watcher exists', async () => {
      const loggerWarnSpy = jest.spyOn(
        (service as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn'
      );

      await service.stopWatcher('non-existent-lib');

      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('non-existent-lib'));
    });
  });

  describe('getWatcherStatus', () => {
    it('should return active=true with path when watcher exists', async () => {
      jest.spyOn(libraryRepository, 'findAllLibraries').mockResolvedValue([mockLibrary]);
      await service.onModuleInit();

      const status = service.getWatcherStatus(mockLibrary.id);

      expect(status.active).toBe(true);
      expect(status.path).toBe(mockLibrary.path);
    });
  });

  describe('getAllWatcherStatuses', () => {
    it('should return all active watcher entries', async () => {
      jest.spyOn(libraryRepository, 'findAllLibraries').mockResolvedValue([mockLibrary]);
      await service.onModuleInit();

      const statuses = service.getAllWatcherStatuses();

      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toEqual({
        libraryId: mockLibrary.id,
        path: mockLibrary.path,
        active: true,
      });
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear all debounce timers and stop watchers', async () => {
      jest.spyOn(libraryRepository, 'findAllLibraries').mockResolvedValue([mockLibrary]);
      await service.onModuleInit();

      const debounceTimers = (service as unknown as { debounceTimers: Map<string, NodeJS.Timeout> })
        .debounceTimers;

      // Inject a fake timer to confirm it gets cleared
      const fakeTimer = setTimeout(() => {
        /* noop */
      }, 60000);
      debounceTimers.set('fake-key', fakeTimer);

      await service.onModuleDestroy();

      expect(debounceTimers.size).toBe(0);
      expect(service.getAllWatcherStatuses()).toHaveLength(0);
    });
  });

  describe('enableWatcher', () => {
    it('should update watchEnabled and start watcher when library is valid', async () => {
      jest.spyOn(libraryRepository, 'findById').mockResolvedValue(mockLibrary);
      jest.spyOn(libraryRepository, 'updateLibrary').mockResolvedValue(mockLibrary);
      const startWatcherSpy = jest.spyOn(service, 'startWatcher').mockResolvedValue();

      await service.enableWatcher(mockLibrary.id);

      expect(libraryRepository.updateLibrary).toHaveBeenCalledWith(
        { id: mockLibrary.id },
        { watchEnabled: true }
      );
      expect(startWatcherSpy).toHaveBeenCalledWith(mockLibrary.id, mockLibrary.path);
    });
  });

  describe('disableWatcher', () => {
    it('should update watchEnabled=false and stop watcher', async () => {
      jest.spyOn(libraryRepository, 'updateLibrary').mockResolvedValue(mockLibrary);
      const stopWatcherSpy = jest.spyOn(service, 'stopWatcher').mockResolvedValue();

      await service.disableWatcher(mockLibrary.id);

      expect(libraryRepository.updateLibrary).toHaveBeenCalledWith(
        { id: mockLibrary.id },
        { watchEnabled: false }
      );
      expect(stopWatcherSpy).toHaveBeenCalledWith(mockLibrary.id);
    });
  });

  describe('handleWatcherEnable / handleWatcherDisable / handleWatcherStop events', () => {
    it('should call enableWatcher when LibraryWatcherEnableEvent fires', async () => {
      const enableSpy = jest.spyOn(service, 'enableWatcher').mockResolvedValue();

      await service.handleWatcherEnable({ libraryId: mockLibrary.id } as any);

      expect(enableSpy).toHaveBeenCalledWith(mockLibrary.id);
    });

    it('should call disableWatcher when LibraryWatcherDisableEvent fires', async () => {
      const disableSpy = jest.spyOn(service, 'disableWatcher').mockResolvedValue();

      await service.handleWatcherDisable({ libraryId: mockLibrary.id } as any);

      expect(disableSpy).toHaveBeenCalledWith(mockLibrary.id);
    });

    it('should call stopWatcher when LibraryWatcherStopEvent fires', async () => {
      const stopSpy = jest.spyOn(service, 'stopWatcher').mockResolvedValue();

      await service.handleWatcherStop({ libraryId: mockLibrary.id } as any);

      expect(stopSpy).toHaveBeenCalledWith(mockLibrary.id);
    });
  });

  describe('file.detected event emission', () => {
    it('should emit file.detected event with correct payload for video files', async () => {
      jest.spyOn(libraryRepository, 'findAllLibraries').mockResolvedValue([mockLibrary]);
      await service.onModuleInit();

      // Invoke the private handleFileAdded via the watcher "add" callback
      const handleFileAdded = (
        service as unknown as { handleFileAdded: (libraryId: string, filePath: string) => void }
      ).handleFileAdded.bind(service);

      // Use fake timers to fire debounce immediately
      jest.useFakeTimers();
      handleFileAdded(mockLibrary.id, '/media/test/movie.mkv');
      jest.runAllTimers();
      jest.useRealTimers();

      // Wait a tick for async createJobForFile
      await new Promise((resolve) => setImmediate(resolve));

      expect(eventEmitter.emit).toHaveBeenCalledWith('file.detected', {
        libraryId: mockLibrary.id,
        filePath: '/media/test/movie.mkv',
        fileName: 'movie.mkv',
      });
    });

    it('should not emit file.detected for non-video files', () => {
      const handleFileAdded = (
        service as unknown as { handleFileAdded: (libraryId: string, filePath: string) => void }
      ).handleFileAdded.bind(service);

      handleFileAdded(mockLibrary.id, '/media/test/document.pdf');

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should debounce rapid duplicate add events for same file', () => {
      jest.useFakeTimers();

      const handleFileAdded = (
        service as unknown as { handleFileAdded: (libraryId: string, filePath: string) => void }
      ).handleFileAdded.bind(service);
      const debounceTimers = (service as unknown as { debounceTimers: Map<string, NodeJS.Timeout> })
        .debounceTimers;

      handleFileAdded(mockLibrary.id, '/media/test/movie.mkv');
      handleFileAdded(mockLibrary.id, '/media/test/movie.mkv');
      handleFileAdded(mockLibrary.id, '/media/test/movie.mkv');

      // Only one timer should remain in the map
      expect(debounceTimers.size).toBe(1);

      jest.runAllTimers();
      jest.useRealTimers();
    });
  });
});
